#!/usr/bin/env bash
# SSH hardening via drop-in. DRY-RUN by default.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

# پیشوند 00: sshd «اولین مقدار» را برنده می‌داند و 50-cloud-init.conf روی اوبونتو PasswordAuthentication yes می‌گذارد؛
# با 99 فایل ما هرگز اثر نمی‌کرد. پس باید قبل از همه خوانده شود.
DROPIN="/etc/ssh/sshd_config.d/00-exir-hardening.conf"
MODE="dry"
usage() {
  cat <<USAGE
Usage: sudo $0 [--apply | --rollback] [--help]
  (default)   dry-run: validate and print the drop-in + diff, change nothing
  --apply     write $DROPIN, run 'sshd -t', reload sshd (NOT restart)
  --rollback  remove the drop-in (or restore latest backup) and reload sshd
Pre-flight refuses to continue unless root/invoking user has an authorized_keys
entry and 'sshd -t' passes on the new config. KEEP YOUR CURRENT SESSION OPEN and
test a second login before closing it.
USAGE
}
for a in "$@"; do
  case "$a" in
    --apply) MODE="apply";; --rollback) MODE="rollback";; -h|--help) usage; exit 0;;
    *) usage; die "unknown arg: $a";;
  esac
done

render() {
cat <<CONF
# Managed by Exir hardening kit (01-harden-ssh.sh). Remove file to roll back.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 6
MaxSessions 6
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
# AllowTcpForwarding left at default on purpose (owner may tunnel to Postgres etc.); set 'no' if not needed.
ClientAliveInterval 300
ClientAliveCountMax 2
# اتصال‌های نیمه‌باز (احراز نشده): سیل حمله‌ی حدسی (بیش از یک میلیون تلاش) پیش‌فرض 10:30:100 را پر می‌کرد و
# اتصال‌های قانونیِ ما (rsync/deploy) را قطع می‌کرد. start:rate:full
MaxStartups 30:30:120
# الگوریتم‌ها عمداً دست‌نخورده‌اند: پیش‌فرض‌های OpenSSH 9.6 اوبونتو ۲۴٫۰۴ مدرن‌اند و محدودکردن دستی فقط
# ریسک ناسازگاری با کلاینت‌های قدیمی (و قفل‌شدن) دارد.
CONF
}

have_keys() {
  local f n=0 home
  for f in /root/.ssh/authorized_keys ${SUDO_USER:+"$(getent passwd "$SUDO_USER" | cut -d: -f6)/.ssh/authorized_keys"}; do
    [ -r "$f" ] || continue
    home="$(grep -Ecv '^[[:space:]]*(#|$)' "$f" || true)"
    n=$((n + home))
    log "authorized_keys: $f has $home key line(s)"
  done
  [ "$n" -gt 0 ]
}

if [ "$MODE" = "rollback" ]; then
  need_root
  latest="$(ls -1t "$DROPIN".bak.* 2>/dev/null | head -n1 || true)"
  if [ -n "$latest" ]; then cp -a -- "$latest" "$DROPIN"; log "restored $latest"
  else rm -f -- "$DROPIN"; log "removed $DROPIN"; fi
  sshd -t || die "sshd -t failed after rollback; fix manually"
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  log "sshd reloaded"; exit 0
fi

have sshd || die "sshd not found (run on the server)"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
render >"$tmp"

echo "---- diff vs current $DROPIN ----"
diff -u "${DROPIN}" "$tmp" 2>/dev/null || [ -e "$DROPIN" ] || cat "$tmp"
echo "---- end ----"
echo "Effective values that would be overridden today:"
sshd -T 2>/dev/null | grep -Ei '^(passwordauthentication|permitrootlogin|maxauthtries|x11forwarding)' || true

if [ "$MODE" = "dry" ]; then
  log "DRY-RUN only. Re-run with --apply (as root) to apply."
  exit 0
fi

need_root
have_keys || die "no authorized_keys entries for root/invoking user - refusing (you would lock yourself out)"
# Warn if main config has Include missing: drop-ins are ignored then.
grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config \
  || die "/etc/ssh/sshd_config lacks 'Include /etc/ssh/sshd_config.d/*.conf'; drop-in would be ignored"
# فایل ما 00- است و قبل از هر drop-in دیگر (مثل 50-cloud-init.conf) خوانده می‌شود؛ پس مقدارهای ما برنده‌اند.

backup_file "$DROPIN"
install -m 0644 -o root -g root "$tmp" "$DROPIN"
if ! sshd -t; then
  warn "sshd -t FAILED, reverting"
  latest="$(ls -1t "$DROPIN".bak.* 2>/dev/null | head -n1 || true)"
  if [ -n "$latest" ]; then cp -a -- "$latest" "$DROPIN"; else rm -f -- "$DROPIN"; fi
  die "config invalid; reverted"
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd
log "sshd reloaded with $DROPIN"
log "effective values now:"
sshd -T 2>/dev/null | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication|maxauthtries|maxstartups)' || true
echo "!!! DO NOT CLOSE THIS SESSION !!!"
echo "Open a SECOND terminal now and verify:  ssh -o PreferredAuthentications=publickey root@<server>"
echo "Only if it works, close the old one. If not:  sudo $0 --rollback"
