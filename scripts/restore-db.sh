#!/usr/bin/env bash
# Shared engine for restore-tenant.sh / restore-control.sh. Do not call directly unless you know why.
#
# Restores ONE backup file (.sql.gz.enc or .sql.gz) into ONE database.
#  - DRY-RUN by default: verifies the file (every encrypted frame is authenticated) and prints the plan.
#  - Needs --yes to change anything.
#  - Refuses to touch a database that already contains tables unless --force
#    (and then takes a safety dump of the current state first).
#  - Restores in ONE transaction: a failure leaves the target exactly as it was.
#  - Never prints secrets: the encryption key comes from $BACKUP_ENCRYPTION_KEY or --key-file;
#    the DB password from the standard $PGPASSWORD (or, with --docker, from inside the container).
set -euo pipefail
umask 077

usage() {
  cat >&2 <<USAGE
usage: restore-db.sh --file <backup> --db <database> [--yes] [--force] [--docker] [--key-file F]
                     [--host H] [--port P] [--user U] [--compose-file F] [--mode control|tenant]
  --docker   run psql/pg_dump inside the compose service "postgres" (docker compose exec) instead of the host
  --host/--port/--user   libpq connection (default: PGHOST/PGPORT/PGUSER env, or local socket)
USAGE
  exit 2
}

FILE="" DB="" YES=0 FORCE=0 DOCKER=0 KEYFILE="" MODE="tenant" HOST_="" PORT_="" USER_=""
COMPOSE_FILE="docker-compose.on-premise.yml"
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --force) FORCE=1; shift ;;
    --docker) DOCKER=1; shift ;;
    --key-file) KEYFILE="${2:-}"; shift 2 ;;
    --host) HOST_="${2:-}"; shift 2 ;;
    --port) PORT_="${2:-}"; shift 2 ;;
    --user) USER_="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$FILE" ] && [ -n "$DB" ] || usage
[ -f "$FILE" ] || { echo "backup file not found: $FILE" >&2; exit 1; }
[[ "$DB" =~ ^[A-Za-z0-9_]{1,63}$ ]] || { echo "refusing unsafe database name: $DB" >&2; exit 1; }
[ "$DB" != "postgres" ] && [ "$DB" != "template0" ] && [ "$DB" != "template1" ] || { echo "refusing to restore into a system database" >&2; exit 1; }
if [ "$MODE" = "control" ] && [ "$DB" != "exir_control" ]; then echo "control restore must target exir_control" >&2; exit 1; fi
if [ "$MODE" = "tenant" ] && [[ "$DB" != exir_tenant_* ]]; then echo "tenant restore must target an exir_tenant_* database (got $DB)" >&2; exit 1; fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ENC=0; [[ "$FILE" == *.enc ]] && ENC=1
DECRYPT_ARGS=(); [ -n "$KEYFILE" ] && DECRYPT_ARGS=(--key-file "$KEYFILE")

# ── psql / pg_dump wrappers ──────────────────────────────────────────────────
conn_args=()
[ -n "$HOST_" ] && conn_args+=(-h "$HOST_"); [ -n "$PORT_" ] && conn_args+=(-p "$PORT_"); [ -n "$USER_" ] && conn_args+=(-U "$USER_")
if [ "$DOCKER" = 1 ]; then
  PSQL()   { docker compose -f "$COMPOSE_FILE" exec -T postgres psql -X -q -U "${USER_:-postgres}" "$@"; }
  PGDUMP() { docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "${USER_:-postgres}" "$@"; }
else
  PSQL()   { psql -X -q ${conn_args[@]+"${conn_args[@]}"} "$@"; }
  PGDUMP() { pg_dump ${conn_args[@]+"${conn_args[@]}"} "$@"; }
fi

emit_sql() {  # decrypt (if needed) | gunzip
  # `SET transaction_timeout` (PG17+) را از سرآیند حذف می‌کنیم: dump با pg_dump 18 گرفته شده ولی سرور Postgres 16 است.
  if [ "$ENC" = 1 ]; then node "$HERE/backup-decrypt.mjs" ${DECRYPT_ARGS[@]+"${DECRYPT_ARGS[@]}"} "$FILE" | gunzip | sed '/^SET transaction_timeout = /d'
  else gunzip -c "$FILE" | sed '/^SET transaction_timeout = /d'; fi
}

