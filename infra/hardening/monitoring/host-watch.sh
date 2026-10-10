#!/usr/bin/env bash
# host-watch.sh - host-level watcher for things the app container cannot see.
# Meant for a systemd timer (every 5 min) as root on the production server. NOT executed by CI / the repo tooling.
#
# Checks: new successful SSH logins (allow-list), fail2ban ban spikes, nginx 5xx spikes, unhealthy/restarting docker
# containers, disk >85%, pending reboot, certificate expiry (check-certs.sh), failed systemd units.
# Delivery: POST http://<backend>/api/internal/alert with header X-Internal-Alert-Token (INTERNAL_ALERT_TOKEN).
#   The backend dedupes per kind per day, enforces a daily SMS cap and sends via the platform SMS channel.
#   Failed deliveries are spooled and retried on the next run; every alert is also written to syslog (logger).
#
# Usage:
#   host-watch.sh                 normal run (timer)
#   host-watch.sh --dry-run       run all checks, print alerts instead of sending, do not touch state
#   host-watch.sh --selftest      send one test alert through the backend endpoint (verifies token + routing)
#   host-watch.sh --learn-ssh     append the IPs/fingerprints of recent SSH logins (last 30 days) to the allow-list
#   host-watch.sh --help
#
# Config: /etc/exir/host-watch.env (mode 600, root) - see host-watch.env.example. Never put the token in this file.
set -uo pipefail

CONF="${HOST_WATCH_CONF:-/etc/exir/host-watch.env}"
DRY=0; MODE=run
for a in "$@"; do case "$a" in
  --dry-run) DRY=1;; --selftest) MODE=selftest;; --learn-ssh) MODE=learn;;
  -h|--help) sed -n 2,19p "$0"; exit 0;;
  *) echo "unknown arg: $a" >&2; exit 2;; esac; done

# ---- defaults (override in $CONF) -------------------------------------------------------------
STATE_DIR=/var/lib/exir-host-watch
SSH_ALLOWLIST=/etc/exir/known-ssh.allow
ALERT_URL=""                         # e.g. http://127.0.0.1:3001/api/internal/alert (if backend is published on loopback)
BACKEND_CONTAINER=""                 # alternative: docker container name; its bridge IP is looked up each run
BACKEND_PORT=3001
INTERNAL_ALERT_TOKEN=""
NGINX_ACCESS_LOG=/var/log/nginx/access.log
NGINX_5XX_MIN=20                     # alert when >= this many 5xx since last run ...
NGINX_5XX_RATIO=10                   # ... AND they are >= this percent of requests
FAIL2BAN_SPIKE=25                    # new bans since last run
DISK_WARN_PCT=85
DISK_PATHS="/ /var/lib/docker"
EXPECTED_CONTAINERS=""               # space-separated names that must be running (empty = skip this part)
REBOOT_PENDING_DAYS=7
CERT_HOSTS=""                        # comma-separated, e.g. app.example.ir,admin.example.ir
CERT_WARN_DAYS=14
CERT_SCRIPT=""                       # default: check-certs.sh next to this repo copy or /usr/local/sbin/check-certs.sh
FAILED_UNITS_IGNORE=""               # extended-regex of unit names to ignore
HEARTBEAT=1
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"

TOKEN="${INTERNAL_ALERT_TOKEN:-}"
NOW=$(date +%s)
HOST=$(hostname -s 2>/dev/null || echo host)
have() { command -v "$1" >/dev/null 2>&1; }
log() { printf '[host-watch] %s\n' "$*" >&2; }

if [ "$DRY" -eq 0 ] && [ "$MODE" != learn ]; then
  mkdir -p "$STATE_DIR/spool" && chmod 700 "$STATE_DIR" || { log "cannot create $STATE_DIR"; exit 3; }
  exec 9>"$STATE_DIR/lock"; flock -n 9 || { log "another run in progress"; exit 0; }
fi
if [ -e "$CONF" ] && [ "$(stat -c %a "$CONF" 2>/dev/null)" != "600" ]; then log "WARN: $CONF should be mode 600"; fi

