#!/usr/bin/env bash
# Shared helpers for deploy-remote.sh and rollback.sh. Runs ON the production server (source it; do not execute).
# Contains: proxy reload, monitoring maintenance-window calls, image tagging, and the POST-DEPLOY SMOKE SUITE.
# shellcheck shell=bash

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.on-premise.yml}"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

PROJECT="${COMPOSE_PROJECT_NAME:-exir-erp}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-${PROJECT}-backend-1}"
PROXY_PORT="${PROXY_PORT:-8080}"             # host port the in-docker nginx proxy is published on (127.0.0.1)
SMOKE_HOST="${SMOKE_HOST:-exirerp.ir}"    # Host header sent through the proxy
SMOKE_TIMEOUT_SEC="${SMOKE_TIMEOUT_SEC:-240}"
SMOKE_INTERVAL_SEC="${SMOKE_INTERVAL_SEC:-10}"
MAINTENANCE_MINUTES="${MAINTENANCE_MINUTES:-20}"
CONTROL_DB="${CONTROL_DB:-exir_control}"
PG_USER="${PG_USER:-postgres}"
OTHER_SERVICES="${OTHER_SERVICES:-web admin marketing proxy postgres}"

backend_image() {
  # Image name compose builds for the backend service (e.g. exir-erp-backend), without tag.
  local img
  img="$(compose config --images 2>/dev/null | grep -E '(^|[-_/])backend(:|$)' | head -n1 || true)"
  img="${img%%:*}"
  echo "${img:-${PROJECT}-backend}"
}

# ---------------------------------------------------------------- proxy ----
# The proxy nginx resolves `backend`/`web` upstreams only when it starts. After any of those containers is recreated
# it keeps the OLD IP => 502 until reloaded. So: always reload after a recreate. (2026-10-19 incident.)
reload_proxy() {
  echo "==> Reloading proxy nginx (stale upstream IPs after container recreate)..."
  if ! compose exec -T proxy nginx -t; then
    echo "ERROR: nginx -t failed in proxy container; NOT reloading." >&2
    return 1
  fi
  compose exec -T proxy nginx -s reload
}

# ---------------------------------------------------------- maintenance ----
# Calls the backend's internal endpoint from INSIDE the backend container (loopback, so no proxy headers). The token is
# read from the container's own environment by node; it never appears in argv, logs or this script's output.
# Best-effort: the OLD image may predate the endpoint, or the container may be down - warn and continue.
maintenance_call() { # json-body
  docker exec "$BACKEND_CONTAINER" node -e '
    const t = process.env.INTERNAL_ALERT_TOKEN || "";
    if (t.length < 32) { console.log("INTERNAL_ALERT_TOKEN unset/weak in container"); process.exit(2); }
    fetch("http://127.0.0.1:" + (process.env.PORT || 3001) + "/api/internal/maintenance", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-alert-token": t },
      body: process.argv[1],
      signal: AbortSignal.timeout(8000),
    }).then(async (r) => { console.log("HTTP " + r.status + " " + (await r.text()).slice(0, 200)); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.log("request failed: " + e.message); process.exit(1); });
  ' "$1" 2>&1
}
maintenance_start() {
  echo "==> Monitoring maintenance window: suppressing owner SMS for ${MAINTENANCE_MINUTES} min (alerts still logged; external uptime monitor unaffected)"
  if ! maintenance_call "{\"minutes\":${MAINTENANCE_MINUTES},\"reason\":\"deploy ${RUN_ID:-manual}\"}"; then
    echo "  WARNING: could not set maintenance window (old backend without the endpoint, or INTERNAL_ALERT_TOKEN not configured). Expect possible false SMS alerts." >&2
  fi
}
maintenance_clear() {
  echo "==> Clearing monitoring maintenance window"
  maintenance_call '{"clear":true}' || echo "  WARNING: could not clear maintenance window (it auto-expires after ${MAINTENANCE_MINUTES} min)." >&2
}

# ------------------------------------------------------------- tagging ----
# :last-good = image of the last deploy whose smoke suite PASSED. :previous = what rollback.sh restores
# (set before each recreate from :last-good, else from the currently running image, so a failed deploy never overwrites it).
tag_previous_before_recreate() {
  local img="$1" src
  if docker image inspect "${img}:last-good" >/dev/null 2>&1; then
    src="${img}:last-good"
  elif docker image inspect "${img}:running" >/dev/null 2>&1; then
    src="${img}:running"
  else
    src="$(docker inspect -f '{{.Image}}' "$BACKEND_CONTAINER" 2>/dev/null || true)"
  fi
  if [ -n "$src" ]; then
    docker tag "$src" "${img}:previous" && echo "==> Tagged ${img}:previous <- ${src}"
  else
    echo "  (no running/last-good backend image to tag as :previous)"
  fi
}

