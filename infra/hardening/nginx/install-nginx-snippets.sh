#!/usr/bin/env bash
# Installs the http-level snippets to /etc/nginx/conf.d/ and server-level ones to /etc/nginx/exir/.
# It does NOT edit any sites-enabled vhost: you add `include` lines yourself (see README). DRY-RUN by default.
# Safety: backs up /etc/nginx to a tarball, runs `nginx -t`; on failure restores the files it touched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
. "$HERE/../lib.sh"
MODE=dry
usage() { cat <<U
Usage: sudo $0 [--apply | --rollback] [--help]
  (default)  list what would be copied
  --apply    tar backup of /etc/nginx -> /root/nginx-backup-<ts>.tgz, copy files, nginx -t, reload
  --rollback restore the most recent /root/nginx-backup-*.tgz over /etc/nginx and reload
NOTE: real-ip.conf is installed with all set_real_ip_from lines COMMENTED -> no behaviour change until you edit it.
      rate-limit.conf only defines zones; limits start when a vhost includes rate-limit-server.conf.
U
}
for a in "$@"; do case "$a" in --apply) MODE=apply;; --rollback) MODE=rollback;; -h|--help) usage; exit 0;; *) usage; die "unknown arg $a";; esac; done
HTTP_FILES=("hide-version.conf:exir-00-hide-version.conf" "tls.conf:exir-10-tls.conf" "real-ip.conf:exir-20-real-ip.conf" "rate-limit.conf:exir-30-rate-limit.conf" "security-headers.conf:exir-40-headers-map.conf")
SRV_FILES=(security-headers-server.conf hsts.conf rate-limit-server.conf block-bots-probes.conf)
if [ "$MODE" = dry ]; then
  for p in "${HTTP_FILES[@]}"; do log "would copy $HERE/${p%%:*} -> /etc/nginx/conf.d/${p##*:}"; done
  for f in "${SRV_FILES[@]}"; do log "would copy $HERE/$f -> /etc/nginx/exir/$f"; done
  log "DRY-RUN only."; exit 0
fi
need_root; have nginx || die "nginx not installed"
if [ "$MODE" = rollback ]; then
  b="$(ls -1t /root/nginx-backup-*.tgz 2>/dev/null | head -n1 || true)"; [ -n "$b" ] || die "no backup found"
  for p in "${HTTP_FILES[@]}"; do rm -f "/etc/nginx/conf.d/${p##*:}"; done
  rm -rf /etc/nginx/exir
  tar -C / -xzf "$b"; nginx -t && systemctl reload nginx; log "restored $b"; exit 0
fi
nginx -t || die "current nginx config is already invalid; fix first"
B="/root/nginx-backup-$RUN_TS.tgz"; tar -C / -czf "$B" etc/nginx; chmod 600 "$B"; log "backup: $B"
install -d -m 0755 /etc/nginx/exir
for p in "${HTTP_FILES[@]}"; do install -m 0644 "$HERE/${p%%:*}" "/etc/nginx/conf.d/${p##*:}"; done
for f in "${SRV_FILES[@]}"; do install -m 0644 "$HERE/$f" "/etc/nginx/exir/$f"; done
if nginx -t; then systemctl reload nginx; log "nginx reloaded. Rollback: sudo $0 --rollback"
else
  warn "nginx -t failed - restoring"; for p in "${HTTP_FILES[@]}"; do rm -f "/etc/nginx/conf.d/${p##*:}"; done
  rm -rf /etc/nginx/exir; tar -C / -xzf "$B"; nginx -t; die "reverted"
fi