# ---- helpers -----------------------------------------------------------------------------------
json_escape() { printf '%s' "$1" | cut -c1-280 | tr -d '\000-\010\013\014\016-\037' | tr '\n\t' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

resolve_url() {
  if [ -n "$ALERT_URL" ]; then echo "$ALERT_URL"; return; fi
  if [ -n "$BACKEND_CONTAINER" ] && have docker; then
    local ip; ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$BACKEND_CONTAINER" 2>/dev/null | awk '{print $1}')
    [ -n "$ip" ] && { echo "http://$ip:$BACKEND_PORT/api/internal/alert"; return; }
  fi
  echo ""
}

post_json() { # body -> 0 on HTTP 2xx
  local url; url=$(resolve_url)
  [ -n "$url" ] && [ -n "$TOKEN" ] || return 1
  curl -fsS -o /dev/null --max-time 8 -X POST -H 'Content-Type: application/json' -H "X-Internal-Alert-Token: $TOKEN" --data "$1" "$url"
}

send() { # kind message [resolved]
  local kind="$1" msg="[$HOST] $2" resolved="${3:-false}" body
  body=$(printf '{"kind":"%s","message":"%s","resolved":%s}' "$(json_escape "$kind")" "$(json_escape "$msg")" "$resolved")
  if [ "$DRY" -eq 1 ]; then printf 'ALERT kind=%s resolved=%s msg=%s\n' "$kind" "$resolved" "$msg"; return; fi
  logger -t exir-host-watch -p user.crit -- "$kind: $msg" 2>/dev/null || true
  post_json "$body" || { printf '%s\n' "$body" > "$STATE_DIR/spool/$NOW.$RANDOM.json"; log "delivery failed; spooled ($kind)"; }
}

flush_spool() {
  local f n=0
  for f in $(ls -1 "$STATE_DIR/spool" 2>/dev/null | head -50); do
    # drop anything older than 6h - stale alerts are noise
    if [ $(( NOW - $(stat -c %Y "$STATE_DIR/spool/$f") )) -gt 21600 ]; then rm -f "$STATE_DIR/spool/$f"; continue; fi
    post_json "$(cat "$STATE_DIR/spool/$f")" && rm -f "$STATE_DIR/spool/$f" || break
    n=$((n+1)); [ "$n" -ge 20 ] && break
  done
}

# state-type check: bad/ok transitions produce one alert + one recovery
state_report() { # kind ok|bad message
  local flag="$STATE_DIR/bad.${1//[^A-Za-z0-9._-]/_}"
  if [ "$2" = bad ]; then
    send "$1" "$3"; [ "$DRY" -eq 1 ] || : > "$flag"
  elif [ -e "$flag" ] || [ "$DRY" -eq 1 -a "${DRY_SHOW_OK:-0}" = 1 ]; then
    send "$1" "${3:-back to normal}" true; [ "$DRY" -eq 1 ] || rm -f "$flag"
  fi
}
cursor_get() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
cursor_set() { [ "$DRY" -eq 1 ] || printf '%s' "$2" > "$STATE_DIR/$1"; }

# ---- checks ------------------------------------------------------------------------------------
ssh_lines_since() { # epoch -> sshd 'Accepted' lines
  if have journalctl; then
    journalctl -u ssh -u sshd --since "@$1" -o cat --no-pager 2>/dev/null | grep -E '^Accepted ' || true
  elif [ -r /var/log/auth.log ]; then grep -E 'sshd.*Accepted ' /var/log/auth.log | tail -200 || true
  fi
}

allow_match() { # type(ip|fp) value
  [ -r "$SSH_ALLOWLIST" ] || return 1
  local t v p
  while read -r t v _; do
    [ "$t" = "$1" ] || continue
    p="$v"
    # shellcheck disable=SC2053
    [[ "$2" == $p ]] && return 0
  done < <(grep -vE '^\s*(#|$)' "$SSH_ALLOWLIST")
  return 1
}

check_ssh() {
  local since; since=$(cursor_get ssh.cursor)
  [ -n "$since" ] || { cursor_set ssh.cursor "$NOW"; return; }   # first run: no backlog alerts
  local line user ip method fp
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    # Accepted publickey for USER from IP port N ssh2: ED25519 SHA256:xxxx
    method=$(awk '{print $2}' <<<"$line"); user=$(awk '{print $4}' <<<"$line"); ip=$(awk '{print $6}' <<<"$line")
    fp=$(grep -oE 'SHA256:[A-Za-z0-9+/]+' <<<"$line" | head -1)
    if [ "$method" != publickey ]; then
      send "ssh-login-$method:$user" "SSH login by $method (not key) user=$user ip=$ip"
    elif [ -n "$fp" ] && ! allow_match fp "$fp"; then
      # کلید ناشناس = مهم‌ترین سیگنال؛ همیشه هشدار (از هر IP).
      send "ssh-new-key:${fp//[^A-Za-z0-9]/_}" "SSH login with NEW key fingerprint $fp user=$user ip=$ip"
    elif ! allow_match ip "$ip"; then
      # کلید آشناست ولی IP تازه. با VPN/IP متغیر این مورد عادی است؛ پیش‌فرض فقط لاگ (journalctl -t exir-host-watch).
      # برای هشدار پیامکی: SSH_ALERT_KNOWN_KEY_NEW_IP=1 در /etc/exir/host-watch.env (اگر IP ثابت دارید).
      if [ "${SSH_ALERT_KNOWN_KEY_NEW_IP:-0}" = 1 ] || [ -z "$fp" ]; then
        send "ssh-new-ip:${ip//[^0-9a-fA-F.:]/_}" "SSH login from NEW IP $ip user=$user key=${fp:-?}"
      else
        log "ssh login with known key from new IP $ip user=$user (not alerted)"
      fi
    fi
  done < <(ssh_lines_since "$since")
  cursor_set ssh.cursor "$NOW"
}

learn_ssh() {
  mkdir -p "$(dirname "$SSH_ALLOWLIST")"; touch "$SSH_ALLOWLIST"; chmod 600 "$SSH_ALLOWLIST"
  local line ip fp added=0
  while IFS= read -r line; do
    ip=$(awk '{print $6}' <<<"$line"); fp=$(grep -oE 'SHA256:[A-Za-z0-9+/]+' <<<"$line" | head -1)
    allow_match ip "$ip" || { echo "ip $ip" >> "$SSH_ALLOWLIST"; echo "added ip $ip"; added=1; }
    [ -n "$fp" ] && ! allow_match fp "$fp" && { echo "fp $fp" >> "$SSH_ALLOWLIST"; echo "added fp $fp"; added=1; }
  done < <(ssh_lines_since $(( NOW - 30*86400 )))
  [ "$added" -eq 1 ] || echo "nothing new. Review $SSH_ALLOWLIST by hand (remove IPs that are NOT yours!)."
}

check_fail2ban() {
  have fail2ban-client || return 0
  local jails total=0 j n prev delta
  jails=$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:\s*//p' | tr -d ',')
  for j in $jails; do
    n=$(fail2ban-client status "$j" 2>/dev/null | sed -n 's/.*Total banned:\s*//p' | head -1); total=$(( total + ${n:-0} ))
  done
  prev=$(cursor_get f2b.total)
  if [ -n "$prev" ]; then
    delta=$(( total - prev )); [ "$delta" -lt 0 ] && delta=$total   # fail2ban restarted
    if [ "$delta" -ge "$FAIL2BAN_SPIKE" ]; then state_report fail2ban-spike bad "fail2ban: $delta new bans since last run (threshold $FAIL2BAN_SPIKE) - possible attack"
    else state_report fail2ban-spike ok "fail2ban ban rate back to normal"; fi
  fi
  cursor_set f2b.total "$total"
}

check_nginx() {
  [ -r "$NGINX_ACCESS_LOG" ] || return 0
  local size off out c5 tot
  size=$(stat -c %s "$NGINX_ACCESS_LOG"); off=$(cursor_get nginx.offset)
  if [ -z "$off" ] || [ "$off" -gt "$size" ]; then cursor_set nginx.offset "$size"; return; fi   # first run / log rotated
  out=$(tail -c +$((off+1)) "$NGINX_ACCESS_LOG" | head -c 50000000 | awk '{ if (match($0, /" [0-9][0-9][0-9] /)) { s=substr($0,RSTART+2,3); t++; if (s ~ /^5/) c++ } } END { print c+0, t+0 }')
  c5=${out% *}; tot=${out#* }
  if [ "$c5" -ge "$NGINX_5XX_MIN" ] && [ $(( c5 * 100 )) -ge $(( tot * NGINX_5XX_RATIO )) ]; then
    state_report nginx-5xx bad "nginx: $c5 HTTP 5xx of $tot requests since last check - backend may be failing"
  else state_report nginx-5xx ok "nginx 5xx rate back to normal"; fi
  cursor_set nginx.offset "$size"
}

check_docker() {
  have docker || return 0
  local bad ps; ps=$(docker ps -a --format '{{.Names}}|{{.Status}}' 2>/dev/null) || { state_report docker-cli bad "docker CLI/daemon not responding"; return; }
  state_report docker-cli ok "docker responding again"
  bad=$(grep -E '\(unhealthy\)|Restarting' <<<"$ps" | cut -d'|' -f1 | tr '\n' ' ')
  local missing=""
  for c in $EXPECTED_CONTAINERS; do grep -q "^$c|Up" <<<"$ps" || missing="$missing $c"; done
  if [ -n "$bad$missing" ]; then state_report docker-unhealthy bad "docker: unhealthy/restarting: ${bad:-none}; not running:${missing:- none}"
  else state_report docker-unhealthy ok "all containers healthy"; fi
}

check_disk() {
  local p pct bad=""
  for p in $DISK_PATHS; do
    [ -d "$p" ] || continue
    pct=$(df -P "$p" 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')
    [ -n "$pct" ] && [ "$pct" -gt "$DISK_WARN_PCT" ] && bad="$bad $p=${pct}%"
  done
  if [ -n "$bad" ]; then state_report host-disk bad "disk usage above ${DISK_WARN_PCT}%:$bad"; else state_report host-disk ok "disk usage back below ${DISK_WARN_PCT}%"; fi
}

check_reboot() {
  if [ -e /var/run/reboot-required ] && [ $(( NOW - $(stat -c %Y /var/run/reboot-required) )) -gt $(( REBOOT_PENDING_DAYS * 86400 )) ]; then
    state_report reboot-required bad "reboot pending for more than $REBOOT_PENDING_DAYS days (kernel/security updates not active). Pkgs: $(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null | cut -c1-120)"
  else state_report reboot-required ok "no pending reboot"; fi
}

check_certs() {
  [ -n "$CERT_HOSTS" ] || return 0
  local last; last=$(cursor_get certs.last); [ -n "$last" ] && [ $(( NOW - last )) -lt 86400 ] && return 0   # once a day
  local script="$CERT_SCRIPT" out
  [ -n "$script" ] || for s in /usr/local/sbin/check-certs.sh "$(dirname "$0")/../check-certs.sh"; do [ -x "$s" ] && script="$s" && break; done
  [ -n "$script" ] || { log "check-certs.sh not found"; return 0; }
  if out=$("$script" --warn "$CERT_WARN_DAYS" --live "$CERT_HOSTS" 2>&1); then state_report cert-expiry ok "certificates healthy"
  else state_report cert-expiry bad "certificate problem: $(grep -E 'FAIL|UNKNOWN' <<<"$out" | head -3 | tr '\n' ';')"; fi
  cursor_set certs.last "$NOW"
}

check_units() {
  have systemctl || return 0
  local failed; failed=$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}')
  [ -n "$FAILED_UNITS_IGNORE" ] && failed=$(grep -Ev "$FAILED_UNITS_IGNORE" <<<"$failed")
  failed=$(echo "$failed" | tr '\n' ' ' | sed 's/ *$//')
  if [ -n "$failed" ]; then state_report systemd-failed bad "failed systemd units: $failed"; else state_report systemd-failed ok "no failed units"; fi
}

# ---- main --------------------------------------------------------------------------------------
case "$MODE" in
  learn) learn_ssh; exit 0;;
  selftest)
    [ -n "$TOKEN" ] || { log "INTERNAL_ALERT_TOKEN missing in $CONF"; exit 2; }
    [ -n "$(resolve_url)" ] || { log "set ALERT_URL or BACKEND_CONTAINER in $CONF"; exit 2; }
    if post_json "$(printf '{"kind":"selftest:%s","message":"[%s] host-watch selftest OK"}' "$NOW" "$HOST")"; then echo "selftest delivered (check your phone / admin 'پایش و هشدار' page)"; else echo "selftest FAILED (token wrong? backend unreachable? INTERNAL_ALERT_TOKEN unset on the backend -> 404)"; exit 1; fi
    exit 0;;
esac

[ "$DRY" -eq 1 ] || flush_spool
for fn in check_ssh check_fail2ban check_nginx check_docker check_disk check_reboot check_certs check_units; do "$fn" || log "$fn errored"; done
[ "$DRY" -eq 0 ] && [ "$HEARTBEAT" = 1 ] && post_json '{"heartbeat":true}' || true
exit 0