# --------------------------------------------------------- smoke suite ----
SMOKE_NAMES=(); SMOKE_RESULTS=(); SMOKE_DETAILS=(); SMOKE_FATAL=0
_smoke_reset() { SMOKE_NAMES=(); SMOKE_RESULTS=(); SMOKE_DETAILS=(); SMOKE_FATAL=0; }
_rec() { SMOKE_NAMES+=("$1"); SMOKE_RESULTS+=("$2"); SMOKE_DETAILS+=("$3"); }   # name PASS|FAIL detail

_psql() { compose exec -T postgres psql -U "$PG_USER" -v ON_ERROR_STOP=1 -At "$@"; }

_proxy_get() { # path -> prints body, sets nothing; returns curl status
  curl -sS --max-time 10 -H "Host: ${SMOKE_HOST}" "http://127.0.0.1:${PROXY_PORT}$1"
}

_smoke_once() {
  _smoke_reset
  local code body mode tenants out db dbs bad restarting status restarts logs

  # 1. health through the proxy path
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: ${SMOKE_HOST}" "http://127.0.0.1:${PROXY_PORT}/api/health" || true)"
  body="$(_proxy_get /api/health 2>/dev/null || true)"
  if [ "$code" = "200" ] && [[ "$body" == *'"ok":true'* ]]; then _rec "health via proxy" PASS "HTTP 200"; else _rec "health via proxy" FAIL "HTTP ${code:-000} body=${body:0:80}"; fi

  # 2. license mode
  body="$(_proxy_get /api/license/status 2>/dev/null || true)"
  mode="$(printf '%s' "$body" | grep -o '"mode":"[a-z_]*"' | head -n1 | cut -d'"' -f4 || true)"
  tenants="$(_psql -d "$CONTROL_DB" -c 'select count(*) from tenants' 2>/dev/null || echo '?')"
  if [ -z "$mode" ]; then
    _rec "license status" FAIL "no mode in /api/license/status (body=${body:0:80})"
  elif [ "$mode" = "on_premise" ] && [[ "$tenants" =~ ^[0-9]+$ ]] && [ "$tenants" -gt 1 ]; then
    _rec "license status" FAIL "mode=on_premise on a MULTI-TENANT host (${tenants} tenants): modules will be rejected for tenants. Set DEPLOYMENT_MODE=CLOUD in .env and recreate backend."
  else
    _rec "license status" PASS "mode=${mode} tenants=${tenants}"
  fi

  # 3. control DB migrations
  if out="$(_psql -d "$CONTROL_DB" -c 'select migration_name from _prisma_migrations where finished_at is null and rolled_back_at is null' 2>&1)"; then
    if [ -z "$out" ]; then _rec "control DB migrations" PASS "none unfinished"; else _rec "control DB migrations" FAIL "unfinished: $(echo "$out" | tr '\n' ' ')"; fi
  else
    _rec "control DB migrations" FAIL "psql failed: ${out:0:120}"
  fi

  # 4. tenant DB migrations (names only)
  if dbs="$(_psql -d postgres -c "select datname from pg_database where not datistemplate and datname not in ('postgres','${CONTROL_DB}')" 2>&1)"; then
    bad=""
    while IFS= read -r db; do
      [ -n "$db" ] || continue
      out="$(_psql -d "$db" -c "select case when to_regclass('public._prisma_migrations') is null then '' else coalesce((select string_agg(migration_name, ',') from public._prisma_migrations where finished_at is null and rolled_back_at is null), '') end" 2>&1 || echo "QUERY-ERROR")"
      if [ -n "$out" ]; then bad="${bad}${db} "; fi
    done <<<"$dbs"
    if [ -z "$bad" ]; then _rec "tenant DB migrations" PASS "$(printf '%s\n' "$dbs" | grep -c . || true) tenant DB(s) clean"; else _rec "tenant DB migrations" FAIL "unfinished/failed in DB(s): ${bad}"; fi
  else
    _rec "tenant DB migrations" FAIL "cannot list databases: ${dbs:0:120}"
  fi

  # 5. backend container state / restart count (a crash loop is fatal: no point waiting)
  status="$(docker inspect -f '{{.State.Status}}|{{.State.Restarting}}|{{.RestartCount}}' "$BACKEND_CONTAINER" 2>/dev/null || echo 'missing|false|0')"
  restarting="$(cut -d'|' -f2 <<<"$status")"; restarts="$(cut -d'|' -f3 <<<"$status")"
  if [ "$(cut -d'|' -f1 <<<"$status")" != "running" ] || [ "$restarting" = "true" ]; then
    _rec "backend container" FAIL "state=${status}"; SMOKE_FATAL=1
  elif [ "${restarts:-0}" != "${SMOKE_BASE_RESTARTS:-0}" ]; then
    _rec "backend container" FAIL "restart count changed ${SMOKE_BASE_RESTARTS:-0} -> ${restarts} (crash loop?)"; SMOKE_FATAL=1
  else
    _rec "backend container" PASS "running, restarts=${restarts}"
  fi

  # 6. other containers
  bad=""
  for s in $OTHER_SERVICES; do
    if [ -n "$(compose ps --status running -q "$s" 2>/dev/null)" ]; then :; else
      # service may legitimately not exist in this compose file
      if compose config --services 2>/dev/null | grep -qx "$s"; then bad="${bad}${s} "; fi
    fi
  done
  if [ -z "$bad" ]; then _rec "other containers" PASS "$OTHER_SERVICES"; else _rec "other containers" FAIL "not running: ${bad}"; fi

  # 7. boot errors in recent backend logs
  logs="$(docker logs --tail 100 "$BACKEND_CONTAINER" 2>&1 || true)"
  out="$(printf '%s\n' "$logs" | grep -E 'ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNKNOWN_FILE_EXTENSION|Migration failed for tenant|migrate-all-tenants failed|Unhandled(Promise)?Rejection|Nest application failed|\bFATAL\b' | head -n3 || true)"
  if [ -z "$out" ]; then _rec "backend boot log" PASS "no boot errors in last 100 lines"; else _rec "backend boot log" FAIL "$(echo "$out" | cut -c1-160 | tr '\n' '|')"; fi
}

