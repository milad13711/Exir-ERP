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
