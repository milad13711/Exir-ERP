#!/usr/bin/env bash
# Full-rebuild drill: prove that "git repo + .env kept off-box + encrypted offsite S3 backups" is enough to bring
# the whole platform back on a FRESH Ubuntu 24.04 VM, and measure the RTO.   See docs/drill/full-rebuild-drill.md
#
# DRY-RUN by default (prints the plan and runs the safety guards that need no changes). Needs --execute to act.
# NEVER run this on production: it installs packages, downloads backups and restores databases.
#
#   sudo hostnamectl set-hostname exir-drill-1          # hostname MUST contain "drill"
#   export DRILL_ALLOW_HOST=exir-drill-1                 # you must name the machine you intend to run on
#   export DRILL_PROD_DOMAINS="app.example.ir admin.example.ir"   # refuse if this box answers for / resolves to them
#   export DRILL_PROD_IPS="203.0.113.10"                 # production public IP(s)
#   export DRILL_REPO_URL=git@github.com:ORG/Exir-ERP.git           # read-only deploy key/token on the VM
#   export DRILL_S3_BUCKET=... DRILL_S3_ACCESS_KEY_ID=... DRILL_S3_SECRET_ACCESS_KEY=...   # READ-ONLY credentials!
#   export DRILL_S3_ENDPOINT=https://...  DRILL_S3_REGION=...  DRILL_S3_PREFIX=exir-prod
#   ./rebuild-drill.sh --env-file /root/prod.env.from-offbox            # dry-run
#   ./rebuild-drill.sh --env-file /root/prod.env.from-offbox --execute  # for real
#
# Options: --env-file F (required)  --workdir D (/opt/exir-drill)  --ref GIT_REF (default main branch)
#          --max-tenants N (0 = all active tenants)  --expect slug=N (expected users count of a tenant, from prod admin)
#          --execute  --wipe (after a successful run: remove stack, volumes, .env, backups from this VM)  -h
set -euo pipefail
umask 077

EXECUTE=0; WIPE=0; ENV_FILE=""; WORKDIR=/opt/exir-drill; REF=""; MAX_TENANTS=0; EXPECT=""
while [ $# -gt 0 ]; do case "$1" in
  --execute) EXECUTE=1; shift;; --wipe) WIPE=1; shift;;
  --env-file) ENV_FILE="${2:-}"; shift 2;; --workdir) WORKDIR="${2:-}"; shift 2;;
  --ref) REF="${2:-}"; shift 2;; --max-tenants) MAX_TENANTS="${2:-0}"; shift 2;; --expect) EXPECT="${2:-}"; shift 2;;
  -h|--help) sed -n 2,22p "$0"; exit 0;; *) echo "unknown arg: $1" >&2; exit 2;; esac; done

