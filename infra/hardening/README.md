# کیت سخت‌سازی (Hardening) سرور تولید Exir

> این کیت **فقط فایل و اسکریپت** است؛ هیچ‌چیز به‌صورت خودکار روی سرور اجرا نمی‌شود. همهٔ اسکریپت‌ها به‌طور پیش‌فرض **Dry-Run** هستند و فقط با `--apply` تغییر می‌دهند، از هر فایل تغییرکرده نسخهٔ پشتیبان زمان‌دار می‌گیرند و `--rollback` دارند.
> بخش‌های امنیت برنامه (`apps/backend-core`) و بکاپ/DR در این کیت دخالت داده نشده‌اند.

## قوانین طلایی (قبل از هر کاری)
1. **یک نشست root را همیشه باز نگه دارید** (SSH فعلی) تا پایان همهٔ تغییرات SSH/فایروال/Docker.
2. پس از هر تغییر SSH/فایروال، **یک نشست دوم (ترمینال جدید) باز کنید و ورود را تست کنید**؛ فقط بعد از موفقیت نشست اول را ببندید.
3. کنسول VNC/Rescue پنل میزبان (provider) را آماده داشته باشید.
4. قبل از شروع یک بکاپ تازه از دیتابیس و `.env` (آفلاین/رمزشده) بگیرید.
5. تغییرات را در ساعت کم‌ترافیک و یکی‌یکی انجام دهید.

## محتویات
| فایل | کار |
|---|---|
| `audit-host.sh` | چک‌لیست فقط‌خواندنی PASS/FAIL (هر زمان اجرا کنید) |
| `01-harden-ssh.sh` | drop-in برای sshd (dry-run / `--apply` / `--rollback`) |
| `02-fail2ban.sh` + `fail2ban/` | نصب fail2ban، jail برای sshd و nginx، فیلترها |
| `03-docker-ports.patch.md`, `docker-user-guard.sh`, `exir-docker-guard.service` | bind پورت‌ها روی 127.0.0.1 + قفل DOCKER-USER |
| `nginx/` | snippetهای nginx میزبان + `install-nginx-snippets.sh` + نمونهٔ `app.eta.co.ir` |
| `04-…md`, `05-…md`, `06-…md` | آپدیت خودکار، حساب‌ها/فایل‌ها/Docker، مانیتورینگ |
| `check-certs.sh` | بررسی انقضای گواهی (cron-able) |

## ترتیب پیشنهادی اجرا
| # | گام | ریسک | علت ترتیب |
|---|---|---|---|
| 0 | `./audit-host.sh` (baseline) + بکاپ | هیچ | خط پایه |
| 1 | پورت‌های Docker روی loopback (`03`) | **متوسط** (۵–۱۵ ثانیه قطعی) | بزرگ‌ترین حفره: پنل ادمین روی HTTP ساده از اینترنت |
| 2 | fail2ban فقط jail ـ`sshd` (`02`) | کم | جلوگیری از brute-force؛ ابتدا `ignoreip` را پر کنید |
| 3 | سخت‌سازی SSH (`01`) | **بالا** (قفل‌شدن) | بعد از اطمینان از کلید SSH کارا |
| 4 | snippetهای nginx: version/tls/headers (`nginx/`) | کم-متوسط | بدون تغییر رفتار برنامه |
| 5 | `real-ip.conf` با رنج‌های CDN → سپس rate-limit → سپس jailهای nginx | **متوسط** | اگر قبل از real-ip فعال شود IP لبهٔ CDN مسدود می‌شود |
| 6 | TLS برای `app.eta.co.ir` (نمونه) | **متوسط** | به حالت SSL در پنل آروان وابسته است (حلقهٔ ریدایرکت!) |
| 7 | آپدیت خودکار (`04`) | کم | |
| 8 | کاربر deploy، قفل رمز root، فایل‌های `.env` (`05`) | متوسط | بعد از SSH |
| 9 | `daemon.json` و hardening کانتینرها (`05`) | متوسط/بالا | در پنجرهٔ نگهداری |
| 10 | DOCKER-USER guard + مانیتورینگ (`03-E`, `06`) | کم | دفاع در عمق |

