# 03 - Bind Docker published ports to 127.0.0.1

Goal: nothing except host nginx (80/443) and headscale (8083) is reachable from the internet. Docker inserts its own
iptables rules that bypass ufw, so `ports: "8081:3000"` == public on 0.0.0.0.

Do NOT edit the compose file in place from this kit; review and apply the patch yourself on a branch.

## A. Patch for `docker-compose.on-premise.yml`
(Ports use env substitution; keep it. Prod has `EXPOSED_PORT=8080`, `ADMIN_EXPOSED_PORT=8081`, `MARKETING_EXPOSED_PORT=8082`.)

```diff
--- a/docker-compose.on-premise.yml
+++ b/docker-compose.on-premise.yml
@@ admin:
     ports:
-      - "${ADMIN_EXPOSED_PORT:-8081}:3000"
+      - "127.0.0.1:${ADMIN_EXPOSED_PORT:-8081}:3000"
@@ marketing:
     ports:
-      - "${MARKETING_EXPOSED_PORT:-8082}:3000"
+      - "127.0.0.1:${MARKETING_EXPOSED_PORT:-8082}:3000"
@@ proxy:
     ports:
-      - "${EXPOSED_PORT:-80}:80"
+      - "127.0.0.1:${EXPOSED_PORT:-80}:80"
```
Also check `web` and `backend`/`postgres` for any `ports:` (the audit saw only the three above). Postgres must never publish.

IMPORTANT side effect: the default `:-80` is for fresh on-prem installs where the proxy IS the public entry. Customers
using this compose without a host nginx would lose access. If other deployments use this file, instead add a variable:
`"${EXPOSED_BIND:-0.0.0.0}:${EXPOSED_PORT:-80}:80"` and set `EXPOSED_BIND=127.0.0.1` (and `ADMIN_BIND`, `MARKETING_BIND`) only in prod's `.env`.
That is the recommended form. Same diff, with `${ADMIN_BIND:-0.0.0.0}:` etc.

## B. funnelking (separate compose, port 8084)
Find it: `ssh ... 'grep -rn "8084" /opt --include=docker-compose*.yml'`. Change `"8084:3000"` (or similar) to
`"127.0.0.1:8084:3000"` and `docker compose -f <that file> up -d <service>`. host nginx for funnelking.ir already uses 127.0.0.1:8084.

## C. Unknown listeners :3000 (next-server) and :4001 (node /opt/exirs...)
These are not Docker (bind 0.0.0.0 by the app). ufw INPUT policy DROP protects them as long as ufw is active; verify:
`ufw status verbose` (default deny incoming; no 3000/4001 rules). Then fix at the source: start them with `HOSTNAME=127.0.0.1`
(Next.js) / `HOST=127.0.0.1` / `listen(port,'127.0.0.1')` in their systemd unit or pm2 config. Defense in depth: step D.
(chat.exirsms.ir/api.exirsms.ir host nginx -> 127.0.0.1:3000 / 4001 keeps working after rebind.)

## D. Rollout (downtime ~5-15 s per recreated container; proxy recreation ~3 s of 502 on the main app)
Pre-check — who might use direct ports from outside?
- CDN origin port: ArvanCloud origin for app.eta.co.ir is port 80 (host nginx) — not 8080. CHECK in the Arvan panel that no domain's origin is `<IP>:8080/8081/8082`.
- Uptime monitors / webhooks (payment callbacks, SMS DLR) pointing at `http://45.94.215.22:808x`. Check nginx access logs:
  `grep -E ':(8080|8081|8082)' /var/log/nginx/*.log` won't show them (they bypass nginx) — instead run for 10 min before the change:
  `conntrack -L 2>/dev/null | grep -E 'dport=(8080|8081|8082|8084)' | grep -v 127.0.0.1 | head`   (apt install conntrack)
  or `ss -tn state established '( sport = :8081 )'`.
- `scripts/deploy-remote.sh` uses http://localhost:8080 -> still works (loopback).
- Mobile apps/clients with a hardcoded `http://IP:8081`? (`grep -rn "45.94.215.22" apps/ --include=*.ts*`)

```bash
cd /opt/exir-erp && cp docker-compose.on-premise.yml /root/compose.bak.$(date +%F-%H%M)
# edit (or git pull the patched file), then:
docker compose -f docker-compose.on-premise.yml config >/dev/null && echo compose-valid
docker compose -f docker-compose.on-premise.yml up -d admin marketing proxy      # recreates only these (ports changed)
docker compose -f docker-compose.on-premise.yml ps
```
Verification
```bash
ss -tlnp | grep -E ':(8080|8081|8082|8084)\b'            # all must show 127.0.0.1:
curl -sI http://127.0.0.1:8081 | head -1                 # 200/3xx (loopback still works)
curl -sI https://admin.exirerp.ir | head -1              # via host nginx still works
# from ANOTHER machine (your laptop):
nc -zvw3 45.94.215.22 8081 ; nc -zvw3 45.94.215.22 8080  # must time out / refused
nc -zvw3 45.94.215.22 8083                               # headscale must still be OPEN
```
Rollback: `cp /root/compose.bak.<ts> docker-compose.on-premise.yml && docker compose -f docker-compose.on-premise.yml up -d admin marketing proxy`.

## E. Defense in depth: DOCKER-USER chain (survives future compose mistakes)
`docker-user-guard.sh` builds chain `EXIR-DOCKER-GUARD`, hooked as rule 1 in `DOCKER-USER`, dropping NEW external
connections whose ORIGINAL destination port is in `EXIR_BLOCK_PORTS` (default 8080 8081 8082 8084 3000 4001 5432 6379;
8083 headscale, 80, 443 untouched). Docker never flushes DOCKER-USER on restart, but a reboot does -> persist via systemd:
```bash
install -m0755 lib.sh /usr/local/sbin/lib.sh
install -m0755 docker-user-guard.sh /usr/local/sbin/exir-docker-user-guard
cp exir-docker-guard.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now exir-docker-guard
exir-docker-user-guard --status
```
Rollback: `systemctl disable --now exir-docker-guard` (runs --remove) and delete the unit.
Caveat: if you later move a service to a public port that is in the list, update `EXIR_BLOCK_PORTS` (Environment= in the unit).
Caveat: the guard also protects :3000/:4001 only if they are Docker-published; for host processes ufw does that.
