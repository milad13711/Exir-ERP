#!/usr/bin/env bash
# READ-ONLY host security audit. Changes NOTHING. Prints PASS/FAIL/WARN/SKIP per check.
# Usage: sudo ./audit-host.sh [--app-dir /opt/exir-erp] [--backup-dir /path] [--domains a.com,b.com] [--help]
# Exit code: number of FAILs (capped at 100). Never prints secret values.
set -uo pipefail
APP_DIR=/opt/exir-erp; BACKUP_DIR=""; DOMAINS=""
while [ $# -gt 0 ]; do case "$1" in
  --app-dir) APP_DIR="${2:?}"; shift 2;; --backup-dir) BACKUP_DIR="${2:?}"; shift 2;;
  --domains) DOMAINS="${2:?}"; shift 2;;
  -h|--help) sed -n 2,4p "$0"; exit 0;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
FAILS=0; WARNS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
warnm(){ printf 'WARN  %s\n' "$*"; WARNS=$((WARNS+1)); }
skip() { printf 'SKIP  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
[ "$(id -u)" -eq 0 ] || echo "note: not root - some checks will be SKIPped"

echo "== SSH =="
if have sshd && [ "$(id -u)" -eq 0 ]; then
  S="$(sshd -T 2>/dev/null || true)"
  chk() { v="$(printf '%s\n' "$S" | awk -v k="$1" '$1==k{print $2; exit}')"; if [ "$v" = "$2" ]; then pass "sshd $1=$v"; else fail "sshd $1=${v:-?} (want $2)"; fi; }
  chk passwordauthentication no
  chk kbdinteractiveauthentication no
  chk permitrootlogin prohibit-password
  chk x11forwarding no
  v="$(printf '%s\n' "$S" | awk '$1=="maxauthtries"{print $2}')"; [ "${v:-99}" -le 4 ] && pass "maxauthtries=$v" || fail "maxauthtries=${v:-?} (want <=4)"
else skip "sshd -T needs root + sshd"; fi

echo "== fail2ban =="
if have systemctl && systemctl is-active --quiet fail2ban 2>/dev/null; then
  pass "fail2ban active"
  if have fail2ban-client && [ "$(id -u)" -eq 0 ]; then
    fail2ban-client status 2>/dev/null | grep -i 'jail list' || true
    fail2ban-client status sshd >/dev/null 2>&1 && pass "sshd jail enabled" || fail "sshd jail missing"
  fi
else fail "fail2ban not active"; fi

echo "== Firewall / listeners =="
if have ufw && [ "$(id -u)" -eq 0 ]; then ufw status 2>/dev/null | grep -qi 'Status: active' && pass "ufw active" || fail "ufw inactive"; else skip "ufw"; fi
if have ss; then
  for p in 8080 8081 8082 8084 3000 4001 5432; do
    pub="$(ss -H -ltn "sport = :$p" 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.0\.0\.1|\[::1\]|::1)' || true)"
    listening="$(ss -H -ltn "sport = :$p" 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$listening" = 0 ]; then skip "port $p not listening"
    elif [ -z "$pub" ]; then pass "port $p bound to loopback only"
    else fail "port $p listens on non-loopback: $(echo "$pub" | tr '\n' ' ')"; fi
  done
else skip "ss missing"; fi
if have iptables && [ "$(id -u)" -eq 0 ]; then iptables -S DOCKER-USER 2>/dev/null | grep -q EXIR-DOCKER-GUARD && pass "DOCKER-USER guard present" || warnm "DOCKER-USER guard not installed (optional defense in depth)"; fi

echo "== nginx =="
if have nginx; then
  [ "$(id -u)" -eq 0 ] && { nginx -t >/dev/null 2>&1 && pass "nginx -t ok" || fail "nginx -t fails"; }
  T="$(nginx -T 2>/dev/null || true)"
  [ -n "$T" ] && {
    echo "$T" | grep -Eq 'server_tokens[[:space:]]+off' && pass "server_tokens off" || fail "server_tokens not off"
    echo "$T" | grep -q 'limit_req_zone' && pass "limit_req_zone defined" || fail "no rate limiting configured"
    echo "$T" | grep -q 'X-Content-Type-Options' && pass "security headers configured" || fail "security headers missing"
    echo "$T" | grep -Eq 'ssl_protocols[[:space:]]+TLSv1.2 TLSv1.3;' && pass "TLS 1.2/1.3 only" || warnm "ssl_protocols not strictly 1.2/1.3 in config"
  }