---
## گام ۰ – پیش‌بررسی
```bash
scp -r infra/hardening root@45.94.215.22:/root/hardening     # از لپ‌تاپ شما (نه توسط این کیت)
ssh root@45.94.215.22
cd /root/hardening && chmod +x *.sh nginx/*.sh && ./audit-host.sh --domains app.eta.co.ir,exirerp.ir,admin.exirerp.ir
```
## گام ۱ – پورت‌های Docker  (جزئیات: `03-docker-ports.patch.md`)
- بررسی: هیچ مانیتور/webhook/CDN origin به `IP:8080/8081/8082` مستقیم اشاره نکند.
- اجرا: ویرایش compose → `docker compose -f docker-compose.on-premise.yml up -d admin marketing proxy`
- تأیید: `ss -tlnp | grep -E ':(8080|8081|8082|8084)'` همه `127.0.0.1`؛ از بیرون `nc -zvw3 45.94.215.22 8081` باید fail شود؛ `8083` باید باز بماند.
- **Rollback:** `cp /root/compose.bak.<ts> docker-compose.on-premise.yml && docker compose -f docker-compose.on-premise.yml up -d admin marketing proxy`

## گام ۲ – fail2ban
```bash
nano fail2ban/jail.d/exir.local        # OWNER_IP_PLACEHOLDER را با IPهای ثابت خودتان جایگزین کنید
./02-fail2ban.sh                        # dry-run
./02-fail2ban.sh --apply
fail2ban-client status sshd
```
- jailهای nginx به‌طور پیش‌فرض `enabled=false` هستند (گام ۵).
- تست فیلترها: `fail2ban-regex /var/log/nginx/access.log /etc/fail2ban/filter.d/exir-nginx-auth.conf`
- رفع بن اشتباه: `fail2ban-client set sshd unbanip <IP>`
- **Rollback:** `./02-fail2ban.sh --rollback` (یا `systemctl disable --now fail2ban`)

## گام ۳ – SSH  (**نشست root فعلی را نبندید**)
```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@45.94.215.22     # از هر دستگاهی که با پسورد وارد می‌شود (تصمیم مالک!)
./01-harden-ssh.sh                      # dry-run: diff را بخوانید
./01-harden-ssh.sh --apply              # reload (نه restart)
# --- ترمینال دوم ---
ssh -o PreferredAuthentications=publickey root@45.94.215.22 'echo OK'
ssh -o PubkeyAuthentication=no root@45.94.215.22            # باید Permission denied بدهد
```
- اسکریپت اگر کلیدی در `authorized_keys` نباشد، `sshd -t` شکست بخورد، یا drop-in دیگری (مثل `50-cloud-init.conf`) `PasswordAuthentication yes` بگذارد **متوقف می‌شود**.
- **Rollback:** `./01-harden-ssh.sh --rollback` (یا از کنسول VNC: `rm /etc/ssh/sshd_config.d/99-exir-hardening.conf && systemctl reload ssh`)

## گام ۴ – nginx (سرصفحه‌ها، TLS، نسخه)
```bash
cd nginx && ./install-nginx-snippets.sh            # dry-run
./install-nginx-snippets.sh --apply                # بکاپ tar در /root/nginx-backup-<ts>.tgz ؛ nginx -t ؛ reload
```
سپس در هر `server {}` (به تدریج، با `nginx -t && systemctl reload nginx`):
```nginx
include /etc/nginx/exir/security-headers-server.conf;
include /etc/nginx/exir/hsts.conf;                  # فقط در بلاک‌های listen 443 ssl
include /etc/nginx/exir/block-bots-probes.conf;     # فقط میزبان‌های غیر-WordPress
```
- `X-Frame-Options` برای مسیرهای `/f/`, `/embed/` و `/api/public/forms/` ارسال **نمی‌شود** تا فرم‌ها در سایت‌های دیگر embed شوند؛ تست: `curl -sI https://HOST/f/x | grep -i x-frame` (خالی) و `curl -sI https://HOST/ | grep -i x-frame` (SAMEORIGIN).
- CSP فقط **Report-Only** است؛ endpoint گزارش را طبق کامنت فایل بسازید.
- HSTS با `max-age=86400` شروع می‌شود؛ بعد از یک هفته به ۱ سال برسانید.
- **Rollback:** `./install-nginx-snippets.sh --rollback` ؛ یا حذف خطوط include و reload.

