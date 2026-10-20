import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAudioVolume } from "../audio/audioState.js";

/**
 * Melee enemy: a samurai who walks at you, CHARGES, then cuts (overhead / horizontal / lunge).
 * He can DEFLECT some bullets with the katana. Plugs into the enemy list as an agent:
 * { env, update, shootRay, registerHit, applyDamage, respawn }.  Tune live: __samurai.deflectChance = 0
 */
export const SAMURAI = {
  aggro: 45, // m: starts hunting
  walkSpeed: 1.6,
  chargeSpeed: 6.5,
  turnRate: 5,
  chargeMin: 3.2, // charge ends / attack starts inside this range
  chargeMax: 16,
  chargeCooldown: 4.5,
  chargeMaxTime: 2.6,
  reach: { Slash: 2.9, Slash2: 2.8, Dash: 3.8 }, // m, measured from his feet
  window: { Slash: [0.5, 0.64], Slash2: [0.3, 0.46], Dash: [0.3, 0.46] }, // damage window (s into the clip)
  swing: { Slash: 0.42, Slash2: 0.2, Dash: 0.26 }, // when the swoosh plays
  deflectChance: 0.4,
  deflectCooldown: 2.2,
  respawnAfter: 15,
  hideAfter: 6,
  hitScale: 1.15,
  eyeHeight: 1.55,
  bodyRadius: 0.55,
};
if (typeof window !== "undefined") window.__samurai = SAMURAI;

const MODEL_URL = "/models/samurai.glb?v=1";
const CAPSULES = [ // [bone A, bone B, radius] — roomy, he is wrapped in cloth
  ["Head", "HeadTop", 0.26], ["Neck", "Head", 0.16], ["Spine2", "Neck", 0.3], ["Hips", "Spine2", 0.34],
  ["Spine2", "LeftArm", 0.18], ["LeftArm", "LeftForeArm", 0.16], ["LeftForeArm", "LeftHand", 0.14],
  ["Spine2", "RightArm", 0.18], ["RightArm", "RightForeArm", 0.16], ["RightForeArm", "RightHand", 0.14],
  ["LeftUpLeg", "LeftLeg", 0.24], ["LeftLeg", "LeftFoot", 0.2], ["LeftFoot", "LeftToeBase", 0.14],
  ["RightUpLeg", "RightLeg", 0.24], ["RightLeg", "RightFoot", 0.2], ["RightFoot", "RightToeBase", 0.14],
];
const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3(), S = new THREE.Vector3(), W = new THREE.Vector3();
function rayCapsule(o, d, a, b, r, maxD) {
  S.copy(b).sub(a); W.copy(o).sub(a);
  const bb = d.dot(S), c = S.lengthSq(), dd = d.dot(W), e = S.dot(W), denom = c - bb * bb;
  let tc = denom > 1e-8 ? (e - bb * dd) / denom : 0; tc = Math.min(1, Math.max(0, tc));
  let sc = bb * tc - dd;
  if (sc < 0) { sc = 0; tc = c > 1e-8 ? Math.min(1, Math.max(0, e / c)) : 0; }
  P.copy(d).multiplyScalar(sc).add(o); Q.copy(S).multiplyScalar(tc).add(a);
  const dist = P.distanceTo(Q); if (dist > r) return -1;
  const t = Math.max(0, sc - Math.sqrt(r * r - dist * dist)); return t <= maxD ? t : -1;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/* tiny synthesised sounds (no assets): blade swoosh + steel clang */
let ac = null, noiseBuf = null;
function audio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return null;
  if (!ac) { ac = new AC(); noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  if (ac.state === "suspended") ac.resume?.(); return ac;
}
function swoosh(dist) { try { const c = audio(); if (!c) return; const t = c.currentTime, v = Math.min(1, 1.6 / (1 + dist / 6)) * (getAudioVolume?.() ?? 1) * 0.5;
  const n = c.createBufferSource(); n.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.2);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.09); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); n.connect(f).connect(g).connect(c.destination); n.start(t); n.stop(t + 0.3); } catch { /* optional */ } }
