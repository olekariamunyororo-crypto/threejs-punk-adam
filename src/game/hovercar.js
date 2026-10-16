import * as THREE from "three/webgpu";
import { getGltfLoader } from "../world/loaders/createGltfLoaders.js";
import { buildModelBvh } from "../world/bvh.js";
import { getAudioVolume } from "../audio/audioState.js";
import { createFerrariEngine } from "../audio/ferrariEngine.js"; // [ferrari]
import { createHovercarPhysics, HOVER } from "./hovercarPhysics.js";
import { vehicleState } from "./vehicleState.js";
import { capTextureSize } from "../world/textureBudget.js"; // [gpu]

const MODEL_URL = "/models/hovercar.glb?v=1";
const MODEL_SCALE = 0.85;
/** Parked next to the player start, nose pointing down the alley. */
const SPAWN = { x: -133, z: 27.5, yaw: Math.PI / 2 };
const ENTER_RADIUS = 4.6; // m from the cockpit door
const CANOPY_OPEN = -1.0; // rad, lifts the nose end of the canopy
const ENTER_TIME = 2.6;
const EXIT_TIME = 1.7;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => smooth(clamp((t - a) / (b - a), 0, 1));
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function glowTexture(stops) {
  try {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ UI */

const CSS = `
.hc-ui{position:fixed;z-index:99990;font-family:Orbitron,ui-monospace,Menlo,Consolas,monospace;color:#bff6ff;letter-spacing:.16em;
 user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none;display:none}
.hc-ui.hc-on{display:block}
.hc-enter{left:50%;top:60%;transform:translateX(-50%);padding:14px 24px;border:1px solid #22d3ee;background:rgba(5,14,26,.74);
 box-shadow:0 0 18px rgba(34,211,238,.45),inset 0 0 12px rgba(34,211,238,.18);font-size:14px;text-align:center;cursor:pointer;color:#bff6ff;
 clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
.hc-enter small{display:block;margin-top:5px;font-size:10px;opacity:.7;letter-spacing:.3em}
.hc-speed{left:50%;top:84px;transform:translateX(-50%);text-align:center;pointer-events:none}
.hc-speed b{font-size:34px;font-weight:700;color:#e8fdff;text-shadow:0 0 14px #22d3ee}
.hc-speed span{display:block;font-size:10px;opacity:.75;margin-top:2px}
.hc-hint{left:50%;top:150px;transform:translateX(-50%);font-size:10px;opacity:.65;white-space:nowrap;pointer-events:none}
.hc-toast{left:50%;top:44%;transform:translateX(-50%);font-size:13px;color:#ffd9a0;text-shadow:0 0 10px #ff9d00;pointer-events:none;opacity:0;transition:opacity .25s}
.hc-btn{width:60px;height:60px;border-radius:50%;border:1px solid #22d3ee;background:rgba(5,14,26,.62);color:#bff6ff;font:inherit;font-size:11px;
 letter-spacing:.08em;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(34,211,238,.35);cursor:pointer;padding:0}
.hc-ui.hc-btn.hc-on{display:flex}
.hc-btn.hc-held{background:rgba(34,211,238,.35);color:#fff}
.hc-exit{left:50%;bottom:28px;transform:translateX(-50%);width:auto;border-radius:0;padding:0 22px;height:46px;
 clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
.hc-boost{right:16px;bottom:30px}.hc-up{right:16px;bottom:100px}.hc-down{right:16px;bottom:170px}
`;

function createUi({ onEnter, onExit, hold }) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const els = {};
  const make = (key, tag, cls, html) => {
    const el = document.createElement(tag);
    el.className = "hc-ui " + cls;
    el.setAttribute("data-ui-block-look", "true");
    el.innerHTML = html;
    document.body.appendChild(el);
    els[key] = el;
    return el;
  };
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;

  const enter = make("enter", "button", "hc-enter", `ENTER HOVERCAR<small>${coarse ? "TAP" : "[E]"}</small>`);
  enter.type = "button";
  enter.addEventListener("click", onEnter);

  make("speed", "div", "hc-speed", '<b data-k="v">0</b><span>KM/H &nbsp;·&nbsp; ALT <i data-k="a" style="font-style:normal">0</i> M</span>');
  if (!coarse) {
    make("hint", "div", "hc-hint", "W/S THROTTLE · A/D STEER · SPACE RISE · X DESCEND · SHIFT BOOST · E EXIT");
  }
  make("toast", "div", "hc-toast", "");

  const exit = make("exit", "button", "hc-btn hc-exit", "EXIT");
  exit.type = "button";
  exit.addEventListener("click", onExit);

  const holdBtn = (key, cls, label, name) => {
    const b = make(key, "button", "hc-btn " + cls, label);
    b.type = "button";
    const set = (v) => (e) => {
      e.preventDefault();
      hold(name, v);
      b.classList.toggle("hc-held", v);
      if (v) b.setPointerCapture?.(e.pointerId);
    };
    b.addEventListener("pointerdown", set(true));
    b.addEventListener("pointerup", set(false));
    b.addEventListener("pointercancel", set(false));
  };
  holdBtn("up", "hc-up", "▲", "up");
  holdBtn("down", "hc-down", "▼", "down");
  holdBtn("boost", "hc-boost", "BOOST", "boost");

  const show = (keys) => {
    for (const [k, el] of Object.entries(els)) el.classList.toggle("hc-on", keys.includes(k));
  };
  let toastTimer = 0;
  const toast = (msg) => {
    els.toast.textContent = msg;
    els.toast.classList.add("hc-on");
    els.toast.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.style.opacity = "0"), 1600);
  };
  const setSpeed = (kmh, alt) => {
    els.speed.querySelector('[data-k="v"]').textContent = String(Math.round(Math.abs(kmh)));
    els.speed.querySelector('[data-k="a"]').textContent = String(Math.round(alt));
  };
  return { show, toast, setSpeed, coarse };
}

