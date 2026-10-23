# Observability — Mixpanel (EU)

Status: **client live** via `mixpanel-browser`. Telemetry is **off** until `VITE_MIXPANEL_TOKEN` is set.

## Goals

| Signal | Why |
|--------|-----|
| Boot / WebGPU | Black screens, init failures |
| Asset load | Missing GLB / audio |
| Combat health | Deaths, hit paths (sampled) |
| Errors | Caught failures with stack snippet |

## Mixpanel setup (UI)

1. Open [Mixpanel EU](https://eu.mixpanel.com/) (data residency matches the client).
2. Prefer project **Threejs-punk-adam** (id `4076563`) or the token target already wired in code comments (`4076561`).
3. **Project Settings → Project Token** — copy the **project token** (browser-safe).
4. Do **not** put a service account secret or API secret in frontend code.

## Env vars (Vite)

Set in Vercel project env and local `.env` (gitignored):

```bash
VITE_MIXPANEL_TOKEN=your_project_token
# Optional overrides:
VITE_MIXPANEL_API_HOST=https://api-eu.mixpanel.com
VITE_MIXPANEL_ENV=production
VITE_APP_VERSION=0.0.1
```

If `VITE_MIXPANEL_TOKEN` is missing, `initMixpanel()` returns `false` and **no events** are sent.

## Client

| File | Role |
|------|------|
| [`src/observability/mixpanel.js`](src/observability/mixpanel.js) | Init + `trackAction` / `trackError` / `trackTiming` |
| [`src/observability/datadogRum.js`](src/observability/datadogRum.js) | Thin re-export of Mixpanel (compat for older imports) |
| [`src/main.js`](src/main.js) | Calls `initMixpanel()` at start of `init()` |

Package: `mixpanel-browser` (see `package.json` / lockfile).

### API

```js
import { trackAction, trackError, trackTiming } from "./observability/mixpanel.js";

trackAction("webgpu_ready");
trackError(error, { phase: "init" });
trackTiming("glb_load_ms", durationMs, { model: "adam_smasher_rigged" });
```

## Event map

| Event name | When |
|------------|------|
| `boot_start` | Mixpanel init succeeds |
| `webgpu_ready` | Renderer created |
| `webgpu_fail` | Renderer / top-level init throws |
| `world_ready` | `createWorld` finished |
| `viewmodel_fail` | Viewmodel catch |
| `enemy_pair_fail` | Enemy pair setup catch |
| `samurai_fail` | Samurai setup catch |
| `intro_complete` | Intro flow done |
| `error` | `trackError(...)` — includes `message`, optional `stack` |
| `glb_load_fail` | Loader failure (wire at remaining load sites) |
| `player_death` | Death (wire later if needed) |

Super-properties registered on init: `service`, `env`, `app_version`.

## Vercel

1. Project → Settings → Environment Variables → add `VITE_MIXPANEL_TOKEN` (Production + Preview as needed).
2. Redeploy after changing env (Vite inlines at **build** time).
3. Confirm production deploy is **READY** (see Linear **THR-18** if builds fail — usually stale `package-lock.json`).

## Grok + Mixpanel connector

This workspace’s Mixpanel MCP talks to **US** (`mcp.mixpanel.com`). EU projects require `mcp-eu.mixpanel.com`. Until the EU endpoint is connected, use the Mixpanel EU UI for Live View / Insights.

## Privacy

- Avoid PII in event properties.
- Autocapture is **off** — only explicit `track*` calls.
- Sample high-frequency signals (FPS) if you add them later.

## Next steps

1. Ensure lockfile includes `mixpanel-browser` (THR-18).
2. Set `VITE_MIXPANEL_TOKEN` on Vercel → redeploy.
3. Open Mixpanel Live View and load the site once; expect `boot_start` / `webgpu_ready`.
4. Wire remaining loaders + `player_death` if dashboards need them.
