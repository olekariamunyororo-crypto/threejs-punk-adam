# Agent playbook — building features independently

This guide is for **coding agents** (and humans driving them). Pair with [AGENTS.md](../AGENTS.md) and Linear team **Threejspunk-adam** (`THR`).

**Rule:** one Linear issue → one PR → CI green → merge. Prefer small vertical slices behind `FEATURES`.

---

## 0. Shared checklist (every feature)

1. Read the Linear issue acceptance criteria; do not invent scope.
2. Read [AGENTS.md](../AGENTS.md) hard constraints + file routing.
3. Add or reuse a key in [`src/world/features.js`](../src/world/features.js). **Never** `FEATURES.x ?? true`.
4. Wire from [`src/main.js`](../src/main.js) with try/catch and optional chaining.
5. Run `npm run build`.
6. PR title/body includes `THR-XX`.

---

## 1. New weapon (player)

### Goal
Player can fire a new weapon (or swap) without breaking existing AK/viewmodel path.

### Touch
| Area | Path |
|------|------|
| Viewmodel / fire | `src/world/viewmodel/createViewmodel.js` |
| Gun audio | `src/world/viewmodel/createGunAudio.js` |
| Ammo / HUD | viewmodel + UI HUD hooks |
| Assets | `public/sounds/`, optional GLB under `public/models/` |

### Steps
1. `FEATURES.newWeapon` (or `weaponId`) default `false`.
2. Load mesh/audio only when flag is on.
3. Keep fire ray / hit registration through existing enemy `shootRay` / `registerHit` facade.
4. Case-safe audio URLs (lowercase + historical casing fallback).
5. Acceptance: flag off = current gun; flag on = new gun fires, damages Adams/samurai, HUD updates.

### Out of scope
Enemy weapons, multiplayer replication, inventory UI redesign (unless the issue says so).

---

## 2. New enemy

### Goal
Additional NPC that walks, engages, and dies under the existing pair/facade patterns.

### Touch
| Area | Path |
|------|------|
| Pattern to copy | `src/ai/setupEnemyAI.js` or `setupSamurai.js` |
| Physics / actions | `src/ai/EnemyTrainingEnv.js` (delta-based) |
| Hits on player | `onPlayerHit` → `playerState.hit` |
| Wire-up | `src/main.js` after pair setup |
| Asset | `public/models/<name>.glb` |

### Steps
1. `FEATURES.myEnemy` default `false`.
2. Prefer **non-blocking** load (pair pattern: delay second agent; never block boot).
3. Push into `enemyAI.agents` only after successful load (or mark `ready`).
4. Reuse combat damage via `registerHit` / shared facades where possible.
5. Document model path + size in README assets table.
6. **Do not** wire `setupEnemySquad.js`.

### Acceptance
- Flag off: no load, no extra AI tick cost.
- Flag on: spawns, can be killed, can damage player (respect invuln).
- `npm run build` passes.

---

## 3. New scene / area slice

### Goal
Load an additional environment piece or swap a region without rewriting combat.

### Touch
| Area | Path |
|------|------|
| World assembly | `src/world/createWorld.js` |
| GLB load | loaders under `src/world/loaders/` |
| Colliders / BVH | ensure walk + enemy probes still work |
| Spawns | centralize if adding points — avoid scattering more magic numbers |

### Steps
1. `FEATURES.sceneX` default `false`.
2. Additive load preferred over replacing the city GLB in the first PR.
3. Register colliders for walk + enemies.
4. Re-test ground sampling / wall probes for Adams.
5. Performance: texture cap, avoid full-res extras on mobile profile.

### Acceptance
- Flag off: identical to current alley.
- Flag on: new geo visible, walkable, no permanent float/clip.

---

## 4. Multiplayer (phased — never one PR)

Realtime combat **cannot** run only on Vercel/Netlify serverless. Need a long-running host (Fly.io, Railway, Render, etc.).

### Phase A — Transport spike (no gameplay authority)
- Node process + WebSocket (or Colyseus room).
- Clients send pose; server echoes.
- Deploy host outside this chat’s connectors; document env URLs.

### Phase B — Lobby
- Create/join room codes.
- Max 2–4 players.
- Still no hit validation.

### Phase C — Replicated combat
- Server (or host player) authorizes hits.
- Client predicts local movement only.
- Reuse `playerState` / enemy facades carefully — network IDs required.

### Phase D — Polish
- Interpolation, disconnect, lag compensation basics.

### Agent rules for multiplayer
- One phase per Linear issue / PR.
- Feature flag `FEATURES.multiplayer` default `false`.
- Do not block single-player path when flag is off.
- Secrets (server URL, keys) via env — never commit.

---

## 5. Linear issue template (paste into description)

```markdown
## Goal
<one sentence>

## Scope
- In:
- Out:

## Feature flag
`FEATURES.<name>` default `false`

## Files (expected)
-

## Acceptance
- [ ] `npm run build` passes
- [ ] Flag off → no behavior change
- [ ] Flag on → <observable behavior>
- [ ] README / assets updated if new GLB or sound
```

---

## 6. Priority guidance

| Priority | Examples |
|----------|----------|
| High | Build broken, player cannot move/shoot, WebGPU black screen |
| Medium | New weapon/enemy behind flag, scene slice |
| Low | Rename, docs, polish only |
| Split always | Multiplayer phases A→D |

---

## 7. Reference links

- Repo: https://github.com/olekariamunyororo-crypto/threejs-punk-adam
- Live: https://threejs-punk-adam.vercel.app/
- Linear: https://linear.app/threejspunk-adam
- Bugs already fixed pattern: THR-5 … THR-10