/* --------------------------------------------------------------- audio */

function createEngineAudio() {
  let ctx = null, osc1, osc2, filter, gain;
  return {
    start() {
      try {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        if (!ctx) {
          ctx = new AC();
          osc1 = ctx.createOscillator();
          osc2 = ctx.createOscillator();
          osc1.type = "sawtooth";
          osc2.type = "triangle";
          filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 420;
          gain = ctx.createGain();
          gain.gain.value = 0;
          osc1.connect(filter);
          osc2.connect(filter);
          filter.connect(gain).connect(ctx.destination);
          osc1.start();
          osc2.start();
        }
        ctx.resume?.();
      } catch {
        /* audio is optional */
      }
    },
    update(speedNorm, boost, altNorm) {
      if (!ctx) return;
      const t = ctx.currentTime, vol = getAudioVolume?.() ?? 0.5;
      const f = 48 + speedNorm * 110 + (boost ? 25 : 0) + altNorm * 12;
      osc1.frequency.setTargetAtTime(f, t, 0.08);
      osc2.frequency.setTargetAtTime(f * 1.51, t, 0.08);
      filter.frequency.setTargetAtTime(300 + speedNorm * 900 + (boost ? 500 : 0), t, 0.1);
      gain.gain.setTargetAtTime((0.05 + speedNorm * 0.1) * vol * 1.6, t, 0.1);
    },
    stop() {
      if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    },
  };
}

/* ------------------------------------------------------------- hovercar */

/**
 * Walk up -> ENTER (canopy opens, camera slips into the cockpit) -> drive/fly with
 * a chase camera -> EXIT (lands, you step out on the left side).
 */
