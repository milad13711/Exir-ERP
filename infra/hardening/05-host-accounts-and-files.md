# 05 - Host accounts, files, Docker daemon, containers

## 1. Non-root admin user (RISK: medium - lockout if done wrong; keep root session open)
```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy                      # sudo requires a password: set one: passwd deploy  (or NOPASSWD only in /etc/sudoers.d/deploy, 0440)
install -d -m700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
# SECOND terminal:  ssh deploy@45.94.215.22 'sudo -n true || sudo -v'     <- must work BEFORE touching root
```
Do NOT add `deploy` to the `docker` group unless necessary: docker group == root. Use `sudo docker ...`.
`scripts/deploy-remote.sh` currently logs in as root: update it (user's decision) to `deploy` + sudo before disabling root key login.
Only after deploy works: in 01-harden-ssh.sh output change `PermitRootLogin prohibit-password` -> `no` (add `AllowUsers deploy`) and reload.
Lock root's *password* (keys still work until PermitRootLogin no): `passwd -l root`. Rollback: `passwd -u root`.

## 2. Secret files (RISK: low)
```bash
cd /opt/exir-erp
ls -la .env* ; stat -c '%a %U %n' .env*
chmod 600 .env ; chown root:root .env        # compose reads as root
ls -la .env.bak.* .env.save 2>/dev/null
```
Stale copies contain live secrets (DB password, JWT, API keys). After confirming `.env` is correct and you have an offline encrypted copy:
`shred -u .env.bak.* .env.save` (on ext4/SSD shred is best-effort; the real fix is to ROTATE secrets that lived in world/group-readable files).
Also check: `find /opt /root /home -maxdepth 3 \( -name "*.sql" -o -name "*.dump" -o -name "*.pem" -o -name "id_*" \) -perm /o+r 2>/dev/null`
and `.git` directories under web roots. Add `umask 027` for the root shell/cron that makes backups (backup agent handles code side).

## 3. Docker socket
`/var/run/docker.sock` must be `root:docker 660`. `grep -rn docker.sock docker-compose*.yml` — NO container should mount it (full host takeover if that container is compromised). If one does (e.g. a monitoring/watchtower tool), mount `:ro` is NOT sufficient; remove it or use a socket-proxy.

## 4. `/etc/docker/daemon.json` (RISK: medium - needs dockerd restart; with live-restore containers keep running, but FIRST time enabling live-restore requires a restart which restarts containers ~10-30 s)
Back up: `cp -a /etc/docker/daemon.json{,.bak.$(date +%F)} 2>/dev/null`. Merge (don't overwrite existing keys such as registry mirrors!):
```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true,
  "userland-proxy": false,
  "icc": true
}
```
- Log rotation applies only to containers CREATED afterwards -> `docker compose up -d --force-recreate` in a maintenance window.
- `no-new-privileges: true` daemon-wide may break images that use setuid binaries (e.g. `sudo` inside container, chromium sandbox with setuid). Test on the backend; if PDF/screenshots fail, remove the key and set it per-service.
- `userland-proxy:false` -> hairpin/localhost access to published ports uses iptables; with `127.0.0.1:` binds this requires `net.ipv4.conf.all.route_localnet=1`, which Docker sets itself. If curl to 127.0.0.1:8081 fails after the change, revert this key.
- Validate: `dockerd --validate --config-file=/etc/docker/daemon.json` ; apply: `systemctl restart docker` (window!). Rollback: restore the .bak and restart.

## 5. OPTIONAL compose hardening patch (apply per service, one at a time, test, keep what works)
```yaml
  admin:               # same for marketing, web (Next.js)
    read_only: true
    tmpfs: [ "/tmp", "/app/.next/cache" ]       # Next needs a writable cache dir; adjust
    cap_drop: [ ALL ]
    security_opt: [ "no-new-privileges:true" ]
    user: "1000:1000"                           # only if image's files are readable by uid 1000 (check Dockerfile USER)
    mem_limit: 768m
    pids_limit: 512
  proxy:               # nginx container
    cap_drop: [ ALL ]
    cap_add: [ CHOWN, SETGID, SETUID, NET_BIND_SERVICE ]
    security_opt: [ "no-new-privileges:true" ]
  backend:             # RISK HIGH - do last, maybe never all of it
    cap_drop: [ ALL ]
    security_opt: [ "no-new-privileges:true" ]
    pids_limit: 1024
    mem_limit: 2g
    # NOT read_only: writes uploads/backups/pdf temp. Chromium (puppeteer) needs either
    # --no-sandbox (already?) or SYS_ADMIN/seccomp profile; cap_drop ALL can break it. pg_dump needs a writable backup dir and /tmp.
  postgres:
    cap_drop: [ ALL ]
    cap_add: [ CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID ]
    security_opt: [ "no-new-privileges:true" ]
```
Test matrix after each change: login, PDF export/print, image upload, backup run, WebSocket chat, public booking page. Rollback = revert the service block and `docker compose up -d <service>`.
