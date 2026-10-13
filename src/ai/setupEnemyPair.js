/**
 * Two Adam Smashers — safe dual spawn.
 *
 * - Agent 0 starts immediately (same path as single NPC)
 * - Agent 1 starts after a delay (separate GLB load, no SkeletonUtils)
 * - Never awaits; scene boot is unaffected
 */

import * as THREE from "three/webgpu";
import { setupEnemyAI } from "./setupEnemyAI.js";
import { QUADRA_START } from "../world/car/loadCar.js";

const SECOND_DELAY_MS = 4000;

function makeFacade(agents) {
  return {
    agents,
    get length() {
      return agents.length;
    },
    update(delta = 1 / 60, enabled = true) {
      for (const a of agents) {
        try {
          a.update(delta, enabled);
        } catch {
          /* skip */
        }
      }
    },
    shootRay(ray, maxDist = 150) {
      let best = null;
      let bestAgent = null;
      for (const a of agents) {
        try {
          const h = a.shootRay(ray, maxDist);
          if (h && (!best || h.distance < best.distance)) {
            best = h;
            bestAgent = a;
          }
        } catch {
          /* skip */
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
      let dMin = Infinity;
      for (const a of agents) {
        if (!a.env?.isAlive?.()) continue;
        const d = a.env.getEnemyPosition().distanceTo(hit.point);
        if (d < dMin) {
          dMin = d;
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
}

/**
 * @returns {{ update, shootRay, registerHit, respawn, agents }}
 */
export function setupEnemyPair({
  camera,
  scene,
  colliders = [],
  ground = null,
  model = null,
  modelScale = 1,
  onPlayerHit = () => {},
  getPlayerSpeed = () => 0,
} = {}) {
  const car = QUADRA_START.position;
  const y = car[1] + 1.6;

  // Agent 0 — next to car (original)
  const spawn0 = [
    new THREE.Vector3(car[0] + 3.5, y, car[2] + 2.5),
    new THREE.Vector3(car[0] - 2.5, y, car[2] + 4),
    new THREE.Vector3(car[0] + 5, y, car[2] - 1),
  ];

  // Agent 1 — opposite side of car / slightly further
  const spawn1 = [
    new THREE.Vector3(car[0] - 5, y, car[2] - 3),
    new THREE.Vector3(car[0] - 3, y, car[2] + 6),
    new THREE.Vector3(car[0] + 2, y, car[2] - 5),
  ];

  const shared = {
    camera,
    scene,
    colliders,
    ground,
    model,
    autoTrain: false,
    modelScale,
    onPlayerHit,
    getPlayerSpeed,
  };

  /** @type {ReturnType<typeof setupEnemyAI>[]} */
  const agents = [];

  try {
    const a0 = setupEnemyAI({ ...shared, spawnPoints: spawn0 });
    agents.push(a0);
    console.info("[EnemyPair] agent 0 ready (by car)");
  } catch (err) {
    console.warn("[EnemyPair] agent 0 failed:", err);
  }

  // Second NPC after delay — independent load, does not block boot
  setTimeout(() => {
    try {
      const a1 = setupEnemyAI({ ...shared, spawnPoints: spawn1 });
      agents.push(a1);
      console.info("[EnemyPair] agent 1 ready (flank)");
    } catch (err) {
      console.warn("[EnemyPair] agent 1 failed:", err);
    }
  }, SECOND_DELAY_MS);

  return makeFacade(agents);
}
