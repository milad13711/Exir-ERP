# کیت پایش سطح میزبان (host-watch) + پایش بیرونی

> فقط فایل و اسکریپت؛ هیچ‌چیز به‌طور خودکار روی سرور اجرا نشده است. نصب دستی و گام‌به‌گام زیر انجام می‌شود.
> جایگزین `../06-monitoring.md` نیست؛ همان ایده‌ها را در یک تایمر واحد با dedupe و اعلان رفع جمع می‌کند.

## چه چیزی را تشخیص می‌دهد؟
| لایه | چه چیزی | کجا |
|---|---|---|
| بک‌اند (داخل برنامه) | سایت‌ها پاسخ می‌دهند، گواهی TLS، دیسک بکاپ/برنامه، دیتابیس، نرخ خطا، اعتبار پیامک، تازگی بکاپ | `apps/backend-core/src/monitoring` ـ صفحه‌ی ادمین «پایش و هشدار» |
| میزبان (این کیت) | ورود موفق SSH از IP/کلید ناشناخته، جهش بن fail2ban، جهش 5xx در nginx، کانتینر unhealthy/restarting، دیسک >۸۵٪، reboot معوق، گواهی، سرویس‌های failed | `host-watch.sh` با systemd timer |
| بیرونی | قطع کامل سرور/شبکه/DNS | `EXTERNAL-UPTIME.md` (تنها راه تشخیص «سرور مرده است») |

## مسیر هشدار
`host-watch.sh` → `POST /api/internal/alert` (هدر `X-Internal-Alert-Token`) → بک‌اند (dedupe روزانه + سقف روزانه + کانال SMS اکسیر) → پیامک به `MONITOR_ALERT_PHONE`.
- بک‌اند فقط از loopback/شبکه‌ی خصوصی docker و **بدون** `X-Real-IP/X-Forwarded-For` می‌پذیرد، توکن را ثابت‌زمان مقایسه می‌کند و نرخ را محدود می‌کند (پیش‌فرض ۶۰ در ۱۰ دقیقه). بدون `INTERNAL_ALERT_TOKEN` (≥۳۲ نویسه) مسیر ۴۰۴ است.
- اگر بک‌اند در دسترس نباشد، هشدار در `/var/lib/exir-host-watch/spool` صف می‌شود و اجرای بعد دوباره تلاش می‌کند؛ همیشه به syslog هم می‌رود (`journalctl -t exir-host-watch`).
- ضربان: هر اجرا یک heartbeat می‌فرستد؛ اگر ۳۰ دقیقه نیاید، چک «ضربان host-watch» در برنامه هشدار می‌دهد (تایمر خراب/متوقف شده).

## نصب (روی سرور، به‌عنوان root، ساعت کم‌ترافیک؛ ریسک: کم)
1. **توکن**: `openssl rand -hex 32` → در `.env` برنامه به‌عنوان `INTERNAL_ALERT_TOKEN` (و همان در گام ۳). همین‌جا `MONITOR_ALERT_PHONE` و `MONITOR_URLS` و `MONITOR_TLS_HOSTS` را هم بگذارید (بخش «متغیرها»). بک‌اند را ری‌استارت کنید: `docker compose up -d backend`.
   - `docker-compose.on-premise.yml` این متغیرها را از `.env` به کانتینر backend پاس می‌دهد (`.env.on-premise.example` را ببینید).
2. **nginx**: `install -m0644 nginx-block-internal.conf /etc/nginx/snippets/exir-block-internal.conf` و در هر `server {}` عمومی `include /etc/nginx/snippets/exir-block-internal.conf;` بگذارید؛ `nginx -t && systemctl reload nginx`. تست: `curl -si https://<دامنه>/api/internal/alert -X POST` باید 404 بدهد.
3. **فایل‌ها**:
   ```
   install -d -m700 /etc/exir /var/lib/exir-host-watch
   install -m0755 host-watch.sh /usr/local/sbin/host-watch.sh
   install -m0755 ../check-certs.sh /usr/local/sbin/check-certs.sh
   install -m0600 host-watch.env.example /etc/exir/host-watch.env      # سپس ویرایش: توکن، BACKEND_CONTAINER (docker ps)، CERT_HOSTS
   install -m0600 known-ssh.allow.example /etc/exir/known-ssh.allow    # سپس ویرایش
   ```
4. **لیست مجاز SSH**: `host-watch.sh --learn-ssh` (از ۳۰ روز اخیر می‌سازد) و **حتماً دستی بازبینی کنید**؛ هر IP/کلیدی که مال شما نیست پاک شود، وگرنه ورود مهاجم «عادی» حساب می‌شود.
5. **Dry-run** (چیزی نمی‌فرستد): `/usr/local/sbin/host-watch.sh --dry-run`. **Selftest** (یک پیامک واقعی): `/usr/local/sbin/host-watch.sh --selftest` ← پیامک می‌رسد و در صفحه‌ی ادمین «پایش و هشدار» دیده می‌شود.
6. **تایمر**:
   ```
   install -m0644 exir-host-watch.service exir-host-watch.timer /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now exir-host-watch.timer
   systemctl list-timers exir-host-watch.timer ; journalctl -u exir-host-watch -n 20
   ```
7. **تست واقعی هر هشدار** (یکی‌یکی): SSH با کلید جدید از یک IP جدید (مثلاً هات‌اسپات موبایل) → باید «SSH login from NEW IP» بیاید؛ `touch -d '10 days ago' /var/run/reboot-required` → هشدار reboot (بعد حذف کنید).

**Rollback**: `systemctl disable --now exir-host-watch.timer`؛ فایل‌ها را حذف کنید. هیچ تغییری در SSH/فایروال/Docker داده نمی‌شود.

## محدودیت‌ها (صادقانه)
- host-watch با دسترسی root روی همان سرور اجرا می‌شود؛ اگر مهاجم root شود می‌تواند آن را خاموش کند — اما چک heartbeat و پایش بیرونی همین «سکوت» را آشکار می‌کند.
- تشخیص ورود SSH به journal/`auth.log` وابسته است. پسورد-لاگین باید طبق `01-harden-ssh.sh` غیرفعال باشد؛ ورود با پسورد در هر صورت هشدار می‌دهد.
- فرمت لاگ nginx باید combined (پیش‌فرض) یا مشابه باشد (کد وضعیت بعد از رشته‌ی درخواست).

## متغیرهای محیطی بک‌اند (نام‌ها؛ مقدارها فقط روی سرور)
`MONITOR_ALERT_PHONE` (fallback: `BACKUP_ALERT_PHONE` ← `ON_PREM_OWNER_PHONE`)، `MONITOR_URLS`، `MONITOR_TLS_HOSTS`، `INTERNAL_ALERT_TOKEN`، اختیاری: `MONITOR_MAX_SMS_PER_DAY` (۱۲)، `MONITOR_SMS_MIN_COUNT` (۲۰۰)، `MONITOR_APP_DISK_PATH` (`/app`)، `INTERNAL_ALERT_RATE_PER_10MIN` (۶۰)، `MONITOR_DISABLED=true`.
