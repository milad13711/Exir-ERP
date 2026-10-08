# 04 - Automatic security updates and kernel

Risk: LOW (updates) / MEDIUM (auto-reboot on a single server = downtime).

## Verify / enable
```bash
dpkg -s unattended-upgrades | grep Status          # install: apt-get install -y unattended-upgrades
systemctl is-enabled --now apt-daily.timer apt-daily-upgrade.timer
cat /etc/apt/apt.conf.d/20auto-upgrades            # want: Update-Package-Lists "1"; Unattended-Upgrade "1";
unattended-upgrade --dry-run -d 2>&1 | tail -20
tail -50 /var/log/unattended-upgrades/unattended-upgrades.log
```
## Security-only policy
`/etc/apt/apt.conf.d/50unattended-upgrades` (Ubuntu default already) must have only:
```
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
  "${distro_id}ESMApps:${distro_codename}-apps-security";
  "${distro_id}ESM:${distro_codename}-infra-security";
};
```
(`-updates` stays commented out so no surprise Docker/nginx minor upgrades.) Add an override file instead of editing the original:
`/etc/apt/apt.conf.d/52exir-unattended`:
```
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Mail "you@example.com";        // needs a local MTA; else rely on 06-monitoring
Unattended-Upgrade::MailReport "only-on-error";
Unattended-Upgrade::Automatic-Reboot "false";       // see policy below
```
Rollback: delete the override file.

## Reboot policy (single server = every reboot is a full outage, ~1-2 min + container start)
Recommended: **no auto-reboot**. The audit script warns when `/var/run/reboot-required` exists; the owner reboots in a planned
window (e.g. Thursday 03:00 Tehran) after a backup. If auto-reboot is wanted anyway:
```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
```
Pre-requisites before enabling: all containers `restart: unless-stopped` (they are), docker enabled at boot (`systemctl is-enabled docker`),
host nginx enabled, ufw enabled, `exir-docker-guard` enabled, and `/etc/docker/daemon.json` `live-restore` true (05) reduces blips on dockerd upgrades.
Test boot recovery once manually in a window, with a second session ready and the provider's VNC/console panel open.

## Kernel live patching (avoids most reboots)
Ubuntu Pro (free for up to 5 machines for personal use): `pro attach <token>` then `pro enable livepatch`; check `canonical-livepatch status`.
Note: some Iranian hosting providers/IP ranges cannot reach Canonical's servers; if `pro attach` fails, skip this and use the manual reboot window.
Also `apt install needrestart` (set `$nrconf{restart} = 'l'` in /etc/needrestart/needrestart.conf to only list, never auto-restart, services).
