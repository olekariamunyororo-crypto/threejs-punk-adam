# Bug Report: threejs-punk-adam

**Repository:** https://github.com/olekariamunyororo-crypto/threejs-punk-adam  
**Base project:** Threejs-Punk / threejs-conference (WebGPU + Three.js + TSL cyberpunk alley)  
**Fork focus:** First-person combat — Adam Smasher NPCs, player shooting, optional hovercar, samurai melee  
**Analysis date:** 2026-10-20  
**Method:** Static analysis of sparse-cloned source (`src/`, docs, config). No WebGPU runtime execution.

If this report disagrees with current source, **the code wins**. Severity reflects likely player/dev impact, not formal CVSS.

---

## Summary

| Severity | Count |
|----------|------:|
| Critical / High | 4 |
| Medium | 6 |
| Low / Polish | 6 |
| **Total** | **16** |

---

## Critical / High

### BUG-01 — `FEATURES.samurai` is undefined; samurai always spawns

| | |
|---|---|
| **Severity** | High |
| **Files** | `src/world/features.js`, `src/main.js` (~211) |

**Description**

`FEATURES` does not define a `samurai` key. In `main.js`:

```js
if (FEATURES.samurai ?? true) {
  setTimeout(() => {
    enemyAI.agents.push(setupSamurai({ ... }));
  }, 9000);
}
```

Because `FEATURES.samurai` is `undefined`, the nullish coalescing operator always yields `true`. The samurai cannot be turned off via the feature flags without editing `main.js`. The same pattern appears for hovercar (`FEATURES.hovercar ?? true`), though `hovercar: true` is already present in `features.js`, so that case is less severe.

**Impact**

- Extra ~GLB load and AI tick ~9 s after start even when the user only wants the Adam pair or the original alley demo.
- README feature-flag table omits `samurai`, so agents and contributors have no documented off switch.
- Inconsistent with `trainEnemies` / `hovercar`, which *are* listed and defined.

**Recommended fix**

1. Add `samurai: true` (or `false`) to `FEATURES` in `features.js`.
2. Use `if (FEATURES.samurai)` without `?? true` (or document intentional default).
3. Document the flag and `public/models/samurai.glb` in README assets / feature tables.

---

### BUG-02 — Enemy physics locked to fixed 1/60 step (frame-rate dependent)

| | |
|---|---|
| **Severity** | High |
| **Files** | `src/ai/EnemyTrainingEnv.js` (`step`, `_updatePhysics`), `src/ai/setupEnemyAI.js` (`tickBrain`) |

**Description**

The render loop passes a real frame `delta` into the enemy facade:

```js
enemyAI?.update(delta, enabled);
```

Inside `setupEnemyAI.update` → `tickBrain(delta)`:

```js
const actionName = brain.pickAction(delta);
trainingEnv.step(idx >= 0 ? idx : ...);
```

But `EnemyTrainingEnv.step` always advances physics with a hardcoded timestep:

```js
this._updatePhysics(1 / 60);
this.enemy.shootCooldown--; // discrete “steps”, not seconds
```

Movement speed, turn rate, and shoot cooldown are therefore tied to **frame count**, not wall-clock time.

**Impact**

| Device FPS | Relative enemy speed vs 60 FPS design |
|------------|----------------------------------------|
| ~30        | ~0.5× (enemies feel sluggish)          |
| ~60        | 1× (intended)                          |
| ~120       | ~2× (enemies rush / cooldown drains fast) |

Samurai path correctly uses `const dt = Math.min(delta, 0.05)`. Adam path does not.

**Recommended fix**

- Pass `delta` into `step(actionIndex, delta)` and `_updatePhysics(delta)`.
- Store shoot cooldown in **seconds** (or scale step-based cooldown by `delta * 60`).
- Optionally clamp delta (e.g. `Math.min(delta, 0.05)`) for stability after tab switches.

---

### BUG-03 — Dual hit decision for enemy pistol shots

| | |
|---|---|
| **Severity** | High |
| **Files** | `src/ai/setupEnemyAI.js` (`_tryShoot` override), `src/ai/EnemyTrainingEnv.js` (`_tryShoot`), `src/ai/enemyCombat.js` (`fire`, tracer `update`) |

