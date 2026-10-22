# Instructions for coding agents

Use this file when you are asked to **modify**, **extend**, or **replicate** techniques from this repo. Human-oriented narrative lives in [README.md](README.md). **If README or AGENTS disagree with source code, the code wins.**

Operational how-tos for new weapons / enemies / scenes / multiplayer: **[docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md)**.

## Project intent

WebGPU + Three.js **TSL** demo: cyberpunk alley, walk mode (BVH), GPU rain with a **collision height texture**, wet ground (ripples + planar reflection), TSL post stack.

**Fork layer (threejs-punk-adam):** first-person combat — Adam Smasher NPCs, player viewmodel / shooting, optional hovercar, samurai melee. Not a general engine — factory wiring in [`src/main.js`](src/main.js).

## Read order (minimal context budget)

1. [README.md](README.md) — Source map and feature overview.
2. [docs/AGENT_PLAYBOOK.md](docs/AGENT_PLAYBOOK.md) — feature recipes for agents.
3. [docs/techniques/README.md](docs/techniques/README.md) — rain / wet ground deep dives.
4. [`src/world/features.js`](src/world/features.js) — **every new optional system needs a flag**.
5. [`src/platform/performanceProfile.js`](src/platform/performanceProfile.js) — budgets before adding passes or instances.
6. Touch only the subtree you need (see **File routing**).

## Hard constraints

| Rule | Reason |
|------|--------|
| Import from `three/webgpu` and `three/tsl` | Project is WebGPU-first |
| Prefer TSL `Fn`, node materials, `RenderPipeline` | No custom GLSL under `src/` |
| Do not reintroduce SSR for wet ground | Planar RT + roughness only |
| Ground wetness ≠ car droplets | Separate modules — see techniques docs |
| Collision rain uses `useDedicatedPass: false` | Do not assume a separate rain composite pass |
| Hide rain/sky/smoke/planes from height pass | [`collisionHideObjects.js`](src/world/weather/collisionHideObjects.js) |
| New expensive work: half-res, frame-skip, or distance fade | Match `performanceProfile` |
| Safari / mobile | Respect device performance defaults |
| **New gameplay systems behind `FEATURES.*`** | Default `false` until stable; document in README |
| **Do not use `FEATURES.x ?? true`** | Undefined keys must not silently enable content (BUG-01) |
| Enemy movement uses real frame `delta` | No hardcoded `1/60` physics steps (BUG-02) |
| Single source of truth for enemy hit/miss | Env decides; combat VFX with `forceHit` (BUG-03) |
| Player invuln after respawn | [`playerCombat.js`](src/game/playerCombat.js) |

## File routing (where to edit)

### Base scene / rendering

| Task | Start here |
|------|------------|
| New world object / load asset | [`src/world/createWorld.js`](src/world/createWorld.js), loaders under `src/world/loaders/` |
| Rain collision / splashes | `src/world/weather/` |
| Wet pavement / reflection | [`createGround.js`](src/world/ground/createGround.js) |
| Car wet shader | `src/world/car/`, `src/tsl/surfaceRain.js` |
| Post / grade / bloom / AO | [`postprocessing.js`](src/post/postprocessing.js) |
| Per-frame order | [`createRenderLoop.js`](src/runtime/createRenderLoop.js) |
| Walk / BVH | [`createWalkControls.js`](src/controls/createWalkControls.js), [`bvh.js`](src/world/bvh.js) |
| Feature toggle | [`features.js`](src/world/features.js) |

### Fork: combat / FPS

| Task | Start here |
|------|------------|
| Player arms / gun / fire ray | [`src/world/viewmodel/`](src/world/viewmodel/) |
| Player health / death / respawn | [`src/game/playerCombat.js`](src/game/playerCombat.js) |
| Adam NPC + brain | [`src/ai/setupEnemyAI.js`](src/ai/setupEnemyAI.js), [`EnemyTrainingEnv.js`](src/ai/EnemyTrainingEnv.js) |
| Enemy pistol / tracers | [`src/ai/enemyCombat.js`](src/ai/enemyCombat.js) |
| Dual Adam facade | [`src/ai/setupEnemyPair.js`](src/ai/setupEnemyPair.js) |
| Samurai melee | [`src/ai/setupSamurai.js`](src/ai/setupSamurai.js) |
| Hovercar | [`src/game/hovercar.js`](src/game/hovercar.js) |
| Wire enemies into boot | [`src/main.js`](src/main.js) only — keep optional chaining |
| **Do not use** | [`setupEnemySquad.js`](src/ai/setupEnemySquad.js) — experimental, caused black screens |

## Composition pattern (do not break)

`main.js` builds plain objects: `world`, `pipeline` (post), `cameraDirector`, `renderLoop`, `appShell`. The loop calls world updates then `post.render()`. Optional features return `null` — keep using optional chaining when adding calls.

```text
FEATURES.flag
  → setupX(...) in main.js (non-blocking where possible)
  → update(delta) inside createRenderLoop onFrame
```

## Linear + GitHub workflow for agents

1. Take one Linear issue (team **THR** / Threejspunk-adam) with clear acceptance criteria.
2. Branch from `main` (prefer Linear-suggested branch name).
3. Implement behind a **feature flag** when the system is optional.
4. `npm run build` must pass.
5. Open PR; reference Linear ID in the commit/PR body (`THR-XX`).
6. Do not expand scope into multiplayer + new scene + new weapon in one PR.

## Verification checklist

After any change:

- [ ] `npm run build` succeeds
- [ ] Dev: WebGPU context (HTTPS dev server)
- [ ] With new flag **off**, behavior matches previous `main`
- [ ] Rain still collides if weather code was touched
- [ ] Mobile profile: no new full-res passes without a scale knob
- [ ] Gun audio paths remain case-safe (`ak-74` and `Ak-74` fallbacks)

## What not to do

- Do not add CPU raycasts per rain drop.
- Do not commit `.env` or secrets (`VERCEL_*`, Linear API keys, etc.).
- Avoid large unrelated refactors when fixing a single system.
- Do not implement realtime multiplayer inside Netlify/Vercel serverless only — needs a long-running host (see playbook).
- Do not enable experimental squad path from `main.js`.

## Credits (context only)

Anderson Mancini · Sunag (TSL) · [TSL Workshop 2026](https://threejs.paris/).  
Fork combat layer: threejs-punk-adam. Live: https://threejs-punk-adam.vercel.app/
