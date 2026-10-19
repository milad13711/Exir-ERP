#!/usr/bin/env bash
# Runs ON the production server (/opt/exir-erp). Builds and deploys backend,
# web-panel, and admin-panel ONE AT A TIME, never concurrently.
#
# Why sequential: this box has 3.8GB RAM and zero swap. Building all three
# Next.js/Nest images at once (the default with `docker compose build a b c`)
# exhausts memory and makes the ENTIRE host unresponsive — including live
# traffic to tenants, not just the deploy itself. This happened for real on
# 2026-09-01 (~15 minutes of downtime). Building one at a time uses well
# under 1GB and leaves the live containers untouched and serving throughout.
#
# Safety nets (added after the 2026-10-19 incident, see docs/ops/deploy.md):
#   * backend: the freshly built image is smoke-tested in a throwaway container BEFORE the live one is touched;
#     failure aborts the deploy and the old container keeps serving.
#   * monitoring maintenance window (owner SMS suppressed ~20 min) around the recreate.
#   * proxy nginx is ALWAYS reloaded after a backend/web/admin recreate (stale upstream IP => 502 otherwise).
#   * post-deploy smoke suite through the proxy path; non-zero exit on FAIL with the failing check printed.
#   * previous backend image kept as :previous / :last-good for scripts/rollback.sh.
#
# Usage: bash deploy-remote.sh [service ...]
#   No args: deploys backend, web, admin in that order.
#   With args: deploys only the named services, in the order given —
#   e.g. `bash deploy-remote.sh web` after a frontend-only change.
#   --smoke-only: just run the post-deploy smoke suite against what is running.
set -euo pipefail
cd /opt/exir-erp
RUN_ID="${RUN_ID:-$(date +%Y%m%d%H%M%S)}"
# shellcheck source=deploy-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/deploy-lib.sh"

if [ "${1:-}" = "--smoke-only" ]; then
  smoke_suite
  exit $?
fi

# The backend container runs as a non-root user (uid 100, gid 101 — see
# Dockerfile's `USER exir`), which can't chown a host bind mount at
# runtime. A freshly-created (or freshly-provisioned-on-a-new-server)
# ./backups directory defaults to root:root, so the daily backup cron
# fails silently with EACCES on every write until someone notices in the
# logs — this happened for real in production. Idempotent, so safe on
# every deploy, including the first one on a brand-new host.
mkdir -p ./backups
chown -R 100:101 ./backups

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then
  SERVICES=(backend web admin)
fi

BACKEND_IMG="$(backend_image)"
BACKEND_DEPLOYED=0
# "Restart count unchanged" baseline: a recreated backend starts at 0; if the backend is not part of this deploy, use what it has now.
SMOKE_BASE_RESTARTS=0
if ! printf '%s\n' "${SERVICES[@]}" | grep -qx backend; then
  SMOKE_BASE_RESTARTS="$(docker inspect -f '{{.RestartCount}}' "$BACKEND_CONTAINER" 2>/dev/null || echo 0)"
fi

for svc in "${SERVICES[@]}"; do
  echo "==> [$svc] building..."
  RUNNING_ID=""
  if [ "$svc" = "backend" ]; then
    RUNNING_ID="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  fi
  compose build "$svc"

  if [ "$svc" = "backend" ]; then
    echo "==> [backend] PRE-DEPLOY image smoke test (throwaway container, no DB access, live container untouched)..."
    if ! timeout 300 docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T --entrypoint node backend dist/scripts/smoke-image.js; then
      echo "==> [backend] IMAGE SMOKE TEST FAILED - aborting deploy; the running backend container was NOT touched." >&2
      # The build moved the :latest tag; point it back so a later `compose up` cannot pick the bad image.
      if [ -n "$RUNNING_ID" ]; then docker tag "$RUNNING_ID" "${BACKEND_IMG}:latest" || true; fi
      exit 1
    fi
    tag_previous_before_recreate "$BACKEND_IMG"
    maintenance_start
  fi

  echo "==> [$svc] recreating container..."
  compose up -d --force-recreate "$svc"

  echo "==> [$svc] waiting for it to report healthy logs..."
  sleep 5
  docker logs "exir-erp-${svc}-1" --tail 15

  if [ "$svc" = "backend" ]; then
    BACKEND_DEPLOYED=1
    # Wait for the app itself (container-local), then reload the proxy so it re-resolves the new IP.
    echo "==> [backend] waiting for /api/health inside the container (up to ${SMOKE_TIMEOUT_SEC}s)..."
    waited=0
    until docker exec "$BACKEND_CONTAINER" node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3001)+"/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
      if [ "$waited" -ge "$SMOKE_TIMEOUT_SEC" ]; then echo "  backend not healthy after ${waited}s (continuing to smoke suite for a precise failure)"; break; fi
      sleep 5; waited=$((waited + 5))
    done
  fi
  # web/admin are upstream targets of the proxy too (web certainly): same stale-IP problem.
  reload_proxy
done

# The server disk is small (24G): build cache and dangling images from old builds
# filled it once and failed a deploy ("no space left on device"). Safe to prune —
# running containers and volumes are untouched.
echo "==> Pruning build cache and dangling images..."
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
journalctl --vacuum-size=200M >/dev/null 2>&1 || true
df -h / | tail -1

echo "==> Final status:"
compose ps --format 'table {{.Name}}\t{{.Status}}'

# The link from ArvanCloud's edge back to this origin (still inside Iran)
# intermittently drops larger responses — observed as real, repeatable 502s
# on _next/static/*.js chunks specifically (small HTML documents come
# through fine; see conversation 2026-09-14). A stale cache miss at Arvan's
# edge means a real visitor's browser hits that same flaky origin fetch and
# gets a blank page (JS never loads). Real fix is serving static assets
# from storage outside this path entirely; until that's set up, proactively
# re-requesting every static file through the PUBLIC domain right after a
# deploy — retrying past the flakiness ourselves — populates Arvan's edge
# cache before any real visitor's request can be the one that hits a dead
# origin fetch.
for svc in "${SERVICES[@]}"; do
  if [ "$svc" = "web" ]; then
    echo "==> Warming ArvanCloud's edge cache for static assets..."
    failed=0
    warmed=0
    while IFS= read -r rel; do
      url="https://app.eta.co.ir/_next/static/${rel}"
      ok=0
      for attempt in 1 2 3 4 5 6; do
        code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$url" || echo 000)"
        if [ "$code" = "200" ]; then
          ok=1
          break
        fi
        sleep 2
      done
      if [ "$ok" = "1" ]; then
        warmed=$((warmed + 1))
      else
        failed=$((failed + 1))
        echo "  WARNING: could not warm ${url} after 6 attempts"
      fi
    done < <(docker exec exir-erp-web-1 find .next/static -type f 2>/dev/null | sed 's|^\.next/static/||')
    echo "==> Cache warming done: ${warmed} ok, ${failed} failed"
  fi
done

# Final gate. Runs for every deploy (not just backend): proxy path, license mode, migrations, containers, boot log.
if smoke_suite; then
  if [ "$BACKEND_DEPLOYED" = 1 ]; then
    docker tag "$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER")" "${BACKEND_IMG}:last-good" && echo "==> Tagged ${BACKEND_IMG}:last-good"
    maintenance_clear
  fi
  echo "==> DEPLOY OK"
else
  echo "==> DEPLOY FAILED SMOKE SUITE (see summary above). Maintenance window (if set) stays until it expires; the external uptime monitor is unaffected." >&2
  exit 1
fi
