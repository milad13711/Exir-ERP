#!/usr/bin/env bash
# Certificate expiry check for the host. Read-only. Cron-able; exit 1 if any cert expires in < WARN days.
# Usage: check-certs.sh [--warn DAYS] [--live host1,host2] [--help]
#   default: scans /etc/letsencrypt/live/*/cert.pem
#   --live : additionally connects to host:443 (what visitors see; through CDN if proxied)
# Cron (daily 08:00, mail via local MTA or pipe to your SMS script):
#   0 8 * * * /usr/local/sbin/check-certs.sh --warn 14 || echo "cert problem on $(hostname)" | mail -s "CERT" you@example.com
set -euo pipefail
WARN=14; LIVE=""
while [ $# -gt 0 ]; do case "$1" in
  --warn) WARN="${2:?}"; shift 2;; --live) LIVE="${2:?}"; shift 2;;
  -h|--help) sed -n 2,9p "$0"; exit 0;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
command -v openssl >/dev/null || { echo "openssl missing" >&2; exit 2; }
now=$(date +%s); bad=0
epoch() { date -d "$1" +%s 2>/dev/null || date -j -f "%b %e %T %Y %Z" "$1" +%s 2>/dev/null || echo 0; }
report() { # name enddate
  local e d; e=$(epoch "$2"); d=$(( (e - now) / 86400 ))
  if [ "$e" -eq 0 ]; then echo "UNKNOWN $1"; bad=1
  elif [ "$d" -lt "$WARN" ]; then echo "FAIL  $1 expires in ${d}d"; bad=1
  else echo "OK    $1 expires in ${d}d"; fi; }
for c in /etc/letsencrypt/live/*/cert.pem; do
  [ -r "$c" ] || continue
  report "$(basename "$(dirname "$c")")" "$(openssl x509 -enddate -noout -in "$c" | cut -d= -f2)"
done
if [ -n "$LIVE" ]; then
  IFS=, read -ra H <<<"$LIVE"
  for h in "${H[@]}"; do
    end=$(echo | timeout 10 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
    if [ -z "$end" ]; then echo "FAIL  live:$h unreachable / no TLS"; bad=1; else report "live:$h" "$end"; fi
  done
fi
exit "$bad"
