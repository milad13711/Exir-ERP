#!/usr/bin/env bash
# Defense in depth: drop NEW connections arriving on the EXTERNAL interface to Docker-published ports that must
# never be public (even if a future compose edit re-exposes them). Docker bypasses ufw, but NOT the DOCKER-USER chain.
# Idempotent: owns a chain EXIR-DOCKER-GUARD, flushed + rebuilt each run; jump from DOCKER-USER inserted once.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# Ports that must NOT be reachable from outside via Docker. 8083 (headscale) and 80/443 are intentionally absent.
BLOCK_PORTS="${EXIR_BLOCK_PORTS:-8080 8081 8082 8084 3000 4001 5432 6379}"
MODE=apply
usage() { cat <<U
Usage: sudo $0 [--apply|--remove|--status] [--help]
  --apply   (default) (re)build chain EXIR-DOCKER-GUARD and hook it into DOCKER-USER
  --remove  unhook and delete the chain
  --status  print rules
Env: EXIR_BLOCK_PORTS="8080 8081 ..."  EXIR_EXT_IF=eth0 (auto-detected from default route)
Persistence: install exir-docker-guard.service (see 03-docker-ports.patch.md). Must run AFTER docker.service.
U
}
for a in "$@"; do case "$a" in --apply) MODE=apply;; --remove) MODE=remove;; --status) MODE=status;; -h|--help) usage; exit 0;; *) usage; die "unknown arg $a";; esac; done
need_root; have iptables || die "iptables missing"
EXT_IF="${EXIR_EXT_IF:-$(ip -o route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n1)}"
[ -n "$EXT_IF" ] || die "cannot detect external interface; set EXIR_EXT_IF"
CH=EXIR-DOCKER-GUARD
iptables -n -L DOCKER-USER >/dev/null 2>&1 || die "DOCKER-USER chain not found (is docker running?)"
unhook() { while iptables -C DOCKER-USER -j "$CH" 2>/dev/null; do iptables -D DOCKER-USER -j "$CH"; done; }
case "$MODE" in
  status) iptables -S DOCKER-USER; iptables -S "$CH" 2>/dev/null || log "chain absent"; exit 0;;
  remove) unhook; iptables -F "$CH" 2>/dev/null || true; iptables -X "$CH" 2>/dev/null || true; log "removed"; exit 0;;
esac
iptables -N "$CH" 2>/dev/null || true
iptables -F "$CH"
log "external interface: $EXT_IF ; blocking NEW connections to original dst ports: $BLOCK_PORTS"
for p in $BLOCK_PORTS; do
  # --ctorigdstport = destination port BEFORE docker's DNAT, i.e. the published (host) port
  iptables -A "$CH" -i "$EXT_IF" -p tcp -m conntrack --ctstate NEW --ctorigdstport "$p" --ctdir ORIGINAL -j DROP
done
iptables -A "$CH" -j RETURN
iptables -C DOCKER-USER -j "$CH" 2>/dev/null || iptables -I DOCKER-USER 1 -j "$CH"
log "done. Verify from OUTSIDE: nc -zv <ip> 8081 must time out."