export function createHovercar({ scene, renderer, world, camera, getWalkControls, isActive = () => true, loadGltf }) {
  const root = new THREE.Group();
  root.name = "hovercar";
  root.visible = false;
  scene.add(root);

  const wallRoots = [world.city, world.carCollider].filter(Boolean);
  const groundTargets = [world.city, world.ground?.mesh].filter(Boolean);
  const physics = createHovercarPhysics({ groundTargets, wallRoots });
  const ps = physics.state;

  // invisible walk-blocker + bullet stopper, follows the car
  const collider = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 5.8), new THREE.MeshBasicMaterial());
  collider.name = "hovercar-collider";
  collider.visible = false;
  collider.geometry.computeBoundsTree?.();
  scene.add(collider);

  const engine = createFerrariEngine({ getVolume: () => getAudioVolume?.() ?? 0.5 });
  const input = { up: false, down: false, boost: false };
  const ui = typeof document !== "undefined"
    ? createUi({
        onEnter: () => api.enter(),
        onExit: () => api.exit(),
        hold: (k, v) => (input[k] = v),
      })
    : null;

  let model = null;
  let canopyPivot = null;
  let flames = [];
  let glow = null;
  let ready = false;
  let state = "loading"; // loading | walk | entering | driving | exiting
  let seq = { t: 0, dur: 1 };
  let baseFov = camera.fov;
  const cam = { pos: new THREE.Vector3(), yaw: 0, init: false };
  const camFrom = new THREE.Vector3(), lookFrom = new THREE.Vector3();
  const exitTo = new THREE.Vector3(), exitLook = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  let time = 0;
  let exitWanted = false;

  const pointA = (local, out) => out.copy(local).multiplyScalar(MODEL_SCALE).applyMatrix4(root.matrixWorld);
  const COCKPIT_EYE = new THREE.Vector3(0, 1.18, 1.05);
  const DOOR_POINT = new THREE.Vector3(1.9, 0.9, 1.2); // by the canopy; x is mirrored to the side you walk up on
  const SIDE_VIEW = new THREE.Vector3(3.4, 2.2, 1.6);
  let sideSign = 1;
  const doorWorld = (sign, out) => pointA(tmpD.set(DOOR_POINT.x * sign, DOOR_POINT.y, DOOR_POINT.z), out);
  const sideWorld = (sign, out) => pointA(tmpD.set(SIDE_VIEW.x * sign, SIDE_VIEW.y, SIDE_VIEW.z), out);

  function syncRoot() {
    root.position.copy(ps.pos);
    root.rotation.set(ps.pitch, ps.yaw, ps.roll, "YXZ");
    root.updateMatrixWorld(true);
    collider.position.copy(ps.pos).y += 0.35;
    collider.rotation.copy(root.rotation);
    collider.updateMatrixWorld(true);
  }

  async function load() {
    const gltf = await (loadGltf ?? ((u) => getGltfLoader(renderer).loadAsync(u)))(MODEL_URL);
    model = gltf.scene;
    model.scale.setScalar(MODEL_SCALE);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false; // static shadow map; a moving caster would smear
        o.receiveShadow = false;
        o.frustumCulled = true;
      }
    });
    // canopy hinge: rear-bottom edge, lifts the nose end like a fighter canopy
    const canopyMeshes = [];
    model.traverse((o) => {
      if (o.name?.startsWith("Canopy")) canopyMeshes.push(o);
    });
    if (canopyMeshes.length) {
      const box = new THREE.Box3();
      canopyMeshes.forEach((m) => box.expandByObject(m));
      canopyPivot = new THREE.Group();
      canopyPivot.position.set(0, box.min.y / MODEL_SCALE, box.min.z / MODEL_SCALE);
      model.updateMatrixWorld(true);
      // box was measured in model space with scale applied by Box3 on world matrices (root not moved yet)
      model.add(canopyPivot);
      canopyMeshes.forEach((m) => canopyPivot.attach(m));
    }
    capTextureSize(model, 512); // [gpu]
    root.add(model);

    // rear thruster glow + underglow
    const flameTex = glowTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(120,220,255,0.9)"], [1, "rgba(0,80,255,0)"]]);
    for (const x of [-0.3, 0.3]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.4 }));
      s.position.set(x, 1.05, -3.9);
      s.scale.setScalar(0.8);
      model.add(s);
      flames.push(s);
    }
    const glowTex = glowTexture([[0, "rgba(120,240,255,0.9)"], [0.5, "rgba(34,211,238,0.35)"], [1, "rgba(0,0,0,0)"]]);
    glow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 7.4),
      new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, -0.42, -0.2);
    glow.renderOrder = 5;
    root.add(glow);

    buildModelBvh?.(collider);
    physics.reset(SPAWN.x, SPAWN.z, SPAWN.yaw);
    syncRoot();
    root.visible = true;
    // walkers can't stroll through it; bullets stop at it
    world.colliders?.push?.(collider);
    world.focusTargets?.push?.(collider);
    ready = true;
    state = "walk";
    console.info("[hovercar] ready at", SPAWN.x, SPAWN.z);
  }
  load().catch((err) => console.warn("[hovercar] failed to load:", err));

  /* ---- camera helpers ---- */
  function chaseTarget(out) {
    return out.set(ps.pos.x, ps.pos.y + 1.1, ps.pos.z);
  }
  function chasePose(dt, snap) {
    const speedN = clamp(Math.abs(ps.forwardSpeed) / HOVER.maxSpeed, 0, 1.4);
    cam.yaw = snap ? ps.yaw : lerpAngle(cam.yaw, ps.yaw, 1 - Math.exp(-3.2 * dt));
    const dist = 7.2 + speedN * 2.2;
    const tgt = chaseTarget(tmpA);
    const desired = tmpB.set(
      tgt.x - Math.sin(cam.yaw) * dist,
      tgt.y + 2.7 + speedN * 0.5 + ps.alt * 0.02,
      tgt.z - Math.cos(cam.yaw) * dist,
    );
    // keep the camera out of walls
    tmpC.copy(desired).sub(tgt);
    const len = tmpC.length();
    raycaster.set(tgt, tmpC.normalize());
    raycaster.far = len;
    raycaster.firstHitOnly = true;
    const hit = raycaster.intersectObjects(wallRoots, true)[0];
    if (hit) desired.copy(tgt).addScaledVector(tmpC, Math.max(1.2, hit.distance - 0.5));
    if (snap || !cam.init) cam.pos.copy(desired);
    else cam.pos.lerp(desired, 1 - Math.exp(-12 * dt));
    cam.init = true;
    return tgt.set(ps.pos.x + Math.sin(ps.yaw) * 3, ps.pos.y + 0.9, ps.pos.z + Math.cos(ps.yaw) * 3);
  }

  function setCanopy(k) {
    if (canopyPivot) canopyPivot.rotation.x = CANOPY_OPEN * k;
  }

  /* ---- sequences ---- */
  function startEnter() {
    state = "entering";
    seq = { t: 0, dur: ENTER_TIME };
    root.updateMatrixWorld(true);
    sideSign = root.worldToLocal(tmpA.copy(camera.position)).x >= 0 ? 1 : -1;
    vehicleState.driving = true;
    baseFov = camera.fov;
    camFrom.copy(camera.position);
    camera.getWorldDirection(tmpA);
    lookFrom.copy(camera.position).addScaledVector(tmpA, 10);
    cam.init = false;
    ui?.show([]);
    engine.start();
  }

  function updateEnter(dt) {
    seq.t += dt;
    const t = clamp(seq.t / seq.dur, 0, 1);
    // canopy: open 0-.3, hold, close .62-.8
    setCanopy(seg(t, 0, 0.3) * (1 - seg(t, 0.62, 0.8)));
    root.updateMatrixWorld(true);
    const side = sideWorld(sideSign, new THREE.Vector3());
    const door = doorWorld(sideSign, new THREE.Vector3());
    const eye = pointA(COCKPIT_EYE, new THREE.Vector3());
    const eyeLook = new THREE.Vector3(Math.sin(ps.yaw) * 6, 0, Math.cos(ps.yaw) * 6).add(eye);
    const chaseLook = chasePose(dt, true).clone();
    const chasePos = cam.pos.clone();
    let pos, look;
    if (t < 0.34) {
      const k = seg(t, 0, 0.34);
      pos = camFrom.clone().lerp(side, k);
      look = lookFrom.clone().lerp(door, k);
    } else if (t < 0.62) {
      const k = seg(t, 0.34, 0.62);
      pos = side.clone().lerp(eye, k);
      look = door.clone().lerp(eyeLook, k);
    } else {
      const k = seg(t, 0.62, 1);
      pos = eye.clone().lerp(chasePos, k);
      look = eyeLook.clone().lerp(chaseLook, k);
    }
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    if (seq.t >= seq.dur) {
      state = "driving";
      setCanopy(0);
      cam.init = false;
      ui?.show(["speed", "hint", "exit", "up", "down", "boost", "toast"]);
    }
  }

  function pickExit() {
    const yaw = ps.yaw;
    const lx = Math.cos(yaw), lz = -Math.sin(yaw); // car-left
    for (const [sx, sz] of [[lx, lz], [-lx, -lz], [-Math.sin(yaw), -Math.cos(yaw)]]) {
      const x = ps.pos.x + sx * 2.9, z = ps.pos.z + sz * 2.9;
      const g = physics.sampleGround(x, z, ps.pos.y - HOVER.rideHeight);
      if (g === null) continue;
      tmpA.set(ps.pos.x, g + 1, ps.pos.z);
      tmpB.set(x, g + 1, z).sub(tmpA);
      const d = tmpB.length();
      raycaster.set(tmpA, tmpB.normalize());
      raycaster.far = d + 0.4;
      raycaster.firstHitOnly = true;
      if (raycaster.intersectObjects(wallRoots, true).length) continue;
      const eyeH = getWalkControls()?.settings?.eyeHeight ?? 1.6;
      exitTo.set(x, g + eyeH, z);
      return true;
    }
    const eyeH = getWalkControls()?.settings?.eyeHeight ?? 1.6;
    exitTo.set(ps.pos.x, ps.pos.y - HOVER.rideHeight + eyeH, ps.pos.z);
    return false;
  }

  function startExit() {
    state = "exiting";
    seq = { t: 0, dur: EXIT_TIME };
    pickExit();
    camFrom.copy(camera.position);
    camera.getWorldDirection(tmpA);
    lookFrom.copy(camera.position).addScaledVector(tmpA, 8);
    exitLook.set(ps.pos.x, ps.pos.y + 0.8, ps.pos.z);
    ui?.show([]);
    engine.stop();
  }

  function updateExit(dt) {
    physics.update(dt, { throttle: 0, steer: 0, lift: 0, boost: false });
    syncRoot();
    seq.t += dt;
    const t = clamp(seq.t / seq.dur, 0, 1);
    setCanopy(seg(t, 0, 0.3) * (1 - seg(t, 0.75, 1)));
    const k = seg(t, 0.1, 1);
    camera.position.copy(camFrom).lerp(exitTo, k);
    tmpA.copy(lookFrom).lerp(exitLook, k);
    camera.lookAt(tmpA);
    camera.fov += (baseFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
    if (seq.t >= seq.dur) finishExit();
  }

  function finishExit() {
    state = "walk";
    setCanopy(0);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    vehicleState.driving = false;
    const wc = getWalkControls();
    wc?.syncEulerFromCamera?.();
    wc?.snapCameraToGround?.();
    exitWanted = false;
  }

  function updateDrive(dt) {
    const wc = getWalkControls();
    const live = isActive();
    const inp = live ? (wc?.getInput?.() ?? { x: 0, y: 0, sprint: false }) : { x: 0, y: 0, sprint: false };
    let throttle = -inp.y, steer = inp.x;
    let lift = live ? (input.up ? 1 : 0) - (input.down ? 1 : 0) : 0;
    const boost = live && (input.boost || inp.sprint);
    if (exitWanted) { // brake and descend, then step out
      throttle = ps.forwardSpeed > 1 ? -1 : ps.forwardSpeed < -1 ? 1 : 0;
      steer = 0;
      lift = -1;
    }
    physics.update(dt, { throttle, steer, lift, boost });
    syncRoot();
    runOverEnemies();
    const look = chasePose(dt, false);
    camera.position.copy(cam.pos);
    camera.lookAt(look);
    const speedN = clamp(Math.abs(ps.forwardSpeed) / HOVER.maxSpeed, 0, 1.4);
    camera.fov += (baseFov + speedN * 14 + (boost ? 5 : 0) - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();
    ui?.setSpeed(ps.forwardSpeed * 3.6, ps.alt);
    engine.update({ speed: Math.abs(ps.forwardSpeed), throttle: clamp(Math.abs(throttle), 0, 1), boost, alt: ps.alt }, dt);
    if (exitWanted && Math.abs(ps.forwardSpeed) < 5 && ps.alt < 0.5) startExit();
  }

  function updateVisuals(dt) {
    time += dt;
    if (impactLife > 0) {
      impactLife -= dt;
      if (impactSpark) impactSpark.material.opacity = Math.max(0, impactLife / 0.14);
    }
    const speedN = clamp(Math.abs(ps.forwardSpeed) / HOVER.maxSpeed, 0, 1.4);
    const driving = state === "driving";
    flames.forEach((f, i) => {
      f.material.opacity = (driving ? 0.45 + speedN * 0.55 : 0.28) * (0.85 + 0.15 * Math.sin(time * 40 + i * 2));
      f.scale.setScalar((driving ? 0.7 + speedN * 1.4 : 0.55) * (0.9 + 0.1 * Math.sin(time * 33 + i)));
    });
    if (glow) glow.material.opacity = 0.35 + 0.2 * Math.sin(time * 3) + speedN * 0.2;
    if (model && state === "walk") model.position.y = Math.sin(time * 1.6) * 0.035; // idle hover bob
    else if (model) model.position.y = 0;
  }

  function updatePrompt() {
    if (!ui) return;
    root.updateMatrixWorld(true);
    let near = false;
    for (const sign of [1, -1]) {
      const d = doorWorld(sign, tmpA);
      const dx = camera.position.x - d.x, dz = camera.position.z - d.z;
      if (dx * dx + dz * dz < ENTER_RADIUS * ENTER_RADIUS && Math.abs(camera.position.y - d.y) < 4) near = true;
    }
    ui.show(near && isActive() ? ["enter"] : []);
  }

  // [roadkill] ramming an enemy at speed kills him (not while flying over his head)
  function runOverEnemies() {
    const agents = world.enemyAI?.agents;
    if (!agents || !agents.length) return;
    if (Math.hypot(ps.vx, ps.vz) < 3) return;
    const fx = Math.sin(ps.yaw), fz = Math.cos(ps.yaw);
    for (const a of agents) {
      const env = a.env;
      if (!env || !env.isAlive || !env.isAlive()) continue;
      const p = env.getEnemyPosition();
      const feet = p.y - (env.settings?.eyeHeight ?? 1.55);
      const dx = p.x - ps.pos.x, dz = p.z - ps.pos.z;
      if (Math.abs(dx * fx + dz * fz) > HOVER.halfLength + 0.45) continue; // along the car
      if (Math.abs(-dx * fz + dz * fx) > HOVER.halfWidth + 0.45) continue; // across the car
      if (feet > ps.pos.y + 1.4 || feet + 2.0 < ps.pos.y - 0.7) continue; // above / below
      a.registerHit({ point: new THREE.Vector3(p.x, feet + 1.1, p.z) });
      ui?.toast("ENEMY DOWN");
    }
  }

  // [roadkill] spark on the hull when a bullet hits
  let impactSpark = null;
  let impactLife = 0;
  function bulletImpact() {
    if (!ready) return;
    if (!impactSpark) {
      impactSpark = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture([[0, "rgba(255,255,255,1)"], [0.3, "rgba(160,240,255,0.9)"], [1, "rgba(0,120,255,0)"]]),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      impactSpark.renderOrder = 12;
      root.add(impactSpark);
    }
    impactSpark.position.set((Math.random() - 0.5) * 2.2, 0.2 + Math.random() * 1.3, (Math.random() - 0.5) * 5);
    impactSpark.scale.setScalar(0.7 + Math.random() * 0.5);
    impactSpark.material.opacity = 1;
    impactLife = 0.14;
  }

  const api = {
    bulletImpact,
    get ready() {
      return ready;
    },
    isDriving: () => vehicleState.driving,
    enter() {
      if (state !== "walk" || !isActive()) return;
      startEnter();
    },
    exit() {
      if (state !== "driving") return;
      if (Math.abs(ps.forwardSpeed) < 5 && ps.alt < 0.5) startExit();
      else {
        exitWanted = true;
        ui?.toast("LANDING… SLOW DOWN TO EXIT");
      }
    },
    /** Respawn / reset: park the car again and give control back to walking. */
    reset() {
      const wasInCar = state === "entering" || state === "driving" || state === "exiting";
      state = ready ? "walk" : "loading";
      vehicleState.driving = false;
      exitWanted = false;
      setCanopy(0);
      engine.stop();
      if (wasInCar) {
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
      }
      if (ready) {
        physics.reset(SPAWN.x, SPAWN.z, SPAWN.yaw);
        syncRoot();
      }
      ui?.show([]);
    },
    teleport(x, z, yaw = ps.yaw) {
      physics.reset(x, z, yaw);
      syncRoot();
    },
    update(delta) {
      if (!ready) return;
      const dt = Math.min(delta, 0.05);
      if (state === "walk") updatePrompt();
      else if (state === "entering") updateEnter(dt);
      else if (state === "driving") updateDrive(dt);
      else if (state === "exiting") updateExit(dt);
      updateVisuals(dt);
    },
    physics,
    root,
    get state() {
      return state;
    },
  };

  if (typeof window !== "undefined") {
    window.__hovercarApi = api;
    window.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "KeyE" && !e.repeat) {
        if (state === "walk") api.enter();
        else if (state === "driving") api.exit();
      } else if (state === "driving") {
        if (e.code === "Space") (input.up = true), e.preventDefault();
        if (e.code === "KeyX") input.down = true;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") input.up = false;
      if (e.code === "KeyX") input.down = false;
    });
  }
  return api;
}