**Description**

When the brain chooses `"shoot"`:

1. `EnemyTrainingEnv._tryShoot` checks range, line of sight, and aim alignment; may set `_hitPlayerThisStep` / `lastShotHit`.
2. The override in `setupEnemyAI` then calls `combat.fire()` if that flag is set.
3. `combat.fire()` **rolls a second independent hit chance** (`COMBAT.hitBase`, distance falloff, moving multiplier) and schedules `onPlayerHit()` only when the visual tracer reaches the target.

Env and combat can disagree: env “hit” → combat miss, or env conditions pass but combat RNG fails. Training rewards (`reward()` uses `lastShotHit`) therefore diverge from what the player experiences.

**Impact**

- Unpredictable lethality.
- RL / training hooks (optional IgnitionAI) optimize against a different signal than gameplay damage.
- Tracer delay means a player who enters the hovercar mid-flight can still be damaged depending on closure timing.

**Recommended fix**

- Single source of truth for hit/miss (either env or combat).
- Prefer: env validates eligibility (range, LOS, aim, cooldown); combat only handles VFX/audio and applies `onPlayerHit` when env already decided hit.
- Or: combat owns RNG; env reads combat’s result for rewards.

---

### BUG-04 — Gun sample path case sensitivity (Linux / case-sensitive FS)

| | |
|---|---|
| **Severity** | High (platform-specific) |
| **Files** | `src/world/viewmodel/createGunAudio.js`, README troubleshooting |

**Description**

```js
const SHOT_URLS = [
  "/sounds/ak-74.mp3",
  "/sounds/ak74-shot.mp3",
];
```

Historical / repo asset naming has included `Ak-74.mp3`. On case-sensitive filesystems (typical Linux CI, many servers, some containers) the fetch fails, decode never succeeds, and the player hears only the procedural fallback (“soft noise”). README documents a manual symlink workaround; the loader does not try the alternate casing.

**Impact**

- Wrong or missing gun feedback on Linux deploys and some mobile WebViews.
- Confusing for contributors who see `[GunAudio] HTTP 404` / decode warnings.

**Recommended fix**

- Add `"/sounds/Ak-74.mp3"` to `SHOT_URLS`, **or** rename the committed file to match the primary URL.
- Prefer one canonical lowercase path in both repo and code.

---

## Medium

### BUG-05 — Facade `applyDamage` only affects the first living agent

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/ai/setupEnemyPair.js` (`makeFacade` → `applyDamage`) |

**Description**

```js
applyDamage(amount) {
  for (const a of agents) {
    if (a.env?.isAlive?.()) {
      a.applyDamage(amount);
      break;
    }
  }
}
```

Any caller of the pair/squad facade’s `applyDamage` damages only one NPC. Hovercar roadkill currently iterates agents and calls `registerHit` per agent (safer), but the public facade API is easy to misuse for AOE or debug damage.

**Recommended fix**

- Apply to all living agents, or rename to `applyDamageToNearest` / require an agent id / hit point.

---

### BUG-06 — Failed NPC loads remain in the agent list

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/ai/setupEnemyPair.js`, `src/ai/setupEnemyAI.js`, `src/main.js` (samurai `setTimeout`) |

**Description**

Agent objects are pushed into `agents` immediately (or after delay) even when the async GLB load later fails. `update` still runs; errors are swallowed in the facade. Fallback red capsules may remain, or agents no-op with `enemyRoot === null` while still occupying the list for `shootRay` / `respawn`.

**Impact**

- Silent degradation (no console hard fail after initial warn).
- `shootRay` / `registerHit` iterate dead entries; extra work every frame.
- No dispose path to remove a permanently failed agent.

**Recommended fix**

- Only push after successful model load, or mark agents `ready: false` and skip in facade loops until ready; remove on permanent failure.

---