die() { printf 'DRILL REFUSED/FAILED: %s\n' "$*" >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }
[ -n "$ENV_FILE" ] || die "--env-file is required (the .env copy you keep OFF the server)"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"
[[ "$WORKDIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "unsafe --workdir"
[[ "$MAX_TENANTS" =~ ^[0-9]+$ ]] || die "--max-tenants must be a number"

# ───────────────────────── production guards (run even in dry-run) ─────────────────────────
HOSTN="$(hostname -s)"
[[ "$HOSTN" == *drill* ]] || die "hostname '$HOSTN' does not contain 'drill'. Set one on the throwaway VM: hostnamectl set-hostname exir-drill-1"
[ "${DRILL_ALLOW_HOST:-}" = "$HOSTN" ] || die "set DRILL_ALLOW_HOST=$HOSTN to confirm this is the throwaway VM"
if [[ "$HOSTN" =~ (prod|production|live|eta) ]]; then die "hostname looks like production ($HOSTN)"; fi
for marker in /etc/exir /var/lib/exir-host-watch /opt/exir-erp /etc/fail2ban/jail.d/exir.local; do
  [ -e "$marker" ] && die "$marker exists - this machine looks like (or was) the production server"
done
command -v ip >/dev/null 2>&1 || die "'ip' command missing - cannot run the production-address guard (apt install iproute2)"
for d in ${DRILL_PROD_DOMAINS:-}; do
  [ -d "/etc/letsencrypt/live/$d" ] && die "certificate for production domain $d is on this machine"
  for ip in $(getent ahosts "$d" 2>/dev/null | awk '{print $1}' | sort -u); do
    ip -o addr show 2>/dev/null | grep -qw "$ip" && die "production domain $d resolves to an address of THIS machine ($ip)"
  done
done
for ip in ${DRILL_PROD_IPS//,/ }; do
  ip -o addr show 2>/dev/null | grep -qw "$ip" && die "this machine owns production IP $ip"
done
if command -v docker >/dev/null 2>&1 && [ -n "$(docker ps -q 2>/dev/null || true)" ] && ! docker ps --format '{{.Labels}}' | grep -q 'com.docker.compose.project=exirdrill'; then
  die "docker containers from another project are running - the drill needs a FRESH VM"
fi
export COMPOSE_PROJECT_NAME=exirdrill
COMPOSE_FILE_NAME=docker-compose.on-premise.yml
DC() { docker compose -f "$WORKDIR/$COMPOSE_FILE_NAME" --project-directory "$WORKDIR" "$@"; }
PSQL_CTRL() { DC exec -T postgres psql -X -U postgres -d exir_control -tAc "$1"; }

# ───────────────────────── step runner with timing ─────────────────────────
RESULTS="$PWD/drill-results-$(date +%Y%m%d-%H%M%S).md"
declare -a ROWS=(); T0=$(date +%s)
CURRENT=""; STEP_START=0
step() { # "name" "what happens" function  (errexit stays ON inside the function; the EXIT trap records a failure)
  local name="$1" desc="$2" fn="$3"
  if [ "$EXECUTE" -ne 1 ]; then printf '[dry-run] %-34s %s\n' "$name" "$desc"; return; fi
  say "$name"; CURRENT="$name"; STEP_START=$(date +%s)
  "$fn"
  ROWS+=("| $name | $(( $(date +%s) - STEP_START ))s | OK |"); CURRENT=""
}
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$EXECUTE" -eq 1 ] && [ -n "$CURRENT" ]; then
    ROWS+=("| $CURRENT | $(( $(date +%s) - STEP_START ))s | FAILED |"); write_results FAILED
  fi
}
trap on_exit EXIT
write_results() {
  { echo "# Rebuild drill result - $(date -u +%FT%TZ) - host $HOSTN"; echo; echo "Outcome: $1   Elapsed since script start (RTO, excl. VM creation): $(( $(date +%s) - T0 ))s"; echo
    echo "| Step | Duration | Result |"; echo "|---|---|---|"; printf '%s\n' "${ROWS[@]}"; } > "$RESULTS"
  echo "results written to $RESULTS"
}

# ───────────────────────── steps ─────────────────────────
s_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq ca-certificates curl git gnupg rsync rclone postgresql-client nodejs >/dev/null
  command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh >/dev/null; }
  docker compose version >/dev/null
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || die "Node >= 18 needed for backup-decrypt.mjs (install from nodesource)"
}
s_clone() {
  [ -n "${DRILL_REPO_URL:-}" ] || die "DRILL_REPO_URL not set"
  [ -e "$WORKDIR/.git" ] || git clone -q "$DRILL_REPO_URL" "$WORKDIR"
  [ -z "$REF" ] || git -C "$WORKDIR" checkout -q "$REF"
  git -C "$WORKDIR" log -1 --format='commit %h %cI' | tee -a "$RESULTS.meta"
}
s_env() {
  # .env from OFF-BOX copy, then neutralise everything that could touch real services or the real bucket.
  local overrides='BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_PREFIX EXIR_SMS_API_KEY EXIR_SMS_SENDER_LINE BACKUP_ALERT_PHONE MONITOR_ALERT_PHONE INTERNAL_ALERT_TOKEN ZARINPAL_MERCHANT_ID BAHA24_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY BACKUP_ENV_NAME MONITOR_DISABLED EXPOSED_BIND ADMIN_BIND MARKETING_BIND'
  local re; re="^($(echo "$overrides" | tr ' ' '|'))="
  grep -vE "$re" "$ENV_FILE" > "$WORKDIR/.env"
  { for k in BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_PREFIX EXIR_SMS_API_KEY EXIR_SMS_SENDER_LINE BACKUP_ALERT_PHONE MONITOR_ALERT_PHONE INTERNAL_ALERT_TOKEN ZARINPAL_MERCHANT_ID BAHA24_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do echo "$k="; done
    echo "BACKUP_ENV_NAME=drill"; echo "MONITOR_DISABLED=true"; echo "EXPOSED_BIND=127.0.0.1"; echo "ADMIN_BIND=127.0.0.1"; echo "MARKETING_BIND=127.0.0.1"; } >> "$WORKDIR/.env"
  chmod 600 "$WORKDIR/.env"
  grep -qE '^BACKUP_ENCRYPTION_KEY=.{32,}' "$WORKDIR/.env" || die "BACKUP_ENCRYPTION_KEY missing from the env file (drill would fail: that IS the finding - fix your off-box copy)"
  for k in POSTGRES_PASSWORD JWT_SECRET; do grep -qE "^$k=.+" "$WORKDIR/.env" || die "$k missing from the env file"; done
}
rc() { RCLONE_CONFIG_DRILL_TYPE=s3 RCLONE_CONFIG_DRILL_PROVIDER=Other RCLONE_CONFIG_DRILL_ACCESS_KEY_ID="$DRILL_S3_ACCESS_KEY_ID" RCLONE_CONFIG_DRILL_SECRET_ACCESS_KEY="$DRILL_S3_SECRET_ACCESS_KEY" RCLONE_CONFIG_DRILL_ENDPOINT="${DRILL_S3_ENDPOINT:-}" RCLONE_CONFIG_DRILL_REGION="${DRILL_S3_REGION:-}" rclone "$@"; }
KEYFILE=""
s_postgres() {
  # key to a mode-600 file (never on a command line)
  KEYFILE="$(mktemp)"; grep -E '^BACKUP_ENCRYPTION_KEY=' "$WORKDIR/.env" | head -1 | cut -d= -f2- | tr -d '"'"'" > "$KEYFILE"
  DC up -d postgres
  for _ in $(seq 1 60); do DC exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && return 0; sleep 2; done
  die "postgres did not become healthy"
}
fetch_latest() { # slug -> local path of newest .sql.gz.enc
  local slug="$1" newest
  newest="$(rc lsf "drill:${DRILL_S3_BUCKET}/${DRILL_S3_PREFIX}/${slug}/" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz\.enc$' | sort | tail -1)"
  [ -n "$newest" ] || { echo "no backup found for $slug in s3" >&2; return 1; }
  mkdir -p "$WORKDIR/backups/$slug"
  rc copyto "drill:${DRILL_S3_BUCKET}/${DRILL_S3_PREFIX}/${slug}/${newest}" "$WORKDIR/backups/$slug/$newest"
  node "$WORKDIR/scripts/backup-decrypt.mjs" --key-file "$KEYFILE" --verify "$WORKDIR/backups/$slug/$newest"
  echo "$slug: $newest verified (decrypt + authenticate OK, $(wc -c < "$WORKDIR/backups/$slug/$newest") bytes)" | tee -a "$RESULTS.meta"
  LAST_FETCHED="$WORKDIR/backups/$slug/$newest"
}
LAST_FETCHED=""
s_restore_control() {
  fetch_latest _control
  ( cd "$WORKDIR" && ./scripts/restore-control.sh --docker --compose-file "$COMPOSE_FILE_NAME" --key-file "$KEYFILE" --file "$LAST_FETCHED" )                 # dry-run integrity pass
  ( cd "$WORKDIR" && ./scripts/restore-control.sh --docker --compose-file "$COMPOSE_FILE_NAME" --key-file "$KEYFILE" --file "$LAST_FETCHED" --yes )
}
TENANT_LIST=""
s_restore_tenants() {
  TENANT_LIST="$(PSQL_CTRL "SELECT slug||'|'||\"dbName\" FROM tenants WHERE status='ACTIVE' ORDER BY slug")"
  [ -n "$TENANT_LIST" ] || die "control DB has no ACTIVE tenants - restore produced nothing useful"
  local n=0 slug db
  while IFS='|' read -r slug db; do
    [ -n "$slug" ] || continue
    [ "$MAX_TENANTS" -gt 0 ] && [ "$n" -ge "$MAX_TENANTS" ] && break
    [[ "$db" =~ ^exir_tenant_[A-Za-z0-9_]+$ ]] || { echo "skip $slug: unexpected dbName $db"; continue; }
    fetch_latest "$slug"
    ( cd "$WORKDIR" && ./scripts/restore-tenant.sh --docker --compose-file "$COMPOSE_FILE_NAME" --key-file "$KEYFILE" --file "$LAST_FETCHED" --db "$db" --yes ) >/dev/null
    echo "restored $slug -> $db" | tee -a "$RESULTS.meta"; n=$((n+1))
  done <<< "$TENANT_LIST"
}
s_start_stack() {
  DC up -d --build
  for _ in $(seq 1 90); do curl -fsS "http://127.0.0.1:${EXPOSED_PORT:-80}/api/health" 2>/dev/null | grep -q '"ok":true' && return 0; sleep 5; done
  DC logs --tail 40 backend >&2; die "stack did not become healthy within ~7.5 minutes"
}
s_verify() {
  curl -fsS "http://127.0.0.1:${EXPOSED_PORT:-80}/api/health" | tee -a "$RESULTS.meta"; echo
  echo "control: tenants active = $(PSQL_CTRL "SELECT count(*) FROM tenants WHERE status='ACTIVE'")" | tee -a "$RESULTS.meta"
  local slug db cnt first=1
  while IFS='|' read -r slug db; do
    [ -n "$slug" ] && [ -d "$WORKDIR/backups/$slug" ] || continue
    cnt="$(DC exec -T postgres psql -X -U postgres -d "$db" -tAc 'SELECT count(*) FROM users' | tr -d ' ')"
    echo "tenant $slug: users=$cnt" | tee -a "$RESULTS.meta"
    [ "$first" = 1 ] && [ "${cnt:-0}" -le 0 ] && die "first tenant has 0 users after restore"; first=0
    if [ -n "$EXPECT" ] && [ "${EXPECT%%=*}" = "$slug" ] && [ "${EXPECT#*=}" != "$cnt" ]; then die "tenant $slug users=$cnt but expected ${EXPECT#*=}"; fi
  done <<< "$TENANT_LIST"
  # backend log must be free of fatal errors
  if DC logs --tail 200 backend 2>&1 | grep -Ei 'fatal|unhandled|cannot connect'; then die "backend logs contain fatal errors"; fi
}
s_manual() {
  cat <<TXT
MANUAL CHECKS (note PASS/FAIL in the results table; the clock keeps running):
  1) ssh -L 8081:127.0.0.1:8081 -L 8080:127.0.0.1:80 root@<drill-vm>   then open http://localhost:8081 (admin) and log in.
  2) Open one tenant in the web panel (http://localhost:8080), view the latest invoice / a report.
  3) Admin > 'بکاپ و بازیابی' page loads (S3 and SMS are intentionally blank in the drill .env).