else skip "nginx not installed"; fi
if [ -n "$DOMAINS" ] && have curl; then
  IFS=, read -ra D <<<"$DOMAINS"
  for d in "${D[@]}"; do
    h="$(curl -skI --max-time 10 "https://$d/" 2>/dev/null || true)"
    if [ -z "$h" ]; then warnm "$d: no HTTPS response"; continue; fi
    echo "$h" | grep -qi '^strict-transport-security' && pass "$d HSTS" || warnm "$d no HSTS"
    echo "$h" | grep -qi '^x-content-type-options' && pass "$d nosniff" || warnm "$d no nosniff"
    echo "$h" | grep -qi '^server: nginx/' && warnm "$d leaks nginx version"
  done
fi

echo "== Certificates =="
if have openssl && ls /etc/letsencrypt/live/*/cert.pem >/dev/null 2>&1; then
  now=$(date +%s)
  for c in /etc/letsencrypt/live/*/cert.pem; do
    [ -r "$c" ] || { skip "cannot read $c"; continue; }
    e="$(openssl x509 -enddate -noout -in "$c" | cut -d= -f2)"
    t="$(date -d "$e" +%s 2>/dev/null || echo 0)"; d=$(( (t-now)/86400 ))
    n="$(basename "$(dirname "$c")")"
    [ "$t" -eq 0 ] && warnm "$n: cannot parse date" || { [ "$d" -lt 14 ] && fail "$n expires in ${d}d" || { [ "$d" -lt 30 ] && warnm "$n expires in ${d}d" || pass "$n expires in ${d}d"; }; }
  done
else skip "no letsencrypt certs readable"; fi

echo "== Updates =="
if have dpkg && dpkg -s unattended-upgrades >/dev/null 2>&1; then
  pass "unattended-upgrades installed"
  grep -Rqs 'APT::Periodic::Unattended-Upgrade "1"' /etc/apt/apt.conf.d/ && pass "periodic unattended upgrade enabled" || fail "APT::Periodic::Unattended-Upgrade not 1"
else fail "unattended-upgrades not installed"; fi
[ -f /var/run/reboot-required ] && warnm "reboot required (pending kernel/libc update)" || pass "no reboot pending"

echo "== Files =="
perm() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }
if [ -d "$APP_DIR" ]; then
  for f in "$APP_DIR"/.env*; do
    [ -e "$f" ] || continue
    m="$(perm "$f")"
    case "$f" in *.bak*|*.save|*.old|*~) warnm "stale env copy: $f (mode $m) - shred after confirming";; esac
    case "$m" in 600|400) pass "$f mode $m";; *) fail "$f mode $m (want 600)";; esac
  done
else skip "$APP_DIR not found"; fi
if [ -z "$BACKUP_DIR" ]; then for c in "$APP_DIR/backups" /var/backups/exir /opt/exir-backups; do [ -d "$c" ] && BACKUP_DIR="$c" && break; done; fi
if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
  m="$(perm "$BACKUP_DIR")"; case "$m" in 700|750) pass "backup dir $BACKUP_DIR mode $m";; *) fail "backup dir $BACKUP_DIR mode $m (want 700/750)";; esac
  w="$(find "$BACKUP_DIR" -maxdepth 2 -type f -perm -o+r 2>/dev/null | head -n1)"; [ -z "$w" ] && pass "no world-readable backup files" || fail "world-readable backup file e.g. $w"
else skip "backup dir not found (pass --backup-dir)"; fi
[ -S /var/run/docker.sock ] && { m="$(perm /var/run/docker.sock)"; [ "$m" = 660 ] && pass "docker.sock mode 660" || warnm "docker.sock mode $m"; }

echo "== Disk =="
u="$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5+0}')"
if [ -z "$u" ]; then skip "df unavailable"; elif [ "$u" -ge 85 ]; then fail "/ usage ${u}%"; else pass "/ usage ${u}%"; fi

echo "== Docker daemon =="
if [ -f /etc/docker/daemon.json ]; then
  j="$(cat /etc/docker/daemon.json)"
  echo "$j" | grep -q 'max-size' && pass "log rotation (max-size)" || fail "daemon.json: no log max-size"
  echo "$j" | grep -q 'no-new-privileges' && pass "no-new-privileges default" || warnm "daemon.json: no-new-privileges unset"
  echo "$j" | grep -Eq '"live-restore"[[:space:]]*:[[:space:]]*true' && pass "live-restore" || warnm "live-restore off"
else fail "/etc/docker/daemon.json missing (no log rotation)"; fi

echo; echo "Result: $FAILS FAIL, $WARNS WARN"
[ "$FAILS" -gt 100 ] && FAILS=100
exit "$FAILS"
