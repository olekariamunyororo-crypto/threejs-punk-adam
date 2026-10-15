/**
 * Adam Smasher enemy NPC + simple patrol / chase / attack AI.
 *
 * - Loads /models/adam_smasher_rigged.glb
 * - Feet snapped to ground (no floating)
 * - Autonomous brain: patrol → chase player → face & attack
 * - Idle / Walk animation cross-fade when clips exist
 * - IgnitionAI optional (not required for movement)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EnemyTrainingEnv } from "./EnemyTrainingEnv.js";
import { createEnemyCombat } from "./enemyCombat.js"; // [combat]
import { capTextureSize } from "../world/textureBudget.js"; // [gpu]

const RESPAWN_AFTER_S = 15; // enemy comes back this long after dying
const PLAYER_DAMAGE = 100; // one hit kills him

const ADAM_SMASHER_URL = "/models/adam_smasher_rigged.glb?v=1791744626827";

async function loadIgnitionAI() {
  const name = ["ignition", "ai"].join("");
  return import(/* @vite-ignore */ name);
}

/**
 * Simple finite-state brain (no RL package needed).
 * States: patrol | chase | attack
 */
function createEnemyBrain(env, {
  chaseRange = 22,
  attackRange = 12,
  loseRange = 32,
} = {}) {
  let state = "patrol";
  let patrolIndex = 0;
  let repathTimer = 0;

  function pickAction(delta) {
    const player = env.camera.position;
    const me = env.enemy.position;
    const dx = player.x - me.x;
    const dz = player.z - me.z;
    const dist = Math.hypot(dx, dz);

    const desiredYaw = Math.atan2(dx, -dz);
    let yawErr = desiredYaw - env.enemy.yaw;
    while (yawErr > Math.PI) yawErr -= Math.PI * 2;
    while (yawErr < -Math.PI) yawErr += Math.PI * 2;

    if (state === "patrol" && dist < chaseRange) state = "chase";
    if (state === "chase" && dist < attackRange) state = "attack";
    if (state === "chase" && dist > loseRange) state = "patrol";
    if (state === "attack" && dist > attackRange * 1.35) state = "chase";
    if (state === "attack" && dist > loseRange) state = "patrol";

    const TURN_THRESH = 0.25;
    if (state !== "patrol" && Math.abs(yawErr) > TURN_THRESH) {
      return yawErr > 0 ? "turn_left" : "turn_right";
    }

    if (state === "attack") {
      if (Math.abs(yawErr) < 0.35 && env.enemy.shootCooldown <= 0) {
        return "shoot";
      }
      repathTimer -= delta;
      if (repathTimer <= 0) {
        repathTimer = 0.6 + Math.random() * 0.5;
        return Math.random() > 0.5 ? "strafe_left" : "strafe_right";
      }
      return "idle";
    }

    if (state === "chase") {
      return "forward";
    }

    const points = env.spawnPoints;
    if (!points.length) return "forward";

    const target = points[patrolIndex % points.length];
    const pdx = target.x - me.x;
    const pdz = target.z - me.z;
    const pdist = Math.hypot(pdx, pdz);

    if (pdist < 1.5) {
      patrolIndex = (patrolIndex + 1) % points.length;
      return "idle";
    }

    const patrolYaw = Math.atan2(pdx, -pdz);
    let perr = patrolYaw - env.enemy.yaw;
    while (perr > Math.PI) perr -= Math.PI * 2;
    while (perr < -Math.PI) perr += Math.PI * 2;

    if (Math.abs(perr) > TURN_THRESH) {
      return perr > 0 ? "turn_left" : "turn_right";
    }
    return "forward";
  }

  return {
    get state() {
      return state;
    },
    pickAction,
  };
}

