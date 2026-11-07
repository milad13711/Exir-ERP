# دیده‌شدن اعلان‌ها (Notification visibility)

مشکل: اعلان صادر می‌شد (مثلاً ارجاع گزارش دانش سازمانی) ولی فقط یک نقطه‌ی قرمز کوچک کنار زنگوله می‌آمد و گیرنده متوجه نمی‌شد.

## ریشه‌ها (یافته‌ها)
- `report.referred` دسته‌ی `system` می‌گرفت و هیچ پرچم «مهم» نداشت؛ بدون لینک صریح پوش به `/dashboard` می‌رفت.
- برنامه‌ی باز + تب فوکوس‌دار در Chromium ⇒ سرویس‌ورکر اعلان سیستمی را عمداً نشان نمی‌دهد (`silentIfVisible`) و تنها نشانه همان نقطه‌ی زنگوله بود که هر ۱۵ ثانیه poll می‌شد.
- هیچ شمارنده‌ی عددی، عنوان تب، badge برنامه، توست زنده، بنر داشبورد یا یادآوری مجدد وجود نداشت.

## پیاده‌سازی
### بک‌اند (`apps/backend-core/src/notifications`)
- دسته‌ی جدید `referrals` (پیش‌فرض پوش و درون‌برنامه **روشن**؛ فقط `marketing` پوش ندارد). انواع `referral.*`، `report.referred`، `knowledge.*` در صورت نبود category صریح به آن می‌روند. (ماژول ارجاع از `category: 'approvals'` صریح استفاده می‌کند؛ آن هم «مهم» است.)
- ستون‌های جدید (مایگریشن `20261107010000_notification_visibility`، افزایشی):
  - `notifications.important` (پیش‌فرض false) و `notifications.remindedAt`
  - `notification_preferences.toastEnabled` (true)، `reminderEnabled` (true)، `reminderAfterHours` (4)
- `isImportantType()` (در `push-logic.ts`): دسته‌های `referrals/approvals/correspondence` مهم‌اند مگر نوع «نتیجه/اطلاع» باشد (پایان `.accepted/.rejected/.cancelled/.reviewed/.done/…`)؛ وظایف فقط `task.assigned/returned/overdue/extension_requested/result_submitted/problem`؛ پیام‌رسان فقط منشن. فراخواننده با `important: true|false` می‌تواند صریحاً تعیین کند.
- پیامک جایگزین همچنان فقط برای `critical` یا `important` **صریح** فراخواننده است (هزینه‌ی پیامک تغییر نکرد).
- پوش مهم بدون `link` به `/notifications` می‌رود (نه داشبورد).
- API: `GET /notifications?limit&unread=1&important=1&before=` (+`importantUnread`, `hasMore`)، `GET /notifications/attention` (اعلان‌های مهم نخوانده + شمارش بر اساس دسته و اولین بخش لینک)، و فیلدهای جدید ترجیحات در `GET/PUT /notifications/preferences`.
- یادآوری مجدد: `NotificationReminderService` (کرون هر ۳۰ دقیقه، همه‌ی تننت‌های فعال):
  - مهم + نخوانده + یادآوری‌نشده + قدیمی‌تر از N ساعت (پیش‌فرض ۴، ۱ تا ۴۸) و تازه‌تر از ۷۲ ساعت؛
  - فقط ساعات کاری ۰۸:۰۰–۱۹:۰۰ تهران و بیرون از ساعات سکوت کاربر؛
  - idempotent با ادعای اتمیک `updateMany(remindedAt: null → now)`؛ هر اعلان حداکثر یک‌بار؛
  - سقف: یک پیام تجمیعی برای هر کاربر در هر اجرا و حداکثر ۳ یادآوری در ۲۴ ساعت؛ خود یادآوری (`notification.reminder`) هرگز دوباره یادآوری نمی‌شود؛
  - از `NotificationsService.notify` می‌گذرد، پس ترجیحات دسته/سکوت/پوش همان‌طور رعایت می‌شود.

### وب‌پنل (`apps/web-panel`)
- `lib/notification-logic.ts`: منطق خالص (نشان ۹۹+، پیشوند عنوان تب، گروه‌بندی امروز/قبل‌تر، تصمیم توست، پشته‌ی ۳تایی، backoff).
- `lib/notification-store.ts`: **یک** حلقه‌ی poll مشترک (۸ث دیدنی → ۱۵ث/۳۰ث با بی‌تعاملی، ۶۰ث تب پنهان، backoff نمایی تا ۱۲۰ث؛ فوراً روی focus/visibility/online و پیام `push-received` سرویس‌ورکر).
- `NotificationBell`: نشان عددی، زنگ و پرش یک‌باره هنگام ورود، پنل دسکتاپ / برگه‌ی تمام‌صفحه‌ی موبایل، فیلتر همه/نخوانده، علامت‌گذاری همه.
- `NotificationToaster`: کارت زنده با «مشاهده»؛ مهم‌ها چسبنده، بقیه ۷ ثانیه؛ حداکثر ۳ و «+N اعلان دیگر»؛ `aria-live`؛ ترجیح توست، `inApp` هر دسته و ساعات سکوت رعایت می‌شود (آلارم/امنیتی استثنا). اعلان‌های قدیمیِ موجود هنگام ورود توست نمی‌شوند.
- `NotificationRuntime`: `navigator.setAppBadge` و پیشوند «(۳) …» روی عنوان تب.
- `AttentionCard` بالای داشبورد، نشان عددی روی آیتم‌های منوی تک‌بخشی (`/tasks`، `/approvals`، `/reports` …) از `byLink`، صفحه‌ی `/notifications`، و تنظیمات (توست، یادآوری، ساعت یادآوری، ردیف «ارجاع‌ها»).

## آزمون
- `notification-visibility.spec.ts` (پیش‌فرض‌ها، مهم‌بودن، selectDueReminders، idempotency/سقف/رقابت کرون)
- `notification-client-logic.spec.ts` (منطق خالص سمت مرورگر)

## تأیید‌نشده
در مرورگر/دستگاه واقعی بررسی نشد: ظاهر دقیق توست و برگه‌ی موبایل، `setAppBadge` در PWA نصب‌شده، رسیدن پوش واقعی، و اجرای کرون روی تننت‌های واقعی.
