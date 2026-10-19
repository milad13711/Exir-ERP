#!/usr/bin/env bash
# Fast rollback of the backend to the previous image (tagged :previous by every backend deploy), then proxy reload + smoke suite.
# Works in two places:
#   * on the server:   bash /opt/exir-erp/rollback.sh
#   * from the laptop: ./scripts/rollback.sh        (pushes the helpers and runs them over SSH)
# No rebuild, no source change: it only retags and recreates, so it takes ~1-2 min (plus the ~60s boot migrations).
# NOTE: database migrations already applied by the bad release are NOT undone - roll forward fix if a migration was destructive.
set -euo pipefail

REMOTE_DIR="/opt/exir-erp"
if [ ! -f "${REMOTE_DIR}/docker-compose.on-premise.yml" ]; then
  cd "$(dirname "$0")/.."
  HOST="${DEPLOY_HOST:-root@45.94.215.22}"
  rsync -az scripts/deploy-lib.sh "${HOST}:${REMOTE_DIR}/deploy-lib.sh"
  rsync -az scripts/rollback.sh "${HOST}:${REMOTE_DIR}/rollback.sh"
  exec ssh -t "$HOST" "bash ${REMOTE_DIR}/rollback.sh $*"
fi

cd "$REMOTE_DIR"
RUN_ID="rollback-$(date +%Y%m%d%H%M%S)"
# shellcheck source=deploy-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/deploy-lib.sh"

IMG="$(backend_image)"
if ! docker image inspect "${IMG}:previous" >/dev/null 2>&1; then
  echo "ERROR: no ${IMG}:previous image on this host (first deploy with the new scripts, or it was pruned). Rollback by git: redeploy the previous commit with ./scripts/deploy.sh backend." >&2
  exit 1
fi
echo "==> Rolling back backend: ${IMG}:latest <- ${IMG}:previous ($(docker image inspect -f '{{.Id}}' "${IMG}:previous" | cut -c1-19))"
read -r -p "Proceed? [y/N] " ans </dev/tty || ans="${ROLLBACK_YES:-n}"
[ "${ans}" = "y" ] || [ "${ROLLBACK_YES:-}" = "y" ] || { echo "aborted"; exit 1; }

maintenance_start
docker tag "${IMG}:previous" "${IMG}:latest"
compose up -d --force-recreate --no-build backend
sleep 5
docker logs "$BACKEND_CONTAINER" --tail 15
waited=0
until docker exec "$BACKEND_CONTAINER" node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3001)+"/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
  [ "$waited" -ge "$SMOKE_TIMEOUT_SEC" ] && break
  sleep 5; waited=$((waited + 5))
done
reload_proxy
if smoke_suite; then
  docker tag "${IMG}:previous" "${IMG}:last-good"
  maintenance_clear
  echo "==> ROLLBACK OK"
else
  echo "==> ROLLBACK smoke suite FAILED - investigate: docker logs ${BACKEND_CONTAINER}" >&2
  exit 1
fi
