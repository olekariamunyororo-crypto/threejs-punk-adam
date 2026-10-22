# Docker / GHCR

Container image for the static Vite build (nginx).

**Registry image:**

```text
ghcr.io/olekariamunyororo-crypto/threejs-punk-adam
```

## Local build & run

```bash
docker build -t threejs-punk-adam:local .
docker run --rm -p 8080:80 threejs-punk-adam:local
```

Open http://localhost:8080

> **WebGPU:** Browsers often require **HTTPS** (or `localhost`) for WebGPU. `localhost` is fine for local Docker. For remote hosts, put TLS in front (Caddy, Traefik, cloud load balancer).

## Pull from GHCR

After the **Docker / GHCR** workflow runs on `main`:

```bash
docker pull ghcr.io/olekariamunyororo-crypto/threejs-punk-adam:latest
docker run --rm -p 8080:80 ghcr.io/olekariamunyororo-crypto/threejs-punk-adam:latest
```

If the package is private, authenticate first:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

(`read:packages` scope on a PAT, or `GITHUB_TOKEN` in CI.)

## Tags

| Tag | When |
|-----|------|
| `latest` | Push to `main` |
| `main` | Branch ref |
| `sha-<short>` | Commit SHA |
| `1.2.3` | Git tag `v1.2.3` |

## CI

Workflow: [`.github/workflows/docker-ghcr.yml`](.github/workflows/docker-ghcr.yml)

- **PR:** build only (no push)
- **main / tags / manual:** build + push to GHCR

Uses `GITHUB_TOKEN` with `packages: write`. First package may appear under the repo **Packages** tab; set visibility (public/private) in package settings if needed.

## Layout

| File | Role |
|------|------|
| `Dockerfile` | Multi-stage: `npm ci` + `vite build` → nginx |
| `docker/nginx.conf` | SPA `try_files`, asset caching |
| `.dockerignore` | Keep build context small |

This image is **not** a multiplayer game server — only the static client. See `docs/AGENT_PLAYBOOK.md` §4 for realtime hosting.
