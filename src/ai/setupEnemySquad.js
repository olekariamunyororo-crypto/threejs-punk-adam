/**
 * Multiple Adam Smasher NPCs — attack from around the alley.
 *
 * Non-blocking: returns a squad API immediately; GLB loads in the background.
 * Until agents are ready, update/shootRay are no-ops.
 */

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupEnemyAI } from "./setupEnemyAI.js";
import { QUADRA_START } from "../world/car/loadCar.js";
import { FREE_CAMERA_START } from "../bootstrap/createCamera.js";

const ADAM_URL = "/models/adam_smasher_rigged.glb?v=1791744626827";

export function buildAlleySpawnHomes() {
  const car = QUADRA_START.position;
  const player = FREE_CAMERA_START.position;
  const y = car[1] + 1.6;

  return [
    new THREE.Vector3(car[0] + 3.5, y, car[2] + 2.5),
    new THREE.Vector3(car[0] - 4, y, car[2] - 2),
    new THREE.Vector3(player[0] + 8, y, player[2] + 18),
    new THREE.Vector3(player[0] - 12, y, player[2] + 6),
    new THREE.Vector3(car[0] + 14, y, car[2] + 8),
    new THREE.Vector3(player[0] + 2, y, player[2] - 8),
  ];
}

/**
 * Synchronous setup — scene keeps loading while Adam GLB downloads.
 */
export function setupEnemySquad({
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
  /** @type {ReturnType<typeof setupEnemyAI>[]} */
  const agents = [];
  let ready = false;

  const squad = {
    agents,
    get length() {
      return agents.length;
    },
    get ready() {
      return ready;
    },
    update(delta = 1 / 60, enabled = true) {
      for (const a of agents) a.update(delta, enabled);
    },
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
      if (hit?._agent) {
        hit._agent.registerHit(hit);
        return;
      }
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
      for (const a of agents) {
        if (a.env?.isAlive?.()) {
          a.applyDamage(amount);
          break;
        }
      }
    },
  };

  // Background load — never blocks the render loop / intro
  (async () => {
    try {
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

      for (let i = 0; i < homes.length; i += 1) {
        const home = homes[i];
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
          brainDelay: i * 0.35,
        });

        agent.env.enemy.position.copy(home);
        agent.env.enemy.yaw = Math.random() * Math.PI * 2;
        agent.env.lastDistance = home.distanceTo(camera.position);
        const homeCopy = home.clone();
        agent.respawn = () => {
          agent.env.reset();
          agent.env.enemy.position.copy(homeCopy);
          agent.env.enemy.health = 100;
          agent.env.enemy.alive = true;
        };

        agents.push(agent);
      }

      ready = true;
      console.info(
        `[EnemySquad] ${agents.length} Adam Smashers ready (all directions)`,
      );
    } catch (err) {
      console.warn("[EnemySquad] background load failed:", err);
    }
  })();

  return squad;
}
