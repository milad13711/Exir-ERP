#!/usr/bin/env bash
# Deploys local changes to the on-premise production server: rsyncs source,
# then builds+recreates the given services one at a time (never
# concurrently — see deploy-remote.sh for why that matters on this box).
#
# Runs the remote build detached (nohup + disown) and polls its log rather
# than blocking on a single SSH session: the SSH link to this host drops
# unpredictably (observed repeatedly, both on short and multi-minute
# commands — not specific to long builds), and a `docker compose build`
# run as a plain foreground child of that session gets SIGHUP'd and killed
# along with it, silently discarding a build that had almost finished.
# Detaching survives that; only the polling loop needs to reconnect.
#
# Usage (run from the repo root):
#   ./scripts/deploy.sh                  # deploy backend, web, admin
#   ./scripts/deploy.sh web               # deploy only web-panel
#   ./scripts/deploy.sh backend admin     # deploy only these two, in order
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="root@45.94.215.22"
REMOTE_DIR="/opt/exir-erp"
RUN_ID="$(date +%Y%m%d%H%M%S)"
REMOTE_LOG="/tmp/exir-deploy-${RUN_ID}.log"
REMOTE_DONE_MARKER="/tmp/exir-deploy-${RUN_ID}.done"

ssh_retry() {
  # A single SSH command, retried a few times before giving up — the
  # connection drop is transient, not a real failure of the command itself.
  local attempt=1
  until ssh -o ConnectTimeout=15 "$HOST" "$@"; do
    if [ "$attempt" -ge 5 ]; then
      echo "SSH command failed after ${attempt} attempts: $*" >&2
      return 1
    fi
    echo "  (SSH hiccup, retrying — attempt $((attempt + 1))/5)" >&2
    attempt=$((attempt + 1))
    sleep 5
  done
}

echo "==> Syncing source..."
rsync -az --delete --exclude node_modules --exclude .next --exclude dist --exclude generated \
  apps/backend-core/src/ "${HOST}:${REMOTE_DIR}/apps/backend-core/src/"
rsync -az --delete --exclude node_modules --exclude .next --exclude dist \
  apps/backend-core/docker-entrypoint.sh "${HOST}:${REMOTE_DIR}/apps/backend-core/docker-entrypoint.sh"
rsync -az --delete --exclude node_modules --exclude .next --exclude dist \
  apps/backend-core/prisma/ "${HOST}:${REMOTE_DIR}/apps/backend-core/prisma/"
rsync -az --delete --exclude node_modules --exclude .next --exclude dist \
  apps/web-panel/src/ "${HOST}:${REMOTE_DIR}/apps/web-panel/src/"
rsync -az --delete --exclude node_modules --exclude .next --exclude dist \
  apps/admin-panel/src/ "${HOST}:${REMOTE_DIR}/apps/admin-panel/src/"
rsync -az docker-compose.on-premise.yml "${HOST}:${REMOTE_DIR}/docker-compose.on-premise.yml"
rsync -az .dockerignore "${HOST}:${REMOTE_DIR}/.dockerignore"

echo "==> Pushing deploy script..."
rsync -az scripts/deploy-remote.sh "${HOST}:${REMOTE_DIR}/deploy-remote.sh"

echo "==> Launching detached remote build ($*)..."
ssh_retry "cd ${REMOTE_DIR} && nohup bash -c 'bash deploy-remote.sh $*; echo \$? > ${REMOTE_DONE_MARKER}' > ${REMOTE_LOG} 2>&1 & disown; echo launched"

echo "==> Polling ${REMOTE_LOG} (this can take several minutes)..."
last_size=0
while true; do
  sleep 10
  out="$(ssh_retry "test -f ${REMOTE_DONE_MARKER} && echo __DONE__ || true; tail -c +$((last_size + 1)) ${REMOTE_LOG} 2>/dev/null | head -c 4000")"
  if [ -n "$out" ]; then
    echo "$out" | grep -v '^__DONE__$' || true
  fi
  size="$(ssh_retry "wc -c < ${REMOTE_LOG} 2>/dev/null || echo 0")"
  last_size="${size:-$last_size}"
  if echo "$out" | grep -q '^__DONE__$'; then
    break
  fi
done

exit_code="$(ssh_retry "cat ${REMOTE_DONE_MARKER}")"
if [ "$exit_code" = "0" ]; then
  echo "==> Deploy succeeded."
else
  echo "==> Deploy FAILED (remote exit code ${exit_code}). Full log: ${REMOTE_LOG} on ${HOST}"
  exit 1
fi
