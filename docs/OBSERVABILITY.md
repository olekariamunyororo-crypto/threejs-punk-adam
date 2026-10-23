# Observability — Mixpanel (EU)

**Primary:** [Mixpanel project 4076561](https://eu.mixpanel.com/project/4076561/view/4573128/app/home) on **eu.mixpanel.com**.

**Status:** Client instrumentation in repo. Set `VITE_MIXPANEL_TOKEN` on Vercel / local to send events.

App: `threejs-punk-adam` (Vite + WebGPU on Vercel / GHCR).

---

## Region note (Grok connector)

The Mixpanel connector Grok uses talks to **US** MCP (`mcp.mixpanel.com`). Your project is **EU**, so Grok **cannot** read tokens, live events, or run Insights via the connector for this project until an EU MCP path exists.

You still get full analytics in the **Mixpanel EU UI**. Client SDK → `https://api-eu.mixpanel.com`.

---

## 1. Goals

| Signal | Event name |
|--------|------------|
| Boot | `boot_start` |
| WebGPU OK / fail | `webgpu_ready` / `webgpu_fail` |
| World / viewmodel | `world_ready` / `viewmodel_fail` |
| Intro done | `intro_complete` |
| Enemy / samurai setup fail | `enemy_pair_fail` / `samurai_fail` |
| Generic errors | `error` (message, stack, phase) |

---

## 2. Enable

### Get the project token (EU UI)

1. Open [project home](https://eu.mixpanel.com/project/4076561/view/4573128/app/home)
2. **Settings → Project settings** (or gear) → **Project Token**
3. Copy the token (not the API secret)

### Env vars

```bash
VITE_MIXPANEL_TOKEN=your_project_token_here
# optional overrides:
VITE_MIXPANEL_API_HOST=https://api-eu.mixpanel.com
VITE_MIXPANEL_ENV=production
VITE_APP_VERSION=0.0.1
```

Set the same keys in **Vercel → Project → Settings → Environment Variables** (Production + Preview as needed), then redeploy.

### Install dependency

```bash
npm i mixpanel-browser
```

CI/build must include this package (add to `package.json` dependencies).

---

## 3. Code

| File | Role |
|------|------|
| `src/observability/mixpanel.js` | Init + `trackAction` / `trackError` |
| `src/observability/datadogRum.js` | Thin re-export (compat) |
| `src/main.js` | Calls `initMixpanel()` and tracks lifecycle |

Without `VITE_MIXPANEL_TOKEN`, init is a no-op and the game runs normally.

---

## 4. Verify in Mixpanel

1. Deploy with token set (or local `npm run dev` with `.env`)
2. Load the game once
3. EU Mixpanel → **Events** or **Live view** — expect `boot_start`, `webgpu_ready`, `world_ready`, `intro_complete`

---

## 5. Suggested Insights

- Daily unique sessions: unique `boot_start`
- WebGPU failure rate: `webgpu_fail` / `boot_start`
- Funnel: `boot_start` → `webgpu_ready` → `world_ready` → `intro_complete`

---

## 6. Privacy

- No PII in event props
- Autocapture off
- Respect DNT (`ignore_dnt: false`)

---

## 7. Not Mixpanel

- **CI / build** — GitHub Actions
- **Uptime** — Vercel / synthetic elsewhere
- **Docker health** — nginx `GET /` only
