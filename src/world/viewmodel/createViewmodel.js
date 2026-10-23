import * as THREE from "three/webgpu";
import { positionView, uniform, smoothstep, select } from "three/tsl";
import { getGltfLoader } from "../loaders/createGltfLoaders.js";
import { createGunAudio } from "./createGunAudio.js";
import { createAmmoHud } from "./createAmmoHud.js";
import { WEAPONS, ORDER, SWING_PIVOT, buildWeapons, pistolShot, katanaSwoosh, meleeStrike, swingPose } from "./weapons.js"; // [weapons]

/**
 * First-person arms + VSK-94 (vsk.glb, "FPS animations VSK" by Cransh, CC-BY-4.0).
 *
 * The viewmodel lives in the scene (not as a camera child) because the post
 * stack renders from cloned cameras. Every frame the root is snapped to the
 * live camera pose, then the rig is offset so the eye sits behind the stock.
 *
 * Tuning: everything visual is in `viewmodelParams` — it is also exposed as
 * `window.__viewmodel.params` in dev so you can nudge it live.
 */

const MODEL_URL = "/models/vsk.glb";
const ARMS_MATERIAL_NAME = "Male_04_Animation_Ready.001";

const CLIPS = {
  idle: "Rig|VSK_Idle",
  walk: "Rig|VSK_Walk",
  run: "Rig|VSK_Run",
  sprint: "Rig|VSK_Sprint",
  fire: "Rig|VSK_Fire",
  reloadPartial: "Rig|VSK_ReloadNotFull",
  reloadEmpty: "Rig|VSK_ReloadFull",
};

export const viewmodelParams = {
  /** Rig origin relative to the camera (camera space, metres). */
  position: [0.0, -0.44, -0.46],
  /** Used when the camera FOV is wide (mobile portrait, FOV 100) so the cut upper-arm ends stay off-screen. */
  positionWide: [0.03, -0.6, -0.5],
  wideFov: 80,
  /**
   * The gun mesh in the source file is ~2.6x too large, faces the opposite
   * way to the arms and is upside down (magazine up). These correct it:
   * uniform scale, then 180deg about X (flips front/back AND up/down),
   * then this translation (rig space).
   */
  gunScale: 0.38,
  gunOffset: [0.0, 0.01, -0.07],
  /** Night scene has almost no ambient light — lift the albedo a little. */
  emissiveArms: 0.2,
  emissiveGun: 0.5,
  /** Muzzle flash position relative to the rig origin (rig space). */
  muzzle: [0.0, 0.196, -0.77],
  fireInterval: 0.11,
  magSize: 20,
  reserve: 120,
  walkSpeedMax: 4.8,
  runSpeedMax: 6.2,
  maxRange: 150,
};

const MOVE_THRESHOLD = 0.35;
const FADE = 0.18;

function makeFlashTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,240,200,1)");
  g.addColorStop(0.25, "rgba(255,190,90,0.85)");
  g.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The raw gun mesh needs scaling/flipping once, in bind space. */
function correctGunGeometry(scene) {
  const p = viewmodelParams;
  scene.updateMatrixWorld(true);

  const world = new THREE.Matrix4()
    .makeTranslation(...p.gunOffset)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
    .multiply(new THREE.Matrix4().makeScale(p.gunScale, p.gunScale, p.gunScale));

  scene.traverse((obj) => {
    if (!obj.isSkinnedMesh || obj.material?.name === ARMS_MATERIAL_NAME) {
      return;
    }

    // rest world = matrixWorld * v, so express the world-space fix in mesh space.
    const bind = obj.bindMatrix.clone();
    const fix = bind.clone().invert().multiply(world).multiply(bind);
    obj.geometry = obj.geometry.clone();
    obj.geometry.applyMatrix4(fix);
    obj.geometry.boundingBox = null;
    obj.geometry.boundingSphere = null;
  });
}

// Rig origin in camera space; drives the arm-end fade (see fadeOpenArmEnds).
const rigUniform = uniform(new THREE.Vector3());

/**
 * The arm mesh is cut open at the shoulders. Fade each arm out before its
 * open end so no hollow tube is ever visible (works at any FOV/aspect).
 * Thresholds are in model space along the arm (z, metres): the left arm's
 * opening sits at z ~ -0.03, the right arm's at z ~ -0.23.
 */