echo "== Exir restore ($MODE) =="
echo "file     : $FILE ($(wc -c <"$FILE" | tr -d ' ') bytes, $([ "$ENC" = 1 ] && echo encrypted || echo PLAINTEXT))"
echo "target db: $DB"
echo "mode     : $([ "$YES" = 1 ] && echo APPLY || echo DRY-RUN)"

# 1) integrity: whole file must authenticate / decompress
if [ "$ENC" = 1 ]; then
  node "$HERE/backup-decrypt.mjs" --verify ${DECRYPT_ARGS[@]+"${DECRYPT_ARGS[@]}"} "$FILE"
else
  gunzip -t "$FILE" && echo "gzip integrity: OK"
fi

# 2) state of the target
EXISTS="$(PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" || true)"
TABLES=0
if [ "$EXISTS" = "1" ]; then
  TABLES="$(PSQL -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d ' ')"
fi
echo "target   : $([ "$EXISTS" = 1 ] && echo "exists, $TABLES public tables" || echo "does not exist (will be created)")"

if [ "$MODE" = "control" ] && [ "$DOCKER" = 1 ]; then
  if docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -qx backend; then
    echo "WARNING: the backend container is running. Stop it first:  docker compose -f $COMPOSE_FILE stop backend" >&2
    [ "$FORCE" = 1 ] || { echo "refusing (use --force to override)" >&2; exit 1; }
  fi
fi

if [ "$EXISTS" = "1" ] && [ "$TABLES" != "0" ] && [ "$FORCE" != 1 ]; then
  echo "REFUSING: $DB already has data. Restore into a fresh database name, or re-run with --force" >&2
  echo "(--force first saves a safety dump of the current contents)." >&2
  exit 1
fi

if [ "$YES" != 1 ]; then
  echo "Dry run complete - nothing was changed. Re-run with --yes to apply."
  exit 0
fi

# 3) safety dump before overwriting existing data
if [ "$EXISTS" = "1" ] && [ "$TABLES" != "0" ]; then
  SAFE="${TMPDIR:-/tmp}/pre-restore-${DB}-$(date +%Y%m%d%H%M%S).sql.gz"
  PGDUMP --no-owner --no-privileges --clean --if-exists "$DB" | gzip -9 >"$SAFE"
  echo "safety dump of current state: $SAFE  (UNENCRYPTED - delete it when done)"
fi

# 4) create if needed, restore atomically
# S-14: a tenant DB that already belongs to its own least-privilege role (exir_t_*) must still belong to it afterwards.
# Dumps are taken with --no-owner, so everything restored here is owned by the restoring (admin) account; the
# post-restore step below hands it back to the DB owner recorded BEFORE the restore.
OWNER=""
if [ "$EXISTS" = "1" ] && [ "$MODE" = "tenant" ]; then
  OWNER="$(PSQL -d postgres -tAc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${DB}'" | tr -d ' ')"
fi
[ "$EXISTS" = "1" ] || PSQL -d postgres -c "CREATE DATABASE \"${DB}\""
set -o pipefail
emit_sql | PSQL -d "$DB" -v ON_ERROR_STOP=1 --single-transaction >/dev/null
if [[ "$OWNER" =~ ^exir_t_[a-z0-9_]+$ ]]; then
  PSQL -d "$DB" -v ON_ERROR_STOP=1 -v owner="$OWNER" <"$HERE/sql/tenant-reown.sql" >/dev/null
  echo "ownership: objects handed back to tenant role $OWNER"
fi

# 5) post-check
AFTER="$(PSQL -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d ' ')"
echo "restored : $AFTER public tables in $DB"
[ "$AFTER" -gt 0 ] || { echo "restore produced an empty database - investigate" >&2; exit 1; }
echo "DONE. Next: restart the backend (docker compose -f $COMPOSE_FILE up -d backend) and run the smoke checks in docs/disaster-recovery.md."
