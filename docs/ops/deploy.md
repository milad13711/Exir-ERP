# Production deploy, smoke checks, rollback

Entry point from the laptop (repo root): `./scripts/deploy.sh [backend] [web] [admin] | --smoke-only`.
It rsyncs source, pushes `deploy-remote.sh` + `deploy-lib.sh` + `rollback.sh` to `/opt/exir-erp`, and runs the remote script detached (survives SSH drops).
The deploy exit code is the smoke suite's: non-zero = something is wrong, and the failing check is printed.

## What a backend deploy does (in order)
1. Builds the image (one service at a time: 3.8 GB RAM, no swap).
2. **Pre-deploy image smoke test** - `docker compose run --rm --no-deps --entrypoint node backend dist/scripts/smoke-image.js` in a *throwaway* container from the NEW image (source: `apps/backend-core/src/scripts/smoke-image.ts`). No DB connection. Checks: `dist/main.js` & friends, prisma schemas/migrations dirs, generated clients, `tsx`/`prisma` binaries, every relative import of `prisma/control/seed.ts` resolves *inside the image* (a `src/` path only counts as a fallback if its `dist/` twin exists - the 2026-10-19 crash), the seed's dist dependency + both generated clients import, and the whole `AppModule` import graph loads (catches `ERR_MODULE_NOT_FOUND` anywhere in `dist`). On failure: deploy aborts, `:latest` is retagged to the running image, **the live container is not touched**.
3. Tags `exir-erp-backend:previous` (= `:last-good` if present, else the running image) - rollback target.
4. Sets the **monitoring maintenance window** (20 min): owner SMS suppressed, still logged. Best-effort (the very first deploy of this feature has an old backend without the endpoint -> warning, continues).
5. Recreates the container, waits for in-container `/api/health`.
6. **Always reloads the proxy nginx** (`nginx -t` then `nginx -s reload`). Reason: the `proxy` container resolves `backend`/`web` only at start; a recreated container has a new IP and the proxy would 502 until reloaded. Also done after web/admin recreates.
7. Prunes, edge-cache warm (web), then the **post-deploy smoke suite** (retries up to 240 s; migrate-all-tenants takes ~60 s after boot):

| check | passes when |
|---|---|
| health via proxy | `GET 127.0.0.1:8080/api/health` with `Host: $SMOKE_HOST` = 200 and `"ok":true` |
| license status | `/api/license/status` has `mode`; **FAIL** if `on_premise` while the control DB has >1 tenant (modules would be rejected) |
| control DB migrations | no `_prisma_migrations` row with `finished_at IS NULL` (rolled-back rows excluded) |
| tenant DB migrations | same, in every non-system database (names only are printed) |
| backend container | running, not Restarting, restart count unchanged (crash loop = immediate FAIL, no waiting) |
| other containers | web admin marketing proxy postgres running |
| backend boot log | last 100 lines free of `ERR_MODULE_NOT_FOUND`, `Cannot find module`, `Migration failed for tenant`, unhandled rejections, FATAL |

On PASS: `:last-good` tagged, maintenance window cleared, `==> DEPLOY OK`. On FAIL: summary lists `* <check>: <detail>`, exit 1, window left to expire (external uptime monitor still covers a dead server).
Run the suite alone any time: `./scripts/deploy.sh --smoke-only` (or `bash /opt/exir-erp/deploy-remote.sh --smoke-only` on the server).

Tunables (env on the server shell): `SMOKE_HOST` (default `app.eta.co.ir`), `PROXY_PORT` (8080), `SMOKE_TIMEOUT_SEC` (240), `MAINTENANCE_MINUTES` (20), `COMPOSE_PROJECT_NAME`.

## Rollback (about 2 minutes, no rebuild)
```
./scripts/rollback.sh              # from the laptop (SSH), or: bash /opt/exir-erp/rollback.sh on the server
```
Confirms, sets maintenance, `docker tag :previous -> :latest`, `up -d --force-recreate --no-build backend`, reloads the proxy, runs the smoke suite, tags `:last-good`. Caveat: DB migrations the bad release already applied are **not** undone (check the release's migrations; if destructive, roll forward instead). If `:previous` is missing, `git`-checkout the old commit and `./scripts/deploy.sh backend`.
Manual equivalent: `docker tag exir-erp-backend:previous exir-erp-backend:latest && docker compose -f docker-compose.on-premise.yml up -d --force-recreate --no-build backend && docker compose -f docker-compose.on-premise.yml exec -T proxy nginx -s reload`.

## Monitoring maintenance mode
See `infra/hardening/monitoring/README.md` ("حالت نگه‌داری"). `POST /api/internal/maintenance {minutes, reason}` (token header, loopback only), 5-minute boot grace after every backend start (`MONITOR_BOOT_GRACE_MIN`), security host alerts and the external uptime monitor are never silenced.

## Owner TODO on the server (names only)
- `.env`: `INTERNAL_ALERT_TOKEN` (>= 32 chars) must be set, otherwise the maintenance call is skipped with a warning. Optional: `MONITOR_BOOT_GRACE_MIN`.
- Confirm the proxy is published on `127.0.0.1:8080` and the public host header (`SMOKE_HOST`) matches your nginx `server_name`.
- Confirm `DEPLOYMENT_MODE=CLOUD` on the multi-tenant host (the suite fails otherwise).
- Known gap (not fixed here): make the proxy resolve upstreams dynamically (`resolver 127.0.0.11` + variable `proxy_pass`) so the reload is no longer required; the reload step stays as the safe default.
