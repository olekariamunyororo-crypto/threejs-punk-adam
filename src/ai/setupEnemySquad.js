/**
 * Multiple Adam Smasher NPCs that attack the player from around the alley.
 *
 * Loads the GLB once, clones with SkeletonUtils for each agent,
 * spreads home positions so they approach from different directions.
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SkeletonUtils } from "three/addons/utils/SkeletonUtils.js";
import { setupEnemyAI } from "./setupEnemyAI.js";
import { QUADRA_START } from "../world/car/loadCar.js";
import { FREE_CAMERA_START } from "../bootstrap/createCamera.js";

const ADAM_URL = "/models/adam_smasher_rigged.glb?v=1791744626827";

/**
 * 6 home positions around player start + car so enemies pressure from all sides.
 * Y is eye-ish; TrainingEnv snaps to ground on reset.
 */
export function buildAlleySpawnHomes() {
  const car = QUADRA_START.position;
  const player = FREE_CAMERA_START.position;
  const y = car[1] + 1.6;

  return [
    // near car (original flank)
    new THREE.Vector3(car[0] + 3.5, y, car[2] + 2.5),
    // opposite side of car
    new THREE.Vector3(car[0] - 4, y, car[2] - 2),
    // further down the alley (+Z from player)
    new THREE.Vector3(player[0] + 8, y, player[2] + 18),
    // street side toward buildings (-X)
    new THREE.Vector3(player[0] - 12, y, player[2] + 6),
    // past the car deeper alley
    new THREE.Vector3(car[0] + 14, y, car[2] + 8),
    // behind / toward player start
    new THREE.Vector3(player[0] + 2, y, player[2] - 8),
  ];
}

/**
 * @param {object} opts — same world wiring as setupEnemyAI, plus count
 * @param {number} [opts.count=6]
 */
export async function setupEnemySquad({
  camera,
  scene,
  colliders = [],
  ground = null,
  model = null,
  count = 6,
  modelScale = 1,
  onPlayerHit = () => {},
  getPlayerSpeed = () => 0,
  gltfLoader = null,
} = {}) {
  const homes = buildAlleySpawnHomes().slice(0, Math.max(1, count));

  // Load GLB once
  const loader = gltfLoader ?? new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      ADAM_URL,
      resolve,
      undefined,
      (err) => reject(err ?? new Error("Failed to load Adam Smasher")),
    );
  });

  console.info(
    `[EnemySquad] loaded Adam once → cloning ${homes.length} agents`,
  );

  const agents = homes.map((home, i) => {
    // Local patrol ring around this home so they don't all share one path
    const patrol = [
      home.clone(),
      home.clone().add(new THREE.Vector3(3.5, 0, 1.5)),
      home.clone().add(new THREE.Vector3(-2.5, 0, 3)),
      home.clone().add(new THREE.Vector3(1, 0, -3.5)),
    ];

    const agent = setupEnemyAI({
      camera,
      scene,
      colliders,
      ground,
      model,
      spawnPoints: patrol,
      autoTrain: false,
      modelScale,
      enableBrain: true,
      onPlayerHit,
      getPlayerSpeed,
      preloadedGltf: gltf,
      instanceName: `AdamSmasher_Enemy_${i}`,
      // Stagger first awareness slightly so they don't all fire same frame
      brainDelay: i * 0.35,
    });

    // Force initial pose to this home (reset already ran with random pick)
    agent.env.enemy.position.copy(home);
    agent.env.enemy.yaw = Math.random() * Math.PI * 2;
    agent.env.lastDistance = home.distanceTo(camera.position);
    agent.respawn = () => {
      agent.env.reset();
      agent.env.enemy.position.copy(home);
      agent.env.enemy.health = 100;
      agent.env.enemy.alive = true;
    };

    return agent;
  });

  return {
    agents,
    get length() {
      return agents.length;
    },
    update(delta = 1 / 60, enabled = true) {
      for (const a of agents) a.update(delta, enabled);
    },
    /** Closest living enemy hit along the ray, or null. */
    shootRay(ray, maxDist = 150) {
      let best = null;
      let bestAgent = null;
      for (const a of agents) {
        const h = a.shootRay(ray, maxDist);
        if (h && (!best || h.distance < best.distance)) {
          best = h;
          bestAgent = a;
        }
      }
      if (best && bestAgent) best._agent = bestAgent;
      return best;
    },
    registerHit(hit) {
      const agent = hit?._agent;
      if (agent) {
        agent.registerHit(hit);
        return;
      }
      // Fallback: damage nearest living enemy to the hit point
      if (!hit?.point) return;
      let nearest = null;
      let nearestD = Infinity;
      for (const a of agents) {
        if (!a.env?.isAlive?.()) continue;
        const d = a.env.getEnemyPosition().distanceTo(hit.point);
        if (d < nearestD) {
          nearestD = d;
          nearest = a;
        }
      }
      nearest?.registerHit(hit);
    },
    respawn() {
      for (const a of agents) a.respawn();
    },
    applyDamage(amount) {
      // debug: damage first living
      for (const a of agents) {
        if (a.env?.isAlive?.()) {
          a.applyDamage(amount);
          break;
        }
      }
    },
  };
}
