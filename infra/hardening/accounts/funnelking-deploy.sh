#!/bin/bash
# /usr/local/sbin/funnelking-deploy — the ONLY thing user `funnelking` may run as root (via sudo).
# Rebuilds funnelking-site from /opt/funnelking and replaces the container; rolls back automatically on failure.
# Usage: sudo /usr/local/sbin/funnelking-deploy [--no-pull] [--check]
set -euo pipefail
APP=/opt/funnelking; IMG=funnelking-site; CTR=funnelking-site-1; PORT=8084
PULL=1
for a in "$@"; do case "$a" in --no-pull) PULL=0;; --check) echo "ok: $(cd $APP && git rev-parse --short HEAD) image=$(docker images -q $IMG:latest)"; exit 0;; *) echo "unknown arg $a" >&2; exit 2;; esac; done
cd "$APP"
if [ "$PULL" = 1 ]; then git pull --ff-only; fi
echo "building $(git rev-parse --short HEAD) ..."
docker tag "$IMG:latest" "$IMG:prev" 2>/dev/null || true
docker build -t "$IMG:latest" .
run() { docker run -d --name "$CTR" --restart unless-stopped -p 127.0.0.1:$PORT:3000 "$1" >/dev/null; }
docker rm -f "$CTR" >/dev/null 2>&1 || true
run "$IMG:latest"
ok=0; for i in $(seq 1 20); do sleep 2; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" || true); [ "$c" = 200 ] && { ok=1; break; }; done
if [ "$ok" = 1 ]; then echo "deployed OK ($(git rev-parse --short HEAD))"; docker image prune -f >/dev/null 2>&1 || true; exit 0; fi
echo "health check FAILED - rolling back to previous image" >&2
docker rm -f "$CTR" >/dev/null 2>&1 || true
docker image inspect "$IMG:prev" >/dev/null 2>&1 && run "$IMG:prev" && echo "rolled back" >&2
exit 1