## گام ۵ – real-ip → rate-limit → jailهای nginx
1. رنج‌های آروان/کلودفلر: `./nginx/refresh-cdn-ranges.sh` → خروجی را بازبینی و در `/etc/nginx/conf.d/exir-20-real-ip.conf` بگذارید. (لیست‌های داخل فایل placeholder هستند.)
2. بررسی: لاگ nginx باید IP واقعی کاربر را نشان دهد، نه IP لبهٔ CDN.
3. `include /etc/nginx/exir/rate-limit-server.conf;` در هر vhost. ابتدا با `limit_req_dry_run on;` و بررسی لاگ ۲۴ ساعته (429 های کاذب)، سپس حذف dry-run.
   کلاس‌ها: `/api/auth/` → ۲۰ در دقیقه (burst ۱۵)، `/api/public/` → ۱۰/ثانیه (burst ۴۰)، `/api/` → ۳۰/ثانیه (burst ۱۰۰). پشت NAT مشترک مشکلی نیست مگر >۱۵ ورود همزمان؛ در صورت نیاز burst را بالا ببرید. مسیر `/socket.io/` محدود نمی‌شود.
4. در `fail2ban/jail.d/exir.local` سه jail nginx را `enabled = true` کنید و `fail2ban-client reload`. (حتماً IP مالک در ignoreip باشد.)
- **Rollback:** حذف include و reload؛ `fail2ban-client set exir-nginx-auth unbanip <IP>`.

## گام ۶ – TLS برای app.eta.co.ir
`nginx/app.eta.co.ir.example.conf` را بخوانید. حالت SSL در پنل آروان: *Flexible* = origin می‌تواند HTTP بماند (ریدایرکت HTTP→HTTPS در origin حلقه می‌سازد!)؛ *Full* = نیاز به این بلاک 443. گواهی با DNS-01 یا `certbot --webroot`. تست: `certbot renew --dry-run`. **Rollback:** حذف سایت جدید از `sites-enabled` و reload، سپس حالت CDN را به Flexible برگردانید.

## گام ۷ تا ۱۰
`04-unattended-upgrades-and-kernel.md`، `05-host-accounts-and-files.md`، `06-monitoring.md`، و `03-…md` بخش E هر کدام Rollback مخصوص خود را دارند.

## بررسی نهایی
`./audit-host.sh --domains app.eta.co.ir,exirerp.ir,admin.exirerp.ir --backup-dir <مسیر بکاپ>` را اجرا و FAILها را صفر کنید. هفتگی در cron اجرا شود.

## تصمیم‌های مالک
1. IPهای ثابت مالک/دفتر برای `ignoreip` (و برای محدودکردن SSH با ufw اختیاری: `ufw allow from <IP> to any port 22`).
2. آیا از دستگاه‌های دیگر با پسورد SSH می‌زنید؟ باید پیش از گام ۳ برایشان کلید بسازید.
3. آیا سرویسی (مانیتور، webhook پرداخت/پیامک، origin آروان، اپ موبایل) مستقیم به `:8080/:8081/:8082` می‌خورد؟
4. حالت SSL آروان برای `app.eta.co.ir` (Flexible/Full) و کدام دامنه‌ها پشت CDN هستند.
5. آیا `eta.co.ir` هنوز WordPress است (آنگاه `block-bots-probes.conf` را آنجا include نکنید)؟
6. سیاست reboot: دستی در پنجرهٔ برنامه‌ریزی‌شده (پیشنهاد) یا خودکار.
7. نقطهٔ اعلان (SMS exirsms / ایمیل) برای هشدارها.
8. دسترسی عمومی به `/api/docs` (Swagger) – بهتر است محدود شود (نمونه در `block-bots-probes.conf`).
9. `deploy-remote.sh` از root استفاده می‌کند؛ مهاجرت به کاربر deploy قبل از `PermitRootLogin no`.

## وضعیت تست محلی
- `bash -n` روی همهٔ اسکریپت‌ها: موفق. `audit-host.sh` روی macOS اجرا و بدون خطا degrade می‌شود.
- shellcheck، nginx، fail2ban و Docker روی ماشین توسعه موجود نبودند → `nginx -t`، `fail2ban-regex`، `sshd -t` و `iptables` **تست نشده‌اند** و باید روی سرور (ابتدا dry-run) اجرا شوند. regexهای fail2ban معادل پایتونی روی نمونه لاگ‌ها تست شد.
