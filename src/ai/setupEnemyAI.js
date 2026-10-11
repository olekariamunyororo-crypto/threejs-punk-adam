/**
 * Wires EnemyTrainingEnv into the existing Threejs-Punk bootstrap
 * and loads Adam Smasher (adam_smasher_rigged.glb) as the visible enemy NPC.
 *
 * Behavior:
 * - Loads the GLB with GLTFLoader (same path style as the rest of the project)
 * - Adds it to the scene as AdamSmasher_Enemy
 * - Every frame (enemyAI.update(delta)) the model follows the training-env position + yaw
 * - If the GLB contains Idle / Walk clips they cross-fade when the agent moves
 * - Falls back to a red capsule until the GLB finishes loading
 * - Exposes applyDamage(amount) so the player can hit him later
 *
 * Call after createWorld() + buildModelBvh() and after the camera director
 * has a live camera (walk mode preferred).
 *
 * Gate with FEATURES.trainEnemies.
 * Optional: npm install ignitionai  (for training / inference)
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EnemyTrainingEnv } from "./EnemyTrainingEnv.js";

const ADAM_SMASHER_URL = "/models/adam_smasher_rigged.glb";

/**
 * @param {object} opts
 * @param {THREE.Camera} opts.camera
 * @param {THREE.Object3D[]} opts.colliders  meshes that already have boundsTree
 * @param {THREE.Object3D|null} opts.ground
 * @param {THREE.Object3D|null} opts.model   city root (ground probes)
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Vector3[]} [opts.spawnPoints]
 * @param {boolean} [opts.autoTrain=false]
 * @param {object} [opts.gltfLoader]  optional shared loader from createGltfLoaders
 * @returns {object} API handle
 */
export function setupEnemyAI({
  camera,
  colliders = [],
  ground = null,
  model = null,
  scene = null,
  spawnPoints = [],
  autoTrain = false,
  gltfLoader = null,
} = {}) {
  const trainingEnv = new EnemyTrainingEnv({
    camera,
    colliders,
    ground,
    model,
    spawnPoints,
  });

  let ignition = null;
  let enemyRoot = null;
  let mixer = null;
  let actions = {};
  let currentAction = null;
  let loadPromise = null;
  let fallbackMesh = null;

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

      root.scale.setScalar(1);
      root.rotation.y = 0;

      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      if (gltf.animations?.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        for (const clip of gltf.animations) {
          const name = clip.name || `clip_${Object.keys(actions).length}`;
          actions[name] = mixer.clipAction(clip);
        }
        const preferred =
          actions.Idle ||
          actions.idle ||
          actions.Walk ||
          actions.walk ||
          actions[Object.keys(actions)[0]];
        if (preferred) {
          preferred.play();
          currentAction = preferred;
        }
        console.info("[EnemyAI] Adam Smasher animations:", Object.keys(actions));
      } else {
        console.info("[EnemyAI] Adam Smasher loaded (no animations in GLB)");
      }

      if (scene) {
        scene.add(root);
      }

      enemyRoot = root;

      if (fallbackMesh) {
        fallbackMesh.visible = false;
      }

      syncEnemyVisual(0);
      return root;
    })();

    return loadPromise;
  }

  function syncEnemyVisual(delta = 1 / 60) {
    if (!enemyRoot) return;

    const pos = trainingEnv.getEnemyPosition();
    const yaw = trainingEnv.getEnemyYaw();
    const alive = trainingEnv.isAlive();

    enemyRoot.position.copy(pos);
    enemyRoot.rotation.y = yaw;
    enemyRoot.visible = alive;

    if (mixer) {
      mixer.update(delta);
    }

    const walkClip = actions.Walk || actions.walk;
    const idleClip = actions.Idle || actions.idle;
    if (walkClip || idleClip) {
      const moving =
        trainingEnv._lastAction === "forward" ||
        trainingEnv._lastAction === "back" ||
        trainingEnv._lastAction === "strafe_left" ||
        trainingEnv._lastAction === "strafe_right";

      if (moving && walkClip && currentAction !== walkClip) {
        currentAction?.fadeOut(0.2);
        walkClip.reset().fadeIn(0.2).play();
        currentAction = walkClip;
      } else if (!moving && idleClip && currentAction !== idleClip) {
        currentAction?.fadeOut(0.2);
        idleClip.reset().fadeIn(0.2).play();
        currentAction = idleClip;
      }
    }
  }

  function ensureFallback(sceneRef) {
    if (fallbackMesh || enemyRoot || !sceneRef) return fallbackMesh;

    const geo = new THREE.CapsuleGeometry(0.35, 1.0, 4, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2244,
      transparent: true,
      opacity: 0.5,
    });
    fallbackMesh = new THREE.Mesh(geo, mat);
    fallbackMesh.name = "EnemyAI_Fallback";
    sceneRef.add(fallbackMesh);
    return fallbackMesh;
  }

  function syncFallback() {
    if (!fallbackMesh) return;
    if (enemyRoot) {
      fallbackMesh.visible = false;
      return;
    }
    const pos = trainingEnv.getEnemyPosition();
    fallbackMesh.position.copy(pos);
    fallbackMesh.rotation.y = trainingEnv.getEnemyYaw();
    fallbackMesh.visible = trainingEnv.isAlive();
  }

  async function startTraining(algorithm = "dqn") {
    try {
      const { IgnitionEnvTFJS } = await import("ignitionai");
      ignition = new IgnitionEnvTFJS(trainingEnv);
      if (typeof ignition.setSpeed === "function") {
        ignition.setSpeed(20);
      }
      ignition.train(algorithm);
      console.info(`[EnemyAI] Training started (${algorithm})`);
      return ignition;
    } catch (err) {
      console.warn(
        "[EnemyAI] ignitionai not installed. Run: npm install ignitionai\n",
        err?.message ?? err,
      );
      return null;
    }
  }

  async function startInference() {
    try {
      const { IgnitionEnvTFJS } = await import("ignitionai");
      if (!ignition) {
        ignition = new IgnitionEnvTFJS(trainingEnv);
      }
      if (typeof ignition.infer === "function") {
        ignition.infer();
      }
      console.info("[EnemyAI] Switched to inference mode");
      return ignition;
    } catch (err) {
      console.warn("[EnemyAI] ignitionai not available:", err?.message ?? err);
      return null;
    }
  }

  if (scene) {
    ensureFallback(scene);
  }

  loadEnemyModel().catch((err) => {
    console.error("[EnemyAI] Failed to load Adam Smasher:", err);
  });

  if (autoTrain) {
    startTraining("dqn");
  }

  return {
    env: trainingEnv,
    get ignition() {
      return ignition;
    },
    get enemyRoot() {
      return enemyRoot;
    },
    loadEnemyModel,
    startTraining,
    startInference,
    /** Call every frame: updates position, yaw, animations, fallback */
    update(delta = 1 / 60) {
      syncEnemyVisual(delta);
      syncFallback();
    },
    ensureFallback,
    /** Damage the NPC from the player (hitscan / projectile) */
    applyDamage(amount) {
      trainingEnv.applyDamage(amount);
    },
  };
}
