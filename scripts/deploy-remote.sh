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
# Usage: bash deploy-remote.sh [service ...]
#   No args: deploys backend, web, admin in that order.
#   With args: deploys only the named services, in the order given —
#   e.g. `bash deploy-remote.sh web` after a frontend-only change.
set -euo pipefail
cd /opt/exir-erp

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

for svc in "${SERVICES[@]}"; do
  echo "==> [$svc] building..."
  docker compose -f docker-compose.on-premise.yml build "$svc"

  echo "==> [$svc] recreating container..."
  docker compose -f docker-compose.on-premise.yml up -d --force-recreate "$svc"

  echo "==> [$svc] waiting for it to report healthy logs..."
  sleep 5
  docker logs "exir-erp-${svc}-1" --tail 15
done

echo "==> Final status:"
docker compose -f docker-compose.on-premise.yml ps --format 'table {{.Name}}\t{{.Status}}'

echo "==> Health check:"
curl -s -o /dev/null -w 'http_code=%{http_code} time=%{time_total}s\n' --max-time 10 http://localhost:8080/

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
