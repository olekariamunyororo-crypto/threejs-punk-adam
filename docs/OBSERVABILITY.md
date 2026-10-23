# Observability sketch — Datadog RUM + metrics

**Status:** Design + client stub. Datadog account/connector must be configured with real `applicationId` / `clientToken` before data flows.

App: `threejs-punk-adam` (Vite + WebGPU client on Vercel / GHCR nginx).

---

## 1. Goals

| Signal | Why |
|--------|-----|
| JS errors / unhandled rejections | Black screens, loader failures |
| WebGPU init success/fail | Hard requirement for the demo |
| GLB load failures | Missing models = broken combat |
| Session + page views | Traffic vs deploy correlation |
| Frame-time samples (custom) | Jank / mobile performance |
| Gameplay events (light) | Deaths, feature flags (optional) |

Out of scope for v1: full APM on a game server (add when multiplayer exists).

---

## 2. Datadog products to use

| Product | Role |
|---------|------|
| **RUM (Browser)** | Sessions, views, errors, resources, long tasks |
| **RUM custom actions** | `webgpu_ready`, `glb_error`, `player_death`, … |
| **RUM custom timings** | Optional `warmup_ms`, `first_frame_ms` |
| **Metrics (optional)** | From RUM facets or later Logs → Metrics |
| **Synthetics (optional)** | HTTP check on `https://threejs-punk-adam.vercel.app/` |

Do **not** put Datadog API keys in the browser. Only **RUM application ID + client token** (public, restricted by domain).

---

## 3. Datadog UI setup (manual once)

1. Datadog → **UX Monitoring → RUM Applications → New Application**
2. Type: **Browser**
3. Name: `threejs-punk-adam`
4. Copy **Application ID** and **Client Token**
5. Allowed domains: `threejs-punk-adam.vercel.app`, `localhost`
6. Site: match your org (`datadoghq.com`, `datadoghq.eu`, …)

Vercel / local env (never commit secrets that are private; RUM client token is public but still use env):

```bash
VITE_DD_APPLICATION_ID=...
VITE_DD_CLIENT_TOKEN=...
VITE_DD_SITE=datadoghq.com
VITE_DD_SERVICE=threejs-punk-adam
VITE_DD_ENV=production   # or development
```

---

## 4. Client integration sketch

Package (when enabling):

```bash
npm i @datadog/browser-rum
```

Init early in `main.js` (before heavy world load) via `src/platform/telemetry.js`:

```js
import { datadogRum } from '@datadog/browser-rum'

datadogRum.init({
  applicationId: import.meta.env.VITE_DD_APPLICATION_ID,
  clientToken: import.meta.env.VITE_DD_CLIENT_TOKEN,
  site: import.meta.env.VITE_DD_SITE || 'datadoghq.com',
  service: import.meta.env.VITE_DD_SERVICE || 'threejs-punk-adam',
  env: import.meta.env.VITE_DD_ENV || 'development',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 0, // enable later if needed / cost OK
  trackUserInteractions: true,
  trackResources: true,
  trackLongTasks: true,
  defaultPrivacyLevel: 'mask-user-input',
})
```

Gate with env present **or** `FEATURES.telemetry` so local/dev can stay quiet.

---

## 5. Custom actions / metrics (names)

Use stable names so dashboards don’t drift.

| Action name | When | Context attrs |
|-------------|------|----------------|
| `webgpu_ok` | Renderer created | `backend` |
| `webgpu_fail` | No WebGPU / context lost | `reason` |
| `glb_load_ok` | Model loaded | `model` (path basename) |
| `glb_load_fail` | Loader error | `model`, `message` |
| `warmup_done` | After compile/warmup | `duration_ms` |
| `player_death` | Player dies | `cause` (optional) |
| `feature_flag` | Boot | `flags` JSON or key list |
| `fps_sample` | Every N seconds | `fps`, `frame_ms` |

Example:

```js
datadogRum.addAction('glb_load_fail', { model: 'adam_smasher_rigged.glb', message: String(err) })
datadogRum.addTiming('warmup_ms') // after mark start/end pattern
```

**FPS:** sample at most every 5–10s to avoid cost/noise; attach as action or global context update.

---

## 6. Suggested Datadog dashboard widgets

1. **RUM error count** — `@service:threejs-punk-adam` last 24h  
2. **Sessions** — count by `env`  
3. **Top errors** — message facet  
4. **Custom action timeseries** — `webgpu_fail`, `glb_load_fail`  
5. **p75 resource duration** — `*.glb`  
6. **Synthetic uptime** — production URL (optional)

Monitor examples:

- Alert if `webgpu_fail` > 5 in 15m (prod)  
- Alert if RUM error rate > threshold  
- Alert if synthetic check fails 2x

---

## 7. Privacy / cost

- Start **Session Replay at 0%**  
- Sample sessions lower in prod if traffic grows (`sessionSampleRate: 20`)  
- Don’t send PII in action context  
- Mask inputs (default above)

---

## 8. Implementation checklist

- [ ] Create RUM app in Datadog; note site/region  
- [ ] Set Vercel env vars `VITE_DD_*`  
- [ ] `npm i @datadog/browser-rum`  
- [ ] Wire `src/platform/telemetry.js` from `main.js`  
- [ ] Instrument WebGPU + GLB load paths  
- [ ] Dashboard + 1–2 monitors  
- [ ] Connect Datadog connector in Grok for API/dashboard automation (optional)

---

## 9. Related

- Live: https://threejs-punk-adam.vercel.app/  
- Docker health: nginx `GET /` only (infra, not RUM)  
- CI: build status ≠ runtime observability  