function fadeOpenArmEnds(renderer, mesh) {
  const nodeMat = renderer.library?.fromMaterial?.(mesh.material);
  if (!nodeMat) {
    return;
  }
  // View space == camera space; the rig is a pure offset (+ 180deg yaw).
  const zModel = positionView.z.negate().add(rigUniform.z);
  const xModel = rigUniform.x.sub(positionView.x);
  const left = smoothstep(0.1, 0.2, zModel);
  const right = smoothstep(-0.12, 0.0, zModel);
  nodeMat.opacityNode = select(xModel.greaterThan(-0.02), left, right);
  nodeMat.transparent = true;
  nodeMat.side = THREE.FrontSide;
  nodeMat.needsUpdate = true;
  mesh.material = nodeMat;
}

export async function createViewmodel({ scene, renderer, world }) {
  const gltf = await getGltfLoader(renderer).loadAsync(MODEL_URL);
  const model = gltf.scene;
  const p = viewmodelParams;

  correctGunGeometry(model);

  model.traverse((obj) => {
    if (!obj.isMesh) {
      return;
    }
    obj.frustumCulled = false;
    obj.castShadow = false;
    obj.receiveShadow = false;
    obj.renderOrder = 10;

    const mat = obj.material;
    if (mat?.map) {
      const isArms = mat.name === ARMS_MATERIAL_NAME;
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = isArms ? p.emissiveArms : p.emissiveGun;
      mat.needsUpdate = true;
      if (isArms) {
        try {
          fadeOpenArmEnds(renderer, obj);
        } catch (error) {
          console.warn("[viewmodel] arm fade unavailable:", error);
        }
      }
    }
  });

  // root follows the camera; rig holds the model + offset.
  const root = new THREE.Group();
  root.name = "viewmodel";
  const rig = new THREE.Group();
  rig.rotation.y = Math.PI; // source rig faces +Z, camera looks down -Z
  rig.add(model);
  root.add(rig);
  scene.add(root);

  // [weapons] pistol + katana ride on the rifle's animated bones (Body / Slider / Trigger)
  const rifleMeshes = [];
  const boneMap = {};
  model.traverse((o) => {
    if (o.isBone) boneMap[o.name] = o;
    if (o.isSkinnedMesh && o.material?.name !== ARMS_MATERIAL_NAME) rifleMeshes.push(o);
  });
  const wpn = buildWeapons(boneMap);
  let weapon = "rifle";
  const stash = { rifle: null, pistol: { ammo: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve } };
  const magOf = () => (weapon === "rifle" ? p.magSize : WEAPONS[weapon].magSize);

  // --- muzzle flash -------------------------------------------------------
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeFlashTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    }),
  );
  flash.scale.setScalar(0.45);
  flash.renderOrder = 11;
  root.add(flash);
  let flashLife = 0;

  // --- impact marks -------------------------------------------------------
  const impactGroup = new THREE.Group();
  impactGroup.name = "viewmodel-impacts";
  scene.add(impactGroup);

  const holeGeo = new THREE.CircleGeometry(0.045, 12);
  const sparkGeo = new THREE.CircleGeometry(0.09, 10);
  const holeMat = new THREE.MeshBasicMaterial({
    color: 0x050505,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const impacts = [];
  const MAX_IMPACTS = 24;
  let impactCursor = 0;

  function spawnImpact(point, normal) {
    let entry = impacts[impactCursor];
    if (!entry) {
      const hole = new THREE.Mesh(holeGeo, holeMat);
      const spark = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffb060,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      hole.frustumCulled = spark.frustumCulled = false;
      impactGroup.add(hole, spark);
      entry = { hole, spark, life: 0 };
      impacts[impactCursor] = entry;
    }
    impactCursor = (impactCursor + 1) % MAX_IMPACTS;

    const target = point.clone().addScaledVector(normal, 0.012);
    entry.hole.position.copy(target);
    entry.hole.lookAt(target.clone().add(normal));
    entry.hole.visible = true;
    entry.spark.position.copy(target).addScaledVector(normal, 0.01);
    entry.spark.lookAt(target.clone().add(normal));
    entry.spark.material.opacity = 1;
    entry.life = 0.14;
  }

  // --- animation ----------------------------------------------------------
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [key, name] of Object.entries(CLIPS)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) {
      console.warn(`[viewmodel] missing clip ${name}`);
      continue;
    }
    actions[key] = mixer.clipAction(clip);
  }

  for (const key of ["idle", "walk", "run", "sprint"]) {
    actions[key]?.setLoop(THREE.LoopRepeat, Infinity);
  }
  for (const key of ["fire", "reloadPartial", "reloadEmpty"]) {
    if (actions[key]) {
      actions[key].setLoop(THREE.LoopOnce, 1);
      actions[key].clampWhenFinished = true;
    }
  }
  if (actions.fire) {
    actions.fire.timeScale = 3.2;
  }

  let baseKey = "idle";
  actions.idle?.play();

  function setBase(key) {
    if (key === baseKey || !actions[key]) {
      return;
    }
    const prev = actions[baseKey];
    const next = actions[key];
    next.reset().fadeIn(FADE).play();
    prev?.fadeOut(FADE);
    baseKey = key;
  }

  // --- state --------------------------------------------------------------
  const state = {
    ammo: p.magSize,
    reserve: p.reserve,
    reloading: false,
    reloadAction: null,
    fireCooldown: 0,
    fireHold: 0,
    fireActive: false,
    triggerHeld: false,
    triggerEdge: false,
    swingT: -1,
    swingKind: 0,
    swingHit: false,
    drawT: 0,
    enabled: false,
  };

  const hud = createAmmoHud();
  const audio = createGunAudio();
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const centre = new THREE.Vector2(0, 0);
  const normalMatrix = new THREE.Matrix3();
  const hitNormal = new THREE.Vector3();

  function syncHud() {
    hud.set(state.ammo, state.reserve, state.reloading, WEAPONS[weapon].label, weapon === "katana");
  }
  syncHud();

  // [weapons] switching, katana swing, rig motion ---------------------------------
  function applyWeaponVisibility() {
    rifleMeshes.forEach((m) => (m.visible = weapon === "rifle"));
    wpn.pistol.visible = weapon === "pistol";
    wpn.katana.visible = weapon === "katana";
  }
  function selectWeapon(next) {
    if (!WEAPONS[next] || next === weapon) return;
    if (weapon !== "katana") stash[weapon] = { ammo: state.ammo, reserve: state.reserve };
    if (state.reloading) {
      state.reloadAction?.fadeOut(0.1);
      state.reloadAction = null;
      state.reloading = false;
    }
    if (state.fireActive) {
      actions.fire?.fadeOut(0.08);
      state.fireActive = false;
    }
    state.swingT = -1;
    state.triggerHeld = false;
    state.triggerEdge = false;
    weapon = next;
    if (next === "rifle") {
      const st = stash.rifle ?? { ammo: p.magSize, reserve: p.reserve };
      state.ammo = st.ammo;
      state.reserve = st.reserve;
    } else if (next === "pistol") {
      state.ammo = stash.pistol.ammo;
      state.reserve = stash.pistol.reserve;
    }
    applyWeaponVisibility();
    state.drawT = 0.24;
    audio.click(0.0);
    syncHud();
  }
  const cycleWeapon = () => selectWeapon(ORDER[(ORDER.indexOf(weapon) + 1) % ORDER.length]);
  function startSwing() {
    state.swingT = 0;
    state.swingKind ^= 1;
    state.swingHit = false;
    state.fireCooldown = WEAPONS.katana.cooldown;
    katanaSwoosh();
  }
  const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function applyRigMotion(delta, camera) {
    let dy = 0;
    if (state.drawT > 0) {
      state.drawT = Math.max(0, state.drawT - delta);
      const k = state.drawT / 0.24;
      dy = -0.22 * k * k;
    }
    if (state.swingT >= 0) {
      state.swingT += delta;
      if (!state.swingHit && state.swingT >= WEAPONS.katana.hitAt) {
        state.swingHit = true;
        meleeStrike(camera, world);
      }
      if (state.swingT >= WEAPONS.katana.duration) state.swingT = -1;
    }
    if (state.swingT >= 0) {
      const sp = swingPose(state.swingKind, state.swingT);
      _e.set(sp.r[0], sp.r[1], sp.r[2], "YXZ");
      _q.setFromEuler(_e);
      _v.copy(rig.position).sub(SWING_PIVOT).applyQuaternion(_q).add(SWING_PIVOT).add(_v2.set(sp.d[0], sp.d[1] + dy, sp.d[2]));
      rig.position.copy(_v);
      rig.quaternion.copy(_q).multiply(_qy);
    } else {
      rig.position.y += dy;
      rig.quaternion.copy(_qy);
    }
  }

  function fireRay(camera) {
    const targets = world?.focusTargets ?? [];
    if (!targets.length && !world?.enemyAI) {
      return;
    }
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(centre, camera);
    raycaster.far = p.maxRange;

    const hits = raycaster.intersectObjects(targets, true);
    const hit = hits[0];
    const eHit = world?.enemyAI?.shootRay?.(raycaster.ray, p.maxRange); // [combat]
    if (eHit && (!hit || eHit.distance < hit.distance)) {
      world.enemyAI.registerHit(eHit);
      return;
    }
    if (!hit?.face) {
      return;
    }
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    hitNormal.copy(hit.face.normal).applyNormalMatrix(normalMatrix).normalize();
    spawnImpact(hit.point, hitNormal);
  }

  function shoot(camera) {
    state.ammo -= 1;
    state.fireCooldown = weapon === "pistol" ? WEAPONS.pistol.fireInterval : p.fireInterval;
    state.fireHold = weapon === "pistol" ? WEAPONS.pistol.fireHold : 0.28;
    state.fireActive = true;

    const fire = actions.fire;
    if (fire) {
      fire.reset();
      fire.setEffectiveTimeScale(weapon === "pistol" ? 2.4 : 1);
      fire.setEffectiveWeight(1);
      fire.fadeIn(0.02);
      fire.play();
    }

    flash.material.opacity = 1;
    flash.material.rotation = Math.random() * Math.PI * 2;
    flash.scale.setScalar(0.35 + Math.random() * 0.2);
    flashLife = 0.05;

    if (weapon === "pistol") pistolShot();
    else audio.shot();
    fireRay(camera);
    syncHud();

    if (state.ammo <= 0) {
      startReload();
    }
  }

  function startReload() {
    if (weapon === "katana" || state.reloading || state.reserve <= 0 || state.ammo >= magOf()) {
      return;
    }
    const action = state.ammo === 0 ? actions.reloadEmpty : actions.reloadPartial;
    if (!action) {
      return;
    }

    state.reloading = true;
    state.reloadAction = action;
    state.triggerHeld = false;
    if (state.fireActive) {
      actions.fire?.fadeOut(0.08);
      state.fireActive = false;
    }

    action.reset();
    action.setEffectiveWeight(1);
    action.fadeIn(0.15);
    action.play();
    audio.click(0.0);
    syncHud();
  }

  mixer.addEventListener("finished", (event) => {
    if (event.action !== state.reloadAction) {
      return;
    }
    event.action.fadeOut(0.2);
    state.reloadAction = null;
    state.reloading = false;

    const need = magOf() - state.ammo;
    const taken = Math.min(need, state.reserve);
    state.ammo += taken;
    state.reserve -= taken;
    audio.click(0.0);
    syncHud();
  });

  // --- input --------------------------------------------------------------
  let walkControlsRef = null;

  function onMouseDown(event) {
    if (event.button !== 0 || !state.enabled) {
      return;
    }
    // First click only grabs pointer lock; shoot once it's already locked.
    if (walkControlsRef?.isPointerLocked?.()) {
      state.triggerHeld = true;
      state.triggerEdge = true;
    }
  }
  function onMouseUp(event) {
    if (event.button === 0) {
      state.triggerHeld = false;
    }
  }
  function onKeyDown(event) {
    if (event.code === "KeyR" && state.enabled && !event.repeat) {
      startReload();
    }
    if (state.enabled && !event.repeat) {
      if (event.code === "Digit1") selectWeapon("rifle");
      else if (event.code === "Digit2") selectWeapon("pistol");
      else if (event.code === "Digit3") selectWeapon("katana");
      else if (event.code === "KeyQ") cycleWeapon();
    }
  }
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", onKeyDown);

  hud.bindTouch({
    onFireDown: () => {
      if (state.enabled) {
        state.triggerHeld = true;
        state.triggerEdge = true;
      }
    },
    onFireUp: () => {
      state.triggerHeld = false;
    },
    onReload: () => {
      if (state.enabled) {
        startReload();
      }
    },
    onSwap: () => {
      if (state.enabled) {
        cycleWeapon();
      }
    },
  });

  // --- per-frame ----------------------------------------------------------
  const HIDDEN_Y = -2000;

  function update(delta, { camera, walkControls, enabled }) {
    walkControlsRef = walkControls;
    const walking = Boolean(walkControls?.isActive?.());
    const wasEnabled = state.enabled;
    state.enabled = Boolean(enabled && walking);
    hud.setVisible(state.enabled);

    if (!state.enabled) {
      state.triggerHeld = false;
      // Park far away rather than visible=false so shaders still pre-compile.
      root.position.set(0, HIDDEN_Y, 0);
      return;
    }
    if (!wasEnabled) {
      mixer.update(0);
    }

    // Snap to the live camera, then apply the rig offset in camera space.
    root.position.copy(camera.position);
    root.quaternion.copy(camera.quaternion);
    root.scale.setScalar(1);
    const wide = camera.fov > p.wideFov;
    rig.position.set(...(wide ? p.positionWide : p.position));
    applyRigMotion(delta, camera); // [weapons] draw animation + katana swing
    rigUniform.value.copy(rig.position);
    const mz = weapon === "pistol" ? WEAPONS.pistol.muzzle : p.muzzle;
    flash.position.set(rig.position.x + mz[0], rig.position.y + mz[1], rig.position.z + mz[2]);

    // Locomotion.
    const speed = walkControls?.getHorizontalSpeed?.() ?? 0;
    let key = "idle";
    if (speed > MOVE_THRESHOLD) {
      key = speed < p.walkSpeedMax ? "walk" : speed < p.runSpeedMax ? "run" : "sprint";
    }
    setBase(key);

    // Firing.
    state.fireCooldown = Math.max(0, state.fireCooldown - delta);
    if (weapon === "katana") {
      if (state.triggerHeld && state.fireCooldown <= 0 && state.swingT < 0) startSwing();
    } else if (
      state.triggerHeld &&
      !state.reloading &&
      state.ammo > 0 &&
      state.fireCooldown <= 0 &&
      (weapon === "rifle" || state.triggerEdge)
    ) {
      state.triggerEdge = false;
      shoot(camera);
    }
    if (state.fireActive) {
      state.fireHold -= delta;
      if (state.fireHold <= 0) {
        actions.fire?.fadeOut(0.15);
        state.fireActive = false;
      }
    }

    if (weapon === "pistol") {
      const ra = state.reloadAction;
      const pr = state.reloading && ra ? ra.time / (ra.getClip().duration || 1) : 0;
      wpn.pistolMag.visible = !(pr > 0.18 && pr < 0.72); // mag out while reloading
    }

    mixer.update(delta);

    // Flash + impacts fade.
    if (flashLife > 0) {
      flashLife -= delta;
      if (flashLife <= 0) {
        flash.material.opacity = 0;
      }
    }
    for (const entry of impacts) {
      if (entry?.life > 0) {
        entry.life -= delta;
        entry.spark.material.opacity = Math.max(0, entry.life / 0.14);
      }
    }
  }

  function dispose() {
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    hud.destroy();
    audio.dispose();
    scene.remove(root, impactGroup);
    mixer.stopAllAction();
  }

  const api = {
    root,
    hideObjects: [root, impactGroup],
    params: viewmodelParams,
    state,
    update,
    reload: startReload,
    selectWeapon,
    cycleWeapon,
    get weapon() {
      return weapon;
    },
    refill() {
      stash.rifle = null;
      stash.pistol = { ammo: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve };
      state.ammo = magOf();
      state.reserve = weapon === "rifle" ? p.reserve : weapon === "pistol" ? WEAPONS.pistol.reserve : 0;
      state.reloading = false;
      syncHud();
    },
    dispose,
  };

  if (import.meta.env?.DEV) {
    window.__viewmodel = api;
  }

  return api;
}