function clang(dist) { try { const c = audio(); if (!c) return; const t = c.currentTime, v = Math.min(1, 1.8 / (1 + dist / 6)) * (getAudioVolume?.() ?? 1) * 0.35;
  for (const [fr, dur] of [[1760, 0.5], [2637, 0.35], [4180, 0.2]]) { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = fr * (0.99 + Math.random() * 0.02); const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02); }
  const n = c.createBufferSource(); n.buffer = noiseBuf; const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3500; const g2 = c.createGain(); g2.gain.setValueAtTime(v * 1.2, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05); n.connect(hp).connect(g2).connect(c.destination); n.start(t); n.stop(t + 0.08); } catch { /* optional */ } }

function glow() { try { if (typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(150,235,255,0.9)"); g.addColorStop(1, "rgba(0,100,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; } catch { return null; } }

export function setupSamurai({ camera, scene, colliders = [], ground = null, model = null, spawnPoints = [], onPlayerHit = () => {}, getPlayerSpeed = () => 0, gltfLoader = null }) {
  const C = SAMURAI;
  const root = new THREE.Group(); root.name = "samurai"; root.visible = false; scene.add(root);
  const wallRoots = colliders; const groundTargets = [model, ground].filter(Boolean);
  const raycaster = new THREE.Raycaster();
  const pos = new THREE.Vector3(); const eye = new THREE.Vector3();
  const bones = {}; let mixer = null; const actions = {}; let current = null;
  let loaded = false, alive = false, state = "idle", yaw = 0, t = 0, deadFor = 0, spawnIdx = 0;
  let chargeCd = 2, atkCd = 0.6, blockCd = 0, chargeT = 0, losT = 0, los = true, stuckT = 0, comboSide = 0;
  let atk = null, blk = null, recoverT = 0, deflects = 0;
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); flash.renderOrder = 12; scene.add(flash); let flashLife = 0;

  const target = () => ({ x: camera.position.x, z: camera.position.z, y: camera.position.y - C.eyeHeight });
  const dist2 = () => { const p = target(); return Math.hypot(p.x - pos.x, p.z - pos.z); };

  function groundAt(x, z, refY) {
    raycaster.set(new THREE.Vector3(x, refY + 4, z), new THREE.Vector3(0, -1, 0)); raycaster.near = 0; raycaster.far = 24; raycaster.firstHitOnly = false;
    let best = null; for (const h of raycaster.intersectObjects(groundTargets, true)) { if (h.point.y > refY + 0.6) continue; if (best === null || h.point.y > best) best = h.point.y; } return best;
  }
  function wallHit(dx, dz, far, h = 0.9) {
    raycaster.set(new THREE.Vector3(pos.x, pos.y + h, pos.z), new THREE.Vector3(dx, 0, dz)); raycaster.near = 0; raycaster.far = far; raycaster.firstHitOnly = true;
    return raycaster.intersectObjects(wallRoots, true)[0] ?? null;
  }
  function move(dt, speed, dirx, dirz) { // slide along walls, follow the ground
    const mx = dirx * speed * dt, mz = dirz * speed * dt, len = Math.hypot(mx, mz); if (len < 1e-6) return;
    const hit = wallHit(mx / len, mz / len, len + C.bodyRadius);
    let ox = mx, oz = mz;
    if (hit && hit.distance < len + C.bodyRadius) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(-mx, 0, -mz);
      const nl = Math.hypot(n.x, n.z) || 1; let nx = n.x / nl, nz = n.z / nl; if (nx * mx + nz * mz > 0) { nx = -nx; nz = -nz; }
      const vn = ox * nx + oz * nz; ox -= nx * vn; oz -= nz * vn;
      const h2 = wallHit(ox, oz, Math.hypot(ox, oz) + C.bodyRadius); if (h2 && h2.distance < Math.hypot(ox, oz) + C.bodyRadius) { ox = 0; oz = 0; }
      stuckT += dt;
    } else stuckT = Math.max(0, stuckT - dt);
    const nxp = pos.x + ox, nzp = pos.z + oz; const g = groundAt(nxp, nzp, pos.y);
    if (g !== null) { pos.x = nxp; pos.z = nzp; pos.y += (g - pos.y) * Math.min(1, dt * 14); }
  }
  function placeAtGround() { const g = groundAt(pos.x, pos.z, pos.y + 6) ?? pos.y; pos.y = g; }

  function play(name, { fade = 0.2, once = false, timeScale = 1 } = {}) {
    const a = actions[name]; if (!a) return null;
    a.setEffectiveTimeScale(timeScale);
    if (current === a) return a;
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (current) current.fadeOut(fade); current = a; return a;
  }
  const spark = (p) => { flash.position.copy(p); flash.material.opacity = 1; flash.scale.setScalar(0.9); flashLife = 0.16; };
  const bladePos = (out) => (bones.RightHand ? bones.RightHand.getWorldPosition(out) : out.copy(pos).setY(pos.y + 1.2));

  function face(dt, rate = C.turnRate) { const p = target(); const want = Math.atan2(p.x - pos.x, p.z - pos.z); yaw = lerpAngle(yaw, want, 1 - Math.exp(-rate * dt)); }

  function startAttack(kind) {
    state = "attack"; atk = { kind, t: 0, hit: false, snd: false, dur: actions[kind]?.getClip().duration ?? 1.2 };
    play(kind, { fade: 0.1, once: true }); atkCd = 0.9;
  }
  function startBlock(point) {
    state = "block"; blk = { t: 0 }; blockCd = C.deflectCooldown; deflects++; atk = null;
    play("Block", { fade: 0.06, once: true }); spark(point ?? bladePos(new THREE.Vector3())); clang(dist2()); chargeCd = 0; // he answers with a charge
  }
  function kill(point) {
    if (!alive) return; alive = false; state = "dead"; deadFor = 0; atk = null; blk = null; play("Die", { fade: 0.08, once: true }); if (point) spark(point);
  }
  function spawn() {
    const sp = spawnPoints.length ? spawnPoints[spawnIdx++ % spawnPoints.length] : new THREE.Vector3(camera.position.x + 30, camera.position.y, camera.position.z);
    pos.set(sp.x, sp.y, sp.z); placeAtGround(); const p = target(); yaw = Math.atan2(p.x - pos.x, p.z - pos.z);
    alive = true; state = "idle"; atk = blk = null; chargeCd = 2; atkCd = 0.6; blockCd = 0; deadFor = 0; root.visible = true; play("Idle", { fade: 0.1 });
  }

  async function load() {
    const loader = gltfLoader ?? new GLTFLoader(); const gltf = await (loader.loadAsync ? loader.loadAsync(MODEL_URL) : new Promise((ok, er) => loader.load(MODEL_URL, ok, undefined, er)));
    const m = gltf.scene; m.traverse((o) => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } }); root.add(m);
    mixer = new THREE.AnimationMixer(m); for (const c of gltf.animations) actions[c.name] = mixer.clipAction(c);
    loaded = true; spawn(); console.info("[Samurai] ready, clips:", Object.keys(actions).join(","));
  }
  load().catch((e) => console.warn("[Samurai] failed to load:", e));

  const agent = {
    root,
    get loaded() { return loaded; },
    get state() { return state; },
    env: { isAlive: () => alive, getEnemyPosition: () => eye, settings: { eyeHeight: C.eyeHeight } },
    update(delta = 1 / 60, enabled = true) {
      if (!loaded) return; const dt = Math.min(delta, 0.05); t += dt;
      if (flashLife > 0) { flashLife -= dt; flash.material.opacity = Math.max(0, flashLife / 0.16); }
      if (!alive) { deadFor += dt; if (deadFor > C.hideAfter) root.visible = false; if (deadFor > C.respawnAfter) spawn(); }
      else if (enabled) think(dt);
      root.position.copy(pos); root.rotation.y = yaw; eye.set(pos.x, pos.y + C.eyeHeight, pos.z); mixer.update(dt);
    },
    shootRay(ray, maxDist = 150) {
      if (!loaded || !alive || !root.visible) return null; let best = null;
      for (const [a, b, r] of CAPSULES) { const ba = bones[a], bb = bones[b]; if (!ba || !bb) continue; ba.getWorldPosition(A); bb.getWorldPosition(B);
        const d = rayCapsule(ray.origin, ray.direction, A, B, r * C.hitScale, maxDist); if (d >= 0 && (!best || d < best.distance)) best = { distance: d, part: a, point: ray.origin.clone().addScaledVector(ray.direction, d) }; }
      return best;
    },
    registerHit(hit) {
      if (!alive) return; const bullet = hit.part !== undefined; const p = hit.point ?? eye;
      if (state === "block") { spark(p); clang(dist2()); return; }
      const canDeflect = bullet && ["idle", "approach", "charge", "recover"].includes(state) && blockCd <= 0 && Math.random() < C.deflectChance;
      if (canDeflect) { startBlock(p); return; }
      kill(p);
    },
    applyDamage() { kill(eye); },
    respawn() { if (loaded) spawn(); },
    get deflects() { return deflects; },
  };

  function think(dt) {
    chargeCd -= dt; atkCd -= dt; blockCd -= dt; losT -= dt;
    const p = target(), dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz), ux = dx / (d || 1), uz = dz / (d || 1);
    if (losT <= 0) { losT = 0.25; const o = new THREE.Vector3(pos.x, pos.y + 1.5, pos.z); const dir = new THREE.Vector3(p.x - pos.x, camera.position.y - (pos.y + 1.5), p.z - pos.z); const L = dir.length(); raycaster.set(o, dir.normalize()); raycaster.near = 0; raycaster.far = L; raycaster.firstHitOnly = true; los = raycaster.intersectObjects(wallRoots, true).length === 0; }
    if (d < 1.3 && state !== "dead") move(dt, 2.2, -ux, -uz); // never stand inside the player
    if (state === "idle") { play("Idle"); if (d < C.aggro) state = "approach"; return; }
    if (state === "approach") {
      face(dt); const near = d <= C.chargeMin + 0.8;
      if (d > C.aggro * 1.4) { state = "idle"; return; }
      if (atkCd <= 0 && d <= C.chargeMin + 0.6 && Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw))) < 0.5) { pickAttack(d); return; }
      if (chargeCd <= 0 && los && d > C.chargeMin + 0.6 && d < C.chargeMax) { state = "charge"; chargeT = 0; return; }
      if (!near) { play("Walk", { timeScale: 1.4 }); move(dt, C.walkSpeed, Math.sin(yaw), Math.cos(yaw)); } else play("Idle");
      if (stuckT > 1.2) { stuckT = 0; chargeCd = 1.5; }
      return;
    }
    if (state === "charge") {
      face(dt, C.turnRate * 1.3); chargeT += dt; play("Run", { timeScale: 1.3 }); if (d > 1.6) move(dt, C.chargeSpeed, Math.sin(yaw), Math.cos(yaw));
      if (d <= C.chargeMin + 0.3 || chargeT > C.chargeMaxTime || !los && chargeT > 0.6) { chargeCd = C.chargeCooldown; if (d <= C.chargeMin + 1.2) pickAttack(d); else state = "approach"; }
      return;
    }
    if (state === "attack") {
      atk.t += dt; const k = atk.kind;
      if (atk.t < 0.35) face(dt, 2.5); // keeps aim while winding up, then commits
      if (k === "Dash" && atk.t > 0.18 && atk.t < 0.48 && d > 1.6) move(dt, 4.6, Math.sin(yaw), Math.cos(yaw));
      else if (atk.t > 0.4 && atk.t < 0.6 && k !== "Dash" && d > 1.6) move(dt, 1.2, Math.sin(yaw), Math.cos(yaw));
      if (!atk.snd && atk.t >= C.swing[k]) { atk.snd = true; swoosh(d); }
      const [w0, w1] = C.window[k];
      if (!atk.hit && atk.t >= w0 && atk.t <= w1) {
        const fx = Math.sin(yaw), fz = Math.cos(yaw); const cos = (dx * fx + dz * fz) / (d || 1);
        if (d <= C.reach[k] && cos > 0.35 && Math.abs(p.y - pos.y) < 2.4) { atk.hit = true; onPlayerHit(); }
      }
      if (atk.t >= atk.dur - 0.05) { state = "recover"; recoverT = 0.3; atk = null; play("Idle", { fade: 0.25 }); }
      return;
    }
    if (state === "recover") { recoverT -= dt; face(dt, 3); if (recoverT <= 0) state = "approach"; return; }
    if (state === "block") { blk.t += dt; face(dt, 4); if (blk.t >= 0.72) { state = "approach"; blk = null; play("Idle", { fade: 0.12 }); } return; }
  }
  function pickAttack(d) { comboSide++; const kind = d > 2.8 ? "Dash" : comboSide % 2 ? "Slash" : "Slash2"; startAttack(kind); }
  return agent;
}
