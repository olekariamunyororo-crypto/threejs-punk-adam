# Observability — Datadog RUM + metrics

Status: **sketch + client stub**. Datadog account/app must be created in the Datadog UI; Grok connector auth may be completed separately.

## Goals

| Signal | Why |
|--------|-----|
| Session RUM | Page load, errors, frustration |
| WebGPU / boot | Black screens, init failures |
| Asset load | Missing GLB / audio |
| Combat health | Deaths, hit paths (sampled) |
| Perf | FPS / long frames (sampled) |

## Datadog setup (UI)

1. Create a Datadog account (site: `datadoghq.com` or `datadoghq.eu`, etc.).
2. **UX Monitoring → RUM Applications → New Application**
   - Type: **Browser**
   - Name: `threejs-punk-adam`
3. Copy:
   - **Application ID**
   - **Client token** (browser-safe; not the API key)
4. Optional: enable **Session Replay** (cost/privacy tradeoff).

Do **not** put the server **API key** in frontend code.

## Env vars (Vite)

Set in Vercel project env and local `.env` (gitignored):

```bash
VITE_DD_APPLICATION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_DD_CLIENT_TOKEN=pubxxxxxxxx
VITE_DD_SITE=datadoghq.com
VITE_DD_SERVICE=threejs-punk-adam
VITE_DD_ENV=production
# VITE_DD_ENV=development for local
```

If `VITE_DD_APPLICATION_ID` or `VITE_DD_CLIENT_TOKEN` is missing, RUM stays **off** (no network calls).

## Client stub

- Module: [`src/observability/datadogRum.js`](src/observability/datadogRum.js)
- Booted from [`src/main.js`](src/main.js) before scene init
- Package: `@datadog/browser-rum` (loaded dynamically only when env is set)

### Custom actions / errors (API)

```js
import { trackAction, trackError, trackTiming } from "./observability/datadogRum.js";

trackAction("webgpu_ready");
trackError(error, { phase: "init" });
trackTiming("glb_load_ms", durationMs, { model: "adam_smasher_rigged" });
```

## Metric / event map (sketch)

### RUM standard

| Datadog view | Source |
|--------------|--------|
| Loading time, LCP-ish | RUM automatic |
| JS errors | `trackError` + RUM error tracking |
| Long tasks | RUM performance |

### Custom actions (names stable for dashboards)

| Action name | When |
|-------------|------|
| `boot_start` | `main` starts |
| `webgpu_ready` | Renderer created |
| `webgpu_fail` | Renderer/init throws |
| `world_ready` | `createWorld` finished |
| `viewmodel_fail` | Viewmodel catch |
| `enemy_pair_fail` | Enemy setup catch |
| `samurai_fail` | Samurai setup catch |
| `glb_load_fail` | Loader failure (wire at load sites) |
| `player_death` | `playerState` death (wire later) |
| `intro_complete` | Intro flow done |

### Suggested Datadog metrics (from RUM actions → Metrics)

Generate from RUM → **Generate Metrics**:

| Metric | Type | From |
|--------|------|------|
| `rum.action.webgpu_fail` | count | action name |
| `rum.action.glb_load_fail` | count | action name |
| `rum.action.player_death` | count | action name |

Or use **Custom Measures** on actions with `trackTiming`:

| Measure | Unit |
|---------|------|
| `boot_ms` | ms end-to-end init |
| `glb_load_ms` | per model |
| `frame_p95_ms` | optional sampled |

## Dashboards (sketch)

1. **Health** — error rate, `webgpu_fail`, `glb_load_fail`
2. **Perf** — load time, long tasks, optional FPS histogram
3. **Gameplay** — `player_death` rate (if instrumented)

## Monitors (sketch)

| Monitor | Condition |
|---------|-----------|
| WebGPU fail spike | `webgpu_fail` count > N / 15m |
| High JS error rate | RUM error rate > threshold |
| Deploy regression | Compare env `production` vs prior hour |

## Grok + Datadog connector

When the **Datadog** connector is authorized in this chat, Grok can help query monitors/dashboards (API). **RUM still requires browser SDK + client token** in the app — the connector does not inject frontend scripts.

## Privacy

- Avoid sending PII in action context.
- Session Replay: disable or mask if required.
- Sample high-frequency events (FPS) at low rate.

## Next implementation steps

1. Connect Datadog in Grok (auth card) + create RUM app in Datadog UI.
2. Set Vercel `VITE_DD_*` env → redeploy.
3. Wire `trackError` / `trackAction` at remaining catch sites (loaders, death).
4. Build dashboard + 1–2 monitors.
