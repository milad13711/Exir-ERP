# 06 - Lightweight monitoring and alerting (no heavy stack)

## 1. SSH login alerts (RISK: low)
Cheapest: PAM hook. `/usr/local/sbin/exir-ssh-notify.sh` (0755):
```bash
#!/usr/bin/env bash
# called by pam_exec on session open; PAM_TYPE, PAM_USER, PAM_RHOST are set
[ "${PAM_TYPE:-}" = "open_session" ] || exit 0
MSG="SSH login: user=${PAM_USER} from=${PAM_RHOST:-local} host=$(hostname) at $(date '+%F %T')"
logger -t exir-ssh-login "$MSG"
# Deliver: ONE of the following (keep tokens in /etc/exir-alert.env, mode 600, never in this file)
# . /etc/exir-alert.env; curl -fsS --max-time 8 -d "to=$ALERT_PHONE&text=$MSG" "$SMS_GATEWAY_URL" >/dev/null || true
# echo "$MSG" | mail -s "SSH login $(hostname)" you@example.com || true
exit 0
```
Hook: append to `/etc/pam.d/sshd` →
`session optional pam_exec.so quiet /usr/local/sbin/exir-ssh-notify.sh`  (`optional` + `|| true` so it can never block logins).
Rollback: delete that line. Use the SMS gateway you already operate (exirsms) — put its URL/token in `/etc/exir-alert.env`.
Alternative without PAM: `journalctl -u ssh --since "-10min" | grep Accepted` from cron.

## 2. Disk and cert cron `/etc/cron.d/exir-monitor`
```
SHELL=/bin/bash
*/15 * * * * root df -P / | awk 'NR==2{gsub("%","",$5); if ($5+0>85) exit 1}' || logger -p user.crit -t exir-monitor "disk >85% on $(hostname)"
0 8 * * *    root /usr/local/sbin/check-certs.sh --warn 14 --live app.eta.co.ir,exirerp.ir,admin.exirerp.ir || logger -p user.crit -t exir-monitor "cert expiring"
```
(`logger` lines should be forwarded: wrap in the same notify mechanism as above — simplest is to replace `logger ...` with a call to a tiny `exir-alert "message"` function that does the curl/mail.)
Install: `install -m0755 check-certs.sh /usr/local/sbin/check-certs.sh`. Test: `check-certs.sh --warn 3650` (must FAIL for all = pipeline works).

## 3. auditd (optional; RISK: low, some log volume)
`apt install auditd`; `/etc/audit/rules.d/exir.rules`:
```
-w /etc/ssh/sshd_config.d/ -p wa -k sshcfg
-w /etc/sudoers -p wa -k sudoers
-w /etc/sudoers.d/ -p wa -k sudoers
-w /opt/exir-erp/.env -p rwa -k envfile
-w /etc/passwd -p wa -k identity
-w /etc/nginx/ -p wa -k nginxcfg
```
`augenrules --load`; query `ausearch -k envfile -ts today`. Rollback: remove file, `augenrules --load`.

## 4. External uptime and TLS check
From OUTSIDE the box (UptimeRobot/Hetrixtools/ArvanCloud monitor/another VPS cron): HTTPS GET on
`https://app.eta.co.ir/`, `https://admin.exirerp.ir/`, `https://exirerp.ir/` and a TCP check on 22 and 8083; alert if 8081/8080
ever become OPEN (a "port open" monitor in reverse) — that catches a future compose regression. Notify via SMS + email to two people.

## 5. Other
- `fail2ban-client status` weekly; `fail2ban-client banned` to inspect.
- `logwatch` (optional): `apt install logwatch`; daily mail needs an MTA.
- Run `audit-host.sh` weekly from cron and send non-zero exits: `0 7 * * 6 root /root/hardening/audit-host.sh | grep -E '^(FAIL|WARN)' | <your alert command>`.