### BUG-07 — Desktop fire gated on existing pointer lock

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/world/viewmodel/createViewmodel.js` (`onMouseDown`) |

**Description**

```js
if (walkControlsRef?.isPointerLocked?.()) {
  state.triggerHeld = true;
}
```

The first left-click only engages pointer lock; shooting starts only once lock is already held. After alt-tab or lock loss, the next click re-acquires lock without firing. Touch / HUD fire path is separate and unaffected.

**Impact**

- Feels like a dead trigger after focus loss.
- Intentional FPS pattern, but undocumented in the short “how to play” steps.

**Recommended fix**

- On `pointerlockchange`, if lock just acquired and button still down, set `triggerHeld`.
- Or document: “click once to lock, then hold to fire.”

---

### BUG-08 — Undocumented `samurai.glb` dependency

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/ai/setupSamurai.js` (`MODEL_URL = "/models/samurai.glb?v=1"`), README assets table |

**Description**

Samurai always loads (see BUG-01) from `/models/samurai.glb`. README’s models table lists city, car, viewmodel, Adam, hovercar — not samurai. A sparse or incomplete `public/` tree yields a silent failed enemy.

**Recommended fix**

- Document size, license, and path in README.
- Fail loudly in the loader UI or console if the asset 404s after N retries.

---

