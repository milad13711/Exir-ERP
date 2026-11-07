# خلاصه‌ی اشتراک (منبع واحد حقیقت)

کد: `apps/backend-core/src/billing/subscription-summary.ts` (توابع خالص) + `subscription-summary.service.ts` (بارگذاری داده).

## وضعیت‌ها
`ACTIVE`, `TRIAL`, `EXPIRING_SOON` (فقط وقتی تمدید واقعاً لازم است: ≤۱۰ روز تا پایان)، `GRACE` (دوره تمام شده ولی طبق اجرا هنوز قابل‌استفاده)، `EXPIRED` (واقعاً غیرقابل‌استفاده)، `SUSPENDED`، `NOT_SUBSCRIBED`، `NO_EXPIRY` (پایه/مادام‌العمر/فعال‌شده بدون تاریخ/لایسنس دائمی).
هر مورد: `usable`, `billingOnly`, `expiresAt`, `daysLeft`, `hoursLeft`, `daysOverdue` (روز تقویمی تهران), `openInvoice` (فقط PENDING), `awaitingApproval`, `nextAction` (`PAY_INVOICE | REQUEST_INVOICE | CONTACT_SUPPORT | NONE`), `severity`, `reason`.

## قاعده‌ی تقدم (تننت)
1. `Tenant.status` SUSPENDED/CANCELLED ⇒ `SUSPENDED`.
2. استقرار on-premise با لایسنس محلی ⇒ وضعیت از لایسنس (ردیف اشتراک ابری نادیده)؛ مسیر تمدید = پشتیبانی.
3. بدون اشتراک ⇒ `NOT_SUBSCRIBED`؛ `lifetime` ⇒ `NO_EXPIRY`.
4. `PENDING_PAYMENT` ⇒ `billingOnly` با فاکتور باز یا درخواست فاکتور.
5. TRIAL / تمام‌شده‌ی ACTIVE (`GRACE`) / `EXPIRING_SOON` / `ACTIVE`. رکورد قدیمیِ پرداخت‌شده (`staleRecord`) هرگز منقضی نشان داده نمی‌شود.

ماژول: همان `isModuleRowUsable` که `ModuleGuard` استفاده می‌کند؛ تننت: `tenantAccess` که `JwtAuthGuard` استفاده می‌کند. پس «قابل‌استفاده» در نمایش و اجرا یکی است (spec: `subscription-summary.spec.ts`، ماتریس کامل با ModuleGuard).

## نقاط مصرف
- `GET /billing/subscription-summary` (تننت؛ زیر `billing/*` تا در PENDING_PAYMENT هم کار کند). OWNER/ADMIN جزئیات کامل؛ بقیه فقط وضعیت خنثی (بدون مبلغ/فاکتور/تاریخ/پلن).
- `POST /billing/renewal-requests {moduleCode?}` (OWNER/ADMIN): صدور فاکتور تمدید ماژول یا پلن؛ idempotent؛ قفل مانده روی فاکتور ردشده را آزاد می‌کند.
- `GET /admin/tenants/:id/subscription-summary` (ادمین‌پنل).
- وب‌پنل: `useWorkspace().subscription` ← `SubscriptionHeaderChip` (هدر) و `settings/billing`؛ متن‌ها فقط در `lib/subscription-copy.ts`. صفحه‌ی `billing-locked` هم همین را می‌خواند.
- کرون‌ها: `BillingDunningService` فقط وقتی SMS می‌فرستد که خلاصه `EXPIRING_SOON/GRACE/TRIAL` باشد؛ `ModuleRenewalService` فقط ماژول `INSTALLED` را فاکتور می‌کند.
- پرداخت فاکتور پلن (`settleInvoicePaid`) اکنون اشتراک را هم ACTIVE/تمدید می‌کند؛ کرون پایان آزمایشی تننتِ پرداخت‌کرده را قفل نمی‌کند.

`/me/module-renewals` و `/billing/subscription` (وب‌پنل) دیگر استفاده نمی‌شوند؛ اولی حذف شد، دومی برای سازگاری سمت سرور باقی است.
