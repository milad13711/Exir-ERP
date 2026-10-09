#!/usr/bin/env bash
# Local security self-scan helper. Lightweight, READ-ONLY, polite (a handful of GET/HEAD requests, no fuzzing, no port scans).
#   1) dependency audit      npm audit (--omit=dev) in each app + optional retire.js on shipped static JS      (needs npm / npx)
#   2) secret scan           regex scan of the working tree AND the full git history; matches are printed REDACTED
#   3) HTTP header check     against the URL argument (security headers, version leaks, security.txt, Swagger exposure)
#
# usage: scripts/security/self-scan.sh [URL] [--i-own-this] [--only deps|secrets|headers] [--no-retire] [--quick]
#   URL            e.g. http://localhost:3000   (skip to run deps+secrets only)
#   --i-own-this   REQUIRED for any host that is not allow-listed. Only use it for systems you own / are authorised to test
#                  (use your STAGING clone, never someone else's site).
#   --quick        secret scan: working tree only (skip git history); deps: skip retire
# Allow-list (no flag needed): localhost, 127.0.0.1, ::1, *.localhost, *.test, *.invalid + hosts in $SELF_SCAN_ALLOW (comma list, "*.example.ir" ok).
# Exit status: 0 = nothing at/above HIGH, 1 = findings, 2 = usage/refusal.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL=""; OWN=0; ONLY=""; RETIRE=1; QUICK=0
while [ $# -gt 0 ]; do case "$1" in
  --i-own-this) OWN=1; shift;; --only) ONLY="${2:-}"; shift 2;; --no-retire) RETIRE=0; shift;; --quick) QUICK=1; RETIRE=0; shift;;
  -h|--help) sed -n 2,16p "$0"; exit 0;; -*) echo "unknown option: $1" >&2; exit 2;; *) [ -z "$URL" ] && URL="$1" || { echo "only one URL" >&2; exit 2; }; shift;; esac; done
case "$ONLY" in ""|deps|secrets|headers) ;; *) echo "--only must be deps|secrets|headers" >&2; exit 2;; esac

FINDINGS=0
hi()   { printf '  [HIGH] %s\n' "$*"; FINDINGS=$((FINDINGS+1)); }
med()  { printf '  [MED ] %s\n' "$*"; }
info() { printf '  [info] %s\n' "$*"; }
ok()   { printf '  [ ok ] %s\n' "$*"; }
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

host_allowed() { # host
  local h="$1" p; h="${h#[}"; h="${h%]}"
  case "$h" in localhost|127.0.0.1|::1|*.localhost|*.test|*.invalid) return 0;; esac
  local IFS=','; for p in ${SELF_SCAN_ALLOW:-}; do p="${p// /}"; [ -n "$p" ] || continue
    # shellcheck disable=SC2053
    [[ "$h" == $p ]] && return 0; done
  return 1
}