export function setupEnemyAI({
  camera,
  colliders = [],
  ground = null,
  model = null,
  scene = null,
  spawnPoints = [],
  autoTrain = false,
  modelScale = 1,
  feetOffset = 0,
  gltfLoader = null,
  enableBrain = true,
  onPlayerHit = () => {},
  getPlayerSpeed = () => 0,
} = {}) {
  const trainingEnv = new EnemyTrainingEnv({
    camera,
    colliders,
    ground,
    model,
    spawnPoints,
  });

  trainingEnv.reset();

  const combat = createEnemyCombat({ scene, camera, getPlayerSpeed, onPlayerHit });
  const tryShootOrig = trainingEnv._tryShoot.bind(trainingEnv);
  trainingEnv._tryShoot = function () {
    const ready = this.enemy.shootCooldown <= 0;
    tryShootOrig();
    if (ready && this._hitPlayerThisStep) combat.fire();
  };

  const brain = enableBrain ? createEnemyBrain(trainingEnv) : null;

  let ignition = null;
  let enemyRoot = null;
  let mixer = null;
  let actions = {};
  let currentAction = null;
  let loadPromise = null;
  let fallbackMesh = null;
  let deadFor = 0;
  let movingFor = 0;

  const eyeHeight = trainingEnv.settings.eyeHeight;

  async function loadEnemyModel() {
    if (enemyRoot) return enemyRoot;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const loader = gltfLoader ?? new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          ADAM_SMASHER_URL,
          resolve,
          undefined,
          (err) => reject(err ?? new Error("Failed to load Adam Smasher")),
        );
      });

      const root = gltf.scene;
      root.name = "AdamSmasher_Enemy";
      root.scale.setScalar(modelScale);

      root.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const minY = bbox.min.y;

      root.userData.pivotToFeet = -minY * modelScale;
      root.userData.modelHeight = size.y * modelScale;

      console.info(
        "[EnemyAI] model size",
        size.x.toFixed(2),
        size.y.toFixed(2),
        size.z.toFixed(2),
        "pivotToFeet",
        root.userData.pivotToFeet.toFixed(2),
      );

      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = true;
        }
      });

      if (gltf.animations?.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        for (const clip of gltf.animations) {
          const name = clip.name || `clip_${Object.keys(actions).length}`;
          const action = mixer.clipAction(clip);
          action.enabled = true;
          actions[name] = action;
          actions[name.toLowerCase()] = action;
        }
        // [aim] right arm + spine + head aim; legs, hips and left arm keep walking
        const AIM = /^(Spine\d*|Neck|Head|HeadTop|RightShoulder|RightArm|RightForeArm|RightHand)\./;
        const subClip = (name, aimPart) => {
          const src = gltf.animations.find((c) => c.name === name);
          if (!src) return null;
          const tracks = src.tracks.filter((t) => AIM.test(t.name) === aimPart);
          if (!tracks.length) return null;
          return mixer.clipAction(new THREE.AnimationClip(name + (aimPart ? "_aim" : "_body"), src.duration, tracks));
        };
        actions.AttackAim = subClip("Attack", true);
        actions.WalkBody = subClip("Walk", false);
        actions.IdleBody = subClip("Idle", false);
        console.info(
          "[EnemyAI] animations:",
          Object.keys(actions).filter((k, i, a) => a.indexOf(k) === i),
        );

        const preferred =
          actions.Idle ||
          actions.idle ||
          actions.TPose ||
          actions[Object.keys(actions)[0]];
        if (preferred) {
          preferred.reset().play();
          currentAction = preferred;
        }
      } else {
        console.info("[EnemyAI] no animations in GLB — static mesh");
      }

      capTextureSize(root, 1024); // [gpu] 2048px maps -> 1024px (4x less VRAM per Adam)
      if (scene) scene.add(root);
      enemyRoot = root;
      combat.attach(root);

      if (fallbackMesh) fallbackMesh.visible = false;

      syncEnemyVisual(0);
      console.info(
        "[EnemyAI] spawned at",
        trainingEnv.getEnemyPosition().toArray().map((n) => +n.toFixed(2)),
        "brain",
        brain?.state,
      );
      return root;
    })();

    return loadPromise;
  }

  function playClip(next) {
    if (!next || currentAction === next) return;
    if (currentAction) {
      currentAction.fadeOut(0.2);
    }
    next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    currentAction = next;
  }

  let upperAction = null; // [aim]
  function playUpper(next) {
    if (upperAction === next) return;
    if (upperAction) upperAction.fadeOut(0.2);
    if (next) next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    upperAction = next;
  }

  function syncEnemyVisual(delta = 1 / 60) {
    if (!enemyRoot) return;

    const pos = trainingEnv.getEnemyPosition();
    const yaw = trainingEnv.getEnemyYaw();
    const alive = trainingEnv.isAlive();

    const feetY = pos.y - eyeHeight + feetOffset;
    const pivotLift = enemyRoot.userData.pivotToFeet ?? 0;

    enemyRoot.position.set(pos.x, feetY + pivotLift, pos.z);
    enemyRoot.rotation.y = Math.PI - yaw;
    if (alive) deadFor = 0;
    else deadFor += delta;
    enemyRoot.visible = alive || deadFor < 4;

    if (mixer) mixer.update(delta);

    const moving =
      trainingEnv._lastAction === "forward" ||
      trainingEnv._lastAction === "back" ||
      trainingEnv._lastAction === "strafe_left" ||
      trainingEnv._lastAction === "strafe_right";

    const A = (n) => actions[n] || actions[n.toLowerCase()];
    const idleClip = A("Idle") || actions.TPose || actions.Stand;
    const walkClip = A("Walk") || actions.Walking || A("Run") || actions.locomotion;
    const runClip = A("Run") || walkClip;
    const attackClip = A("Attack");
    const dieClip = A("Die");
    const state = ignition ? undefined : brain?.state;

    movingFor = moving ? 0.25 : Math.max(0, movingFor - delta);
    const moved = movingFor > 0;

    let want = idleClip;
    let upper = null;
    if (!alive) want = dieClip || idleClip;
    else if (state === "attack" && attackClip) {
      if (actions.AttackAim && actions.WalkBody && actions.IdleBody) {
        want = moved ? actions.WalkBody : actions.IdleBody;
        upper = actions.AttackAim;
      } else want = attackClip;
    }
    else if (moved) want = state === "chase" ? runClip : walkClip;
    if (dieClip && want === dieClip) {
      dieClip.setLoop(THREE.LoopOnce, 1);
      dieClip.clampWhenFinished = true;
    }
    if (want) playClip(want);
    playUpper(upper);
  }

  function ensureFallback(sceneRef) {
    if (fallbackMesh || enemyRoot || !sceneRef) return fallbackMesh;
    const geo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2244,
      transparent: true,
      opacity: 0.85,
    });
    fallbackMesh = new THREE.Mesh(geo, mat);
    fallbackMesh.name = "EnemyAI_Fallback";
    sceneRef.add(fallbackMesh);
    syncFallback();
    return fallbackMesh;
  }

  function syncFallback() {
    if (!fallbackMesh) return;
    if (enemyRoot) {
      fallbackMesh.visible = false;
      return;
    }
    const pos = trainingEnv.getEnemyPosition();
    fallbackMesh.position.set(pos.x, pos.y - eyeHeight * 0.5, pos.z);
    fallbackMesh.rotation.y = trainingEnv.getEnemyYaw();
    fallbackMesh.visible = trainingEnv.isAlive();
  }

  function tickBrain(delta) {
    if (!brain || !trainingEnv.isAlive()) return;
    if (ignition) return;

    const actionName = brain.pickAction(delta);
    trainingEnv.settings.moveSpeed = brain.state === "chase" ? 3.9 : 1.8;
    const idx = trainingEnv.actions.indexOf(actionName);
    trainingEnv.step(idx >= 0 ? idx : trainingEnv.actions.indexOf("idle"));
  }

  async function startTraining(algorithm = "dqn") {
    try {
      const mod = await loadIgnitionAI();
      const { IgnitionEnvTFJS } = mod;
      ignition = new IgnitionEnvTFJS(trainingEnv);
      ignition.setSpeed?.(20);
      ignition.train(algorithm);
      console.info(`[EnemyAI] Training started (${algorithm})`);
      return ignition;
    } catch (err) {
      console.warn("[EnemyAI] ignitionai optional — using built-in brain", err?.message);
      return null;
    }
  }

  async function startInference() {
    try {
      const mod = await loadIgnitionAI();
      if (!ignition) ignition = new mod.IgnitionEnvTFJS(trainingEnv);
      ignition.infer?.();
      return ignition;
    } catch (err) {
      console.warn("[EnemyAI] ignitionai not available", err?.message);
      return null;
    }
  }

  if (scene) ensureFallback(scene);

  loadEnemyModel().catch((err) => {
    console.error("[EnemyAI] Failed to load Adam Smasher:", err);
  });

  if (autoTrain) startTraining("dqn");

  return {
    env: trainingEnv,
    brain,
    get ignition() {
      return ignition;
    },
    get enemyRoot() {
      return enemyRoot;
    },
    loadEnemyModel,
    startTraining,
    startInference,
    update(delta = 1 / 60, enabled = true) {
      if (enabled && enemyRoot) tickBrain(delta);
      syncEnemyVisual(delta);
      syncFallback();
      combat.update(delta);
      if (enemyRoot && !trainingEnv.isAlive() && deadFor > RESPAWN_AFTER_S) {
        trainingEnv.reset();
      }
    },
    shootRay(ray, maxDist) {
      return enemyRoot && trainingEnv.isAlive()
        ? combat.shootRay(ray, maxDist)
        : null;
    },
    registerHit(hit) {
      combat.spark(hit.point);
      trainingEnv.applyDamage(PLAYER_DAMAGE);
    },
    respawn() {
      trainingEnv.reset();
    },
    ensureFallback,
    applyDamage(amount) {
      trainingEnv.applyDamage(amount);
    },
  };
}