### BUG-09 — No post-respawn invulnerability

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/game/playerCombat.js`, `src/main.js` (`onPlayerHit`), enemy tracers / samurai attack windows |

**Description**

Player health is binary in practice: `hit(100)` kills. After `respawn()`, in-flight enemy tracers or an active samurai damage window can kill again on the same frame or the next.

**Impact**

- “YOU DIED → RESPAWN → instant death” loops near aggressive NPCs.

**Recommended fix**

- Short invuln window (e.g. 1.0–1.5 s) after respawn; ignore `onPlayerHit` / melee while active; optional visual flash.

---

### BUG-10 — Early-frame ground / wall probes fragile without ready BVH

| | |
|---|---|
| **Severity** | Medium |
| **Files** | `src/ai/EnemyTrainingEnv.js` (`_sampleGroundY`, `_hitsWall`), `src/world/bvh.js`, init order in `main.js` |

**Description**

Enemies reuse city/ground meshes and raycasting. BVH acceleration is installed for walk controls; enemies depend on the same geometry being ready. Before BVH build or if `ground` is null (`FEATURES.ground: false`), ground samples fall back to spawn Y and walls may not block. Spawn points are hardcoded near the Quadra / alley coordinates.

**Impact**

- Brief floating or wall-clipping after spawn.
- Wrong placement if city layout or ground height changes.

**Recommended fix**

- Gate enemy brain movement until `world` colliders/BVH report ready.
- Re-sample ground on first N frames after load with `allowLongDrop: true` (already used on reset — extend to post-load).

---

## Low / Polish

### BUG-11 — Three parallel combat pipelines

| | |
|---|---|
| **Severity** | Low |
| **Files** | `src/ai/enemyCombat.js`, `src/ai/setupSamurai.js`, `src/game/hovercar.js` |

Adam (pistol + bone capsules), samurai (melee + deflect), and hovercar (roadkill `registerHit`) each implement hit tests and damage differently. Bone name assumptions (`Head`, `RightHand`, …) are duplicated and brittle across GLBs. No shared `Damageable` / agent interface beyond duck typing (`env`, `shootRay`, `registerHit`, `respawn`).

**Recommended fix**

- Thin shared interface + one capsule helper module used by Adam and samurai.

---

### BUG-12 — `package.json` name still `threejs-punk`

| | |
|---|---|
| **Severity** | Low |
| **Files** | `package.json` |

Fork repository is `threejs-punk-adam` but `"name": "threejs-punk"`. Confuses local tooling, logs, and deploy naming.

**Recommended fix**

- Rename to `"threejs-punk-adam"` (or scoped name) and bump version when cutting releases.

---

### BUG-13 — Dead experimental squad path

| | |
|---|---|
| **Severity** | Low |
| **Files** | `src/ai/setupEnemySquad.js` |

Documented as causing mobile / WebGPU black screens; **not** wired from `main.js`. Still present and importable. Risk of accidental use by agents following old docs.

**Recommended fix**

- Delete, or move under `src/ai/experimental/` with a hard top-of-file warning and no default export used by app code.

---

### BUG-14 — Viewmodel `fireRay` early-out when combat is missing

| | |
|---|---|
| **Severity** | Low |
| **Files** | `src/world/viewmodel/createViewmodel.js` |

```js
if (!targets.length && !world?.enemyAI) {
  return;
}
```

If `trainEnemies` is off or pair setup failed, shots produce no world impacts (holes/sparks) when `focusTargets` is also empty. Acceptable when combat is intentionally disabled; confusing when setup failed silently.

**Recommended fix**

- Always allow environment raycast against `focusTargets` / city when present; treat enemy ray as optional overlay.

---

### BUG-15 — Animation clip name coupling

| | |
|---|---|
| **Severity** | Low |
| **Files** | `src/ai/setupEnemyAI.js`, `src/ai/setupSamurai.js`, `src/world/viewmodel/createViewmodel.js` |

Adam expects `Idle` / `Walk` / `Run` / `Attack` / `Die` (plus derived aim/body clips). Samurai expects its own set. Viewmodel expects `Rig|VSK_*` names. Missing clips degrade to static mesh or wrong locomotion without blocking boot.

**Recommended fix**

- Log a single structured warning listing missing required clips at load time; optional mapping table in one config file.

---

### BUG-16 — Hardcoded world spawn coordinates

| | |
|---|---|
| **Severity** | Low |
| **Files** | `src/ai/setupEnemyPair.js`, `src/main.js` (samurai spawns), `src/world/car/loadCar.js` (`QUADRA_START`), `src/game/hovercar.js` (`SPAWN`) |

Adam spawns offset from Quadra `[-128, -5.47, 33]`; samurai at `[-100, -5.4, 30]` etc.; hovercar at fixed alley coords. Layout changes in the city GLB require hunting multiple files.

**Recommended fix**

- Central `src/world/spawnPoints.js` (or data next to `QUADRA_START`) used by pair, samurai, and hovercar.

---

## Already documented upstream (not new bugs)

These are called out in README / AGENTS and match the code; listed for completeness:

| Topic | Notes |
|-------|--------|
| 6× skinned NPC squad | Experimental path caused black screens; pair path is the stable default |
| Blocking init on large GLB | Pair uses non-blocking + delayed second agent |
| Case-sensitive gun path | README suggests symlink; code still incomplete (BUG-04) |
| Mobile performance profile | DPR / pass stripping in `performanceProfile.js` |
| Optional `ignitionai` | Dynamic import with `@vite-ignore`; not required for brain |

---

## Suggested fix priority

1. **BUG-01** — Add `samurai` flag (and stop defaulting undefined to true).  
2. **BUG-02** — Delta-based enemy physics and cooldown.  
3. **BUG-03** — Unify enemy hit decision.  
4. **BUG-04** — Gun URL casing / asset rename.  
5. **BUG-09** — Respawn invulnerability.  
6. **BUG-05 / BUG-06** — Facade damage semantics and agent readiness.  
7. Remaining medium/low items as polish.

---

## Out of scope / not verified

- Runtime WebGPU shader compile order, Safari DPR caps, and VRAM behavior (no GPU in analysis environment).
- Correctness of TSL post stack, rain collision height texture, or planar wet-ground reflection (base scene; largely unchanged by the fork).
- Asset licenses and exact binary presence of every `.glb` / `.mp3` in a full non-sparse clone.
- Network / Vercel deploy configuration.

---

## Appendix — Key file map (fork layer)

```
src/main.js                 Wire-up, enemy pair + samurai, hovercar, frame hooks
src/world/features.js       Feature flags
src/ai/setupEnemyPair.js    Dual Adam facade
src/ai/setupEnemyAI.js      Single Adam + brain + load
src/ai/EnemyTrainingEnv.js  Movement, LOS, discrete actions
src/ai/enemyCombat.js       Pistol, tracers, bone capsules
src/ai/setupSamurai.js      Melee agent
src/ai/setupEnemySquad.js   Experimental (not wired)
src/game/playerCombat.js    Health / death overlay / respawn
src/game/hovercar.js        Vehicle + roadkill
src/world/viewmodel/        Arms, fire ray, gun audio, ammo HUD
```

---

*End of report.*