_smoke_all_pass() { local r; for r in "${SMOKE_RESULTS[@]}"; do [ "$r" = PASS ] || return 1; done; return 0; }

# smoke_suite: retries until everything passes or SMOKE_TIMEOUT_SEC (migrate-all runs ~60s after boot). Returns 0 PASS / 1 FAIL.
smoke_suite() {
  local start now i
  start="$(date +%s)"
  SMOKE_BASE_RESTARTS="${SMOKE_BASE_RESTARTS:-0}"
  echo "==> POST-DEPLOY SMOKE SUITE (up to ${SMOKE_TIMEOUT_SEC}s, Host: ${SMOKE_HOST} via 127.0.0.1:${PROXY_PORT})"
  while true; do
    _smoke_once
    if _smoke_all_pass; then break; fi
    now="$(date +%s)"
    if [ "$SMOKE_FATAL" = 1 ] || [ $((now - start)) -ge "$SMOKE_TIMEOUT_SEC" ]; then break; fi
    echo "  ...not ready yet ($((now - start))s): $(for i in "${!SMOKE_RESULTS[@]}"; do [ "${SMOKE_RESULTS[$i]}" = FAIL ] && printf '%s; ' "${SMOKE_NAMES[$i]}"; done)"
    sleep "$SMOKE_INTERVAL_SEC"
  done
  echo
  echo "================ SMOKE SUMMARY ================"
  local failed=0
  for i in "${!SMOKE_NAMES[@]}"; do
    printf '%-4s  %-24s %s\n' "${SMOKE_RESULTS[$i]}" "${SMOKE_NAMES[$i]}" "${SMOKE_DETAILS[$i]}"
    [ "${SMOKE_RESULTS[$i]}" = PASS ] || failed=$((failed + 1))
  done
  if [ "$failed" -eq 0 ]; then
    echo "RESULT: PASS (all ${#SMOKE_NAMES[@]} checks)"
    return 0
  fi
  echo "RESULT: FAIL - failing check(s):"
  for i in "${!SMOKE_NAMES[@]}"; do [ "${SMOKE_RESULTS[$i]}" = PASS ] || echo "  * ${SMOKE_NAMES[$i]}: ${SMOKE_DETAILS[$i]}"; done
  echo "Roll back with: bash /opt/exir-erp/rollback.sh   (see docs/ops/deploy.md)"
  return 1
}