TXT
}
s_wipe() {
  [ "$WIPE" -eq 1 ] || { echo "(skipping wipe: pass --wipe, then DESTROY THE VM from the provider console)"; return 0; }
  DC down -v --remove-orphans; shred -u "$WORKDIR/.env" 2>/dev/null || rm -f "$WORKDIR/.env"; rm -rf "$WORKDIR/backups" "$KEYFILE"
}

say "Rebuild drill on $HOSTN  (mode: $([ "$EXECUTE" -eq 1 ] && echo EXECUTE || echo DRY-RUN))  workdir=$WORKDIR"
[ "$EXECUTE" -eq 1 ] && { for v in DRILL_S3_BUCKET DRILL_S3_ACCESS_KEY_ID DRILL_S3_SECRET_ACCESS_KEY DRILL_S3_PREFIX; do [ -n "${!v:-}" ] || die "$v not set"; done; [ "$(id -u)" -eq 0 ] || die "run as root on the throwaway VM"; }
step "1 packages (docker, git, rclone, node)"   "apt install + docker engine"                                   s_packages
step "2 clone repo"                              "git clone \$DRILL_REPO_URL -> $WORKDIR ${REF:+@ $REF}"            s_clone
step "3 write .env (neutralised)"                "copy off-box .env; blank SMS/S3/payment keys; bind to 127.0.0.1" s_env
step "4 start postgres"                          "docker compose up -d postgres (+ key file)"                      s_postgres
step "5 restore control DB from S3"              "download newest _control backup, verify, restore-control.sh"     s_restore_control
step "6 restore tenant DBs from S3"              "for each ACTIVE tenant: download, verify, restore-tenant.sh"      s_restore_tenants
step "7 build + start the stack"                 "docker compose up -d --build (entrypoint runs migrations)"       s_start_stack
step "8 automated verification"                  "health, tenant count, users count per tenant, log scan"          s_verify
step "9 manual verification (prints checklist)"  "login to admin + tenant via ssh tunnel"                          s_manual
[ "$EXECUTE" -eq 1 ] && { write_results OK; echo; echo "Total elapsed since script start: $(( $(date +%s) - T0 ))s. Add VM-provisioning time (provider console) for the true RTO."; }
step "10 wipe (optional --wipe)"                 "compose down -v, shred .env, remove backups"                     s_wipe
[ "$EXECUTE" -eq 1 ] || echo "Dry-run only. Nothing was installed, downloaded or restored."
