#!/usr/bin/env bash
# Install + configure fail2ban (sshd + nginx jails). DRY-RUN by default.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
MODE="dry"
usage() {
  cat <<USAGE
Usage: sudo $0 [--apply | --rollback] [--help]
  (default)  show what would be installed/copied
  --apply    apt-get install fail2ban (if missing), copy fail2ban/* into /etc/fail2ban,
             validate with 'fail2ban-client -t', then enable + reload
  --rollback remove files this kit installed (backups restored), reload fail2ban
Edit fail2ban/jail.d/exir.local first: ignoreip MUST list your own IPs.
USAGE
}
for a in "$@"; do case "$a" in
  --apply) MODE=apply;; --rollback) MODE=rollback;; -h|--help) usage; exit 0;;
  *) usage; die "unknown arg $a";; esac; done

SRC="$HERE/fail2ban"
FILES=(jail.d/exir.local filter.d/exir-nginx-auth.conf filter.d/exir-nginx-probe.conf filter.d/exir-nginx-limit.conf)

if [ "$MODE" = dry ]; then
  for f in "${FILES[@]}"; do log "would install $SRC/$f -> /etc/fail2ban/$f"; done
  grep -n 'ignoreip' "$SRC/jail.d/exir.local" || true
  grep -Eq '^ignoreip.*OWNER_IP_PLACEHOLDER' "$SRC/jail.d/exir.local" && warn "ignoreip still contains OWNER_IP_PLACEHOLDER - replace before --apply"
  log "DRY-RUN only."; exit 0
fi
need_root
if [ "$MODE" = rollback ]; then
  for f in "${FILES[@]}"; do
    t="/etc/fail2ban/$f"; b="$(ls -1t "$t".bak.* 2>/dev/null | head -n1 || true)"
    if [ -n "$b" ]; then cp -a -- "$b" "$t"; else rm -f -- "$t"; fi
  done
  fail2ban-client reload || true; log "rolled back"; exit 0
fi
grep -Eq '^ignoreip.*OWNER_IP_PLACEHOLDER' "$SRC/jail.d/exir.local" && die "replace OWNER_IP_PLACEHOLDER in ignoreip first (else you may ban yourself)"
have fail2ban-client || { log "installing fail2ban"; DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban; }
for f in "${FILES[@]}"; do
  backup_file "/etc/fail2ban/$f"
  install -m 0644 -D "$SRC/$f" "/etc/fail2ban/$f"
done
fail2ban-client -t || { warn "config test failed - rolling back"; "$0" --rollback; die "invalid fail2ban config"; }
systemctl enable --now fail2ban
fail2ban-client reload
fail2ban-client status
log "done. Check:  fail2ban-client status sshd"
