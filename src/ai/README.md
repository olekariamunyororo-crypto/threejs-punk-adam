# Enemy AI (IgnitionAI integration)

This folder adds a **TrainingEnv** that re-uses the same BVH collision logic as `createWalkControls` so enemy agents respect the cyberpunk alley geometry.

**Visible NPC:** `public/models/adam_smasher_rigged.glb` (Adam Smasher).

## Behavior (`setupEnemyAI.js`)

- Loads the GLB with **GLTFLoader** (same path style as the rest of the project: `/models/adam_smasher_rigged.glb`)
- Adds it to the scene as **`AdamSmasher_Enemy`**
- Every frame (`enemyAI.update(delta)`) the model follows the training-env **position + yaw**
- If the GLB contains **Idle / Walk** clips they **cross-fade** when the agent moves
- Falls back to a **red capsule** until the GLB finishes loading
- Exposes **`applyDamage(amount)`** so the player can hit him later

## Files

| File | Purpose |
|------|---------|
| `EnemyTrainingEnv.js` | Implements IgnitionAI `TrainingEnv` (observe / step / reward / done / reset) |
| `setupEnemyAI.js` | Loads Adam Smasher, wiring helper, train/infer, per-frame `update()` |
| `README.md` | This guide |

## 1. Install (optional – only needed for RL training)

```bash
npm install ignitionai
```

The model still appears and moves with a simple controller even without IgnitionAI.

## 2. Minimal integration

```js
import { FEATURES } from "./world/features.js";
import { setupEnemyAI } from "./ai/setupEnemyAI.js";
import * as THREE from "three/webgpu";

// After createWorld(), buildModelBvh(), and cameraDirector exist:

if (FEATURES.trainEnemies) {
  const colliders = []; // city, collider.glb, car meshes with boundsTree

  const enemyAI = setupEnemyAI({
    camera,
    scene,
    colliders,
    ground: world.ground,
    model: world.cityRoot,
    spawnPoints: [
      new THREE.Vector3(5, 1.6, -15),
      new THREE.Vector3(-8, 1.6, -22),
    ],
    autoTrain: false,
  });

  // In the render / animation loop:
  enemyAI.update(delta);

  // Later, when the player shoots:
  // enemyAI.applyDamage(25);
}
```

Enable the flag:

```js
// src/world/features.js
trainEnemies: true,
```

## 3. Adam Smasher asset

- Path: `public/models/adam_smasher_rigged.glb`
- Scale / facing can be adjusted in `setupEnemyAI.js` (`root.scale`, `root.rotation.y`)

## 4. Observation & action space (v1)

**Actions:** `forward | back | strafe_left | strafe_right | turn_left | turn_right | shoot | idle`

**Observation (9 floats):** relative xz, distance, sin/cos yaw, relative bearing, health, LOS, shoot-cooldown

## 5. Status

- Original walk controls, rain, and post-processing are untouched
- Adam Smasher loads only when you call `setupEnemyAI` (gate with `FEATURES.trainEnemies`)
