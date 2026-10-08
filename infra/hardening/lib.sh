# shellcheck shell=bash
# Shared helpers (sourced by the numbered scripts). Not executable on its own.
ts() { date +%Y%m%d-%H%M%S; }
log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run as root (sudo)"; }
have() { command -v "$1" >/dev/null 2>&1; }
# backup_file <path> : copy to <path>.bak.<ts> if it exists
backup_file() {
  local f="$1"
  if [ -e "$f" ]; then cp -a -- "$f" "$f.bak.$RUN_TS"; log "backup: $f.bak.$RUN_TS"; fi
}
RUN_TS="$(ts)"
