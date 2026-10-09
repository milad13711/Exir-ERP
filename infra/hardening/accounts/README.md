# Per-project server accounts (no more shared root)

| Project | Account | How it deploys | Privileges |
|---|---|---|---|
| tirdad (majidtirdad.ir) | `tirdad-app` | GitHub Action `accounts/tirdad-deploy.yml` (SSH key) or the owner's Mac key | owns /home/tirdad-app + its pm2; no sudo, no docker |
| funnelking (funnelking.ir) | `funnelking` | `ssh funnelking@SERVER sudo /usr/local/sbin/funnelking-deploy` | may ONLY run that one script as root (sudoers `/etc/sudoers.d/funnelking-deploy`) |
| exirsms-chat | `exirsms-chat` | pm2 | existing account |
| Exir ERP | root via key `exir-deploy` | `scripts/deploy.sh` | root (only remaining root key) |

`funnelking-deploy` builds the image first, replaces the container only after a successful build, binds 127.0.0.1:8084
(host nginx proxies to it), health-checks, and rolls back to the previous image on failure. Flags: `--no-pull`, `--check`.