# ───────── target guard ─────────
HOST=""
if [ -n "$URL" ]; then
  [[ "$URL" =~ ^https?://([^/:?#]+|\[[0-9a-fA-F:]+\])(:[0-9]+)?(/|$) ]] || { echo "URL must look like http(s)://host[:port][/path]" >&2; exit 2; }
  HOST="${BASH_REMATCH[1]}"
  if ! host_allowed "$HOST"; then
    if [ "$OWN" -ne 1 ]; then
      echo "REFUSED: '$HOST' is not allow-listed. If you OWN this system (or have written authorisation) re-run with --i-own-this," >&2
      echo "or add it to SELF_SCAN_ALLOW. Never point this at production without owner sign-off; prefer the staging clone." >&2; exit 2
    fi
    echo "NOTE: scanning non-allow-listed host '$HOST' on your assertion that you own it. Ctrl-C within 5s to abort."; sleep 5
  fi
fi

# ───────── 1) dependencies ─────────
scan_deps() {
  echo; echo "== 1) Dependency audit (npm audit --omit=dev; HIGH and CRITICAL fail the scan)"
  command -v npm >/dev/null || { info "npm not found - skipped"; return; }
  local app dir out hi_n
  for app in apps/backend-core apps/web-panel apps/admin-panel apps/marketing-site; do
    dir="$ROOT/$app"; [ -f "$dir/package-lock.json" ] || { info "$app: no package-lock.json - skipped"; continue; }
    out="$(cd "$dir" && npm audit --omit=dev --json 2>/dev/null)" || true
    hi_n="$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).metadata.vulnerabilities;console.log((v.high||0)+(v.critical||0)+" "+(v.moderate||0)+" "+(v.low||0))}catch(e){console.log("? ? ?")}})')"
    set -- $hi_n
    if [ "$1" = "?" ]; then info "$app: audit unavailable (offline / registry unreachable?)"
    elif [ "$1" -gt 0 ]; then hi "$app: $1 high/critical advisories (moderate $2, low $3) - run: cd $app && npm audit --omit=dev"
    else ok "$app: no high/critical (moderate $2, low $3)"; fi
  done
  if [ "$RETIRE" -eq 1 ] && command -v npx >/dev/null; then
    echo "  retire.js on shipped static JS (apps/*/public) ..."
    for app in apps/web-panel apps/admin-panel apps/marketing-site; do
      [ -d "$ROOT/$app/public" ] || continue
      if npx --yes retire --severity high --path "$ROOT/$app/public" --outputformat text >/tmp/retire.$$ 2>&1; then ok "$app/public: no known-vulnerable JS libraries"
      else grep -qiE 'vulnerab|CVE|severity' /tmp/retire.$$ && hi "$app/public: retire.js reports vulnerable libraries (see: npx retire --path $app/public)" || info "$app/public: retire.js could not run ($(head -c 80 /tmp/retire.$$ | tr '\n' ' '))"; fi
      rm -f /tmp/retire.$$
    done
  fi
}

# ───────── 2) secrets (git history + tree) ─────────
SECRET_RE='AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|sk_live_[0-9A-Za-z]{20,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9._-]*(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$ {}<>]{16,}["'"'"']'
SKIP_PATH_RE='(^|/)(node_modules|\.next|dist|generated|coverage)/|\.example($|\.)|\.spec\.|\.test\.|/test/|__tests__|package-lock\.json|\.md$|\.svg$|\.lock$|docker-compose'
redact() { # prints file:line + first 4 chars + length for every match; never the secret
  awk -v file="${1:-?}" '{ line=$0; while (match(line, re)) { m=substr(line,RSTART,RLENGTH); printf "    %s  %s...(%d chars)\n", file, substr(m,1,8), length(m); line=substr(line,RSTART+RLENGTH) } }' re="$SECRET_RE"
}
scan_secrets() {
  echo; echo "== 2) Secret scan (patterns are generic; matches shown REDACTED; expect some false positives - review each)"
  command -v git >/dev/null || { info "git not found - skipped"; return; }
  cd "$ROOT" || return
  local f n=0 tmp; tmp="$(mktemp)"
  git ls-files -z | tr '\0' '\n' | grep -vE "$SKIP_PATH_RE" | while IFS= read -r f; do [ -f "$f" ] && grep -IEn -e "$SECRET_RE" "$f" 2>/dev/null | redact "$f"; done > "$tmp" || true
  n="$(wc -l < "$tmp" | tr -d ' ')"
  if [ "$n" -gt 0 ]; then med "working tree: $n candidate(s) (file, prefix, length):"; head -40 "$tmp"; else ok "working tree: no candidates"; fi
  : > "$tmp"
  if [ "$QUICK" -eq 1 ]; then info "history scan skipped (--quick)"; rm -f "$tmp"; return; fi
  echo "  scanning git history (all branches) - can take a minute ..."
  git log --all --no-color -p -G"$SECRET_RE" --format='@@COMMIT %h %ad' --date=short -- . ':(exclude)*package-lock.json' ':(exclude)*.md' ':(exclude)*.svg' 2>/dev/null \
    | awk -v re="$SECRET_RE" '/^@@COMMIT /{c=$2" "$3; next} /^\+\+\+ /{f=substr($2,3); next} /^\+[^+]/{ if (f ~ /node_modules|\.example|\.spec\.|\.test\.|package-lock|generated\//) next; l=substr($0,2); while (match(l, re)) { m=substr(l,RSTART,RLENGTH); printf "    %s %s  %s...(%d chars)\n", c, f, substr(m,1,8), length(m); l=substr(l,RSTART+RLENGTH) } }' \
    | sort -u > "$tmp" || true
  n="$(wc -l < "$tmp" | tr -d ' ')"
  if [ "$n" -gt 0 ]; then
    # vendor-style token prefixes / private keys are near-certain; generic NAME=value hits are usually constants -> MED
    if grep -qE '  (AKIA|sk_live|gh[pousr]_|xox[baprs]|AIza|eyJ)' "$tmp"; then hi "git history: high-confidence secret pattern(s) (commit, file, prefix, length) - rotate anything real:"; grep -E '  (AKIA|sk_live|gh[pousr]_|xox[baprs]|AIza|eyJ)' "$tmp" | head -20
    else med "git history: $n candidate(s) - review (commit, file, prefix, length); none has a vendor-token prefix:"; fi
    grep -vE '  (AKIA|sk_live|gh[pousr]_|xox[baprs]|AIza|eyJ)' "$tmp" | head -20
  else ok "git history: no candidates"; fi
  rm -f "$tmp"
  # tracked env files that should never be committed
  if git ls-files | grep -E '(^|/)\.env($|\.(local|production|prod))' | grep -v example | grep -q .; then hi "tracked .env file(s): $(git ls-files | grep -E '(^|/)\.env($|\.(local|production|prod))' | grep -v example | tr '\n' ' ')"; else ok "no tracked .env files"; fi
}

# ───────── 3) headers ─────────
HDR=""
fetch_headers() { curl -sS -o /dev/null -D - --max-time 15 -A 'exir-self-scan/1' "$1" 2>/dev/null | tr -d '\r'; }
hdr() { printf '%s\n' "$HDR" | grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//'; }
scan_headers() {
  echo; echo "== 3) HTTP headers: $URL"
  [ -n "$URL" ] || { info "no URL given - skipped"; return; }
  command -v curl >/dev/null || { info "curl not found - skipped"; return; }
  HDR="$(fetch_headers "$URL")"
  [ -n "$HDR" ] || { med "no response from $URL"; return; }
  info "status line: $(printf '%s\n' "$HDR" | head -1)"
  local v
  [[ "$URL" == https://* ]] && { [ -n "$(hdr strict-transport-security)" ] && ok "HSTS present" || med "HSTS missing"; }
  [ "$(hdr x-content-type-options | tr 'A-Z' 'a-z')" = nosniff ] && ok "X-Content-Type-Options: nosniff" || med "X-Content-Type-Options: nosniff missing"
  v="$(hdr x-frame-options)"; csp="$(hdr content-security-policy)"
  if [ -n "$v" ] || printf '%s' "$csp" | grep -qi frame-ancestors; then ok "clickjacking protection (X-Frame-Options / frame-ancestors)"; else med "no X-Frame-Options / frame-ancestors (OK only for pages meant to be embedded, e.g. /f/*)"; fi
  if [ -n "$csp" ]; then ok "Content-Security-Policy enforced"; elif [ -n "$(hdr content-security-policy-report-only)" ]; then info "CSP is report-only (known open item - promote after reviewing reports)"; else med "no Content-Security-Policy"; fi
  [ -n "$(hdr referrer-policy)" ] && ok "Referrer-Policy present" || med "Referrer-Policy missing"
  [ -n "$(hdr permissions-policy)" ] && ok "Permissions-Policy present" || med "Permissions-Policy missing"
  v="$(hdr x-powered-by)"; [ -z "$v" ] && ok "no X-Powered-By" || med "X-Powered-By leaks: $v"
  v="$(hdr server)"; if printf '%s' "$v" | grep -qE '[0-9]+\.[0-9]+'; then med "Server header leaks a version: $v"; else ok "Server header has no version${v:+ ($v)}"; fi
  v="$(printf '%s\n' "$HDR" | grep -i '^set-cookie:')"; if [ -n "$v" ]; then printf '%s' "$v" | grep -qi httponly || med "cookie without HttpOnly"; printf '%s' "$v" | grep -qi samesite || med "cookie without SameSite"; [[ "$URL" == https://* ]] && { printf '%s' "$v" | grep -qi secure || med "cookie without Secure"; }; else ok "no cookies set on this response"; fi
  v="$(hdr access-control-allow-origin)"; [ "$v" = "*" ] && med "Access-Control-Allow-Origin: * on this response (fine for public form endpoints only)"
  # two extra, polite GETs on the same origin
  local base; base="$(printf '%s' "$URL" | sed -E 's#^(https?://[^/]+).*#\1#')"
  local st; st="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$base/.well-known/security.txt" 2>/dev/null)"
  [ "$st" = 200 ] && ok "/.well-known/security.txt served" || med "/.well-known/security.txt not served (HTTP $st)"
  st="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$base/api/docs" 2>/dev/null)"
  [ "$st" = 200 ] && info "/api/docs (Swagger) is reachable - intended for API customers; set SWAGGER_ENABLED=false to hide" || ok "/api/docs not exposed (HTTP $st)"
  st="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$base/api/internal/alert" 2>/dev/null)"
  case "$st" in 404|403|401|405|000) ok "/api/internal/alert not reachable from outside (HTTP $st)";; *) hi "/api/internal/alert answered HTTP $st from outside - block it at nginx (infra/hardening/monitoring/nginx-block-internal.conf)";; esac
}

echo "Exir self-scan - repo: $ROOT  target: ${URL:-none}"
want deps && scan_deps
want secrets && scan_secrets
want headers && scan_headers
echo; if [ "$FINDINGS" -gt 0 ]; then echo "RESULT: $FINDINGS HIGH finding(s)"; exit 1; fi
echo "RESULT: no HIGH findings (review the [MED] lines too)"; exit 0
