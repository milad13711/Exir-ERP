# API ورودی محصولات نمایندگی (`/api/agents-api/v1`)

محصولات اکسیر (ERP، املاک، پنل پیامک، …) رویداد ثبت‌نام و پرداخت مشتری را به تننت رجیستری می‌فرستند تا به نماینده‌ی معرف نسبت داده شود.
این مسیرها بیرون از JWT عادی هستند و فقط با کلید محصول کار می‌کنند.

## احراز و امضا
- `Authorization: Bearer exir_agent_…` — کلید هر محصول (فقط هش SHA-256 ذخیره می‌شود؛ هنگام ساخت یک‌بار نمایش داده می‌شود).
- `X-Exir-Timestamp` — ثانیه‌ی یونیکس (یا میلی‌ثانیه)؛ اختلاف مجاز ±۵ دقیقه.
- `X-Exir-Signature` — hex از `HMAC_SHA256(signingSecret, timestamp + "." + rawBody)`؛ برای GET بدنه خالی است (`timestamp + "."`). پیشوند `sha256=` اختیاری است.
- رمز امضا (`exir_sign_…`) جدا از کلید است و رمزنگاری‌شده (AES-256-GCM با `APP_SECRETS_KEY`) نگه‌داری می‌شود؛ بدون این کلید سرور ساخت کلید جدید را رد می‌کند.
- سقف نرخ هر کلید (پیش‌فرض ۱۲۰ در دقیقه) + سقف IP پیش از احراز (`AGENT_API_IP_LIMIT_PER_MIN`، پیش‌فرض ۳۰۰). بدنه حداکثر ۳۲ کیلوبایت.

## مسیرها
| متد | مسیر | کار |
|---|---|---|
| GET | `/health` | بررسی کلید + امضا؛ `{status, product, time}` |
| GET | `/referral-codes/:code/validate` | `{valid}` — فقط کدهای فعالِ همین محصول |
| POST | `/events` | دریافت رویداد (ایدمپوتنت با `eventId`) — ۲۰۲ پذیرفته / ۲۰۰ تکراری |

## قالب رویداد
```json
{ "eventId": "evt-1", "type": "customer.registered", "occurredAt": "2026-11-08T10:00:00Z", "data": { } }
```
- `customer.registered`: `referralCode, externalCustomerId, name, phone?, email?`
- `subscription.activated` / `subscription.renewed`: `externalCustomerId, planCode, planName, amount, currency (IRT|IRR), paidAt, periodEnd, paymentRef, isTrial?`
- `subscription.cancelled`: `externalCustomerId, reason?`
- `payment.refunded`: `paymentRef, amount, currency, externalCustomerId?`
- `transaction.recorded` (**توصیه‌شده برای همه‌ی پرداخت‌ها**): `transactionId, externalCustomerId, txType, itemCode?, itemName?, occurrence? (FIRST|RENEWAL|ONE_OFF), grossAmount?, discountAmount?, taxAmount?, netAmount?, currency, paidAt, periodEnd?, refundOf?`

### دفتر مرکزی تراکنش‌ها و پورسانت
هر پرداختِ محصول را — **چه مشتری نماینده داشته باشد چه نه** — با `transaction.recorded` بفرستید؛ همه در «تراکنش‌ها و پورسانت» ERP مرکزی ثبت می‌شوند.
- `transactionId`: شناسه‌ی یکتای تراکنش نزد محصول — ایدمپوتنت (ارسال دوباره، حتی با `eventId` تازه، تکراری حساب می‌شود).
- `txType`: نوع تراکنش با کد ثابت، مثلاً `SUBSCRIPTION` (اشتراک)، `MODULE` (خرید ماژول)، `SMS_PACKAGE`؛ `itemCode`: قلم، مثلاً `crm`. کد ناشناخته خودکار به کاتالوگ محصول اضافه می‌شود تا ادمین برایش قانون پورسانت بگذارد.
- مبنای پورسانت **مبلغ خالص** است: `netAmount`، یا اگر نیامد `grossAmount − discountAmount`. مالیات (`taxAmount`) فقط ثبت می‌شود و هرگز مبنا نیست.
- `occurrence`: اگر نفرستید، ERP از سابقه‌ی همین مشتری برای همین نوع/قلم تشخیص می‌دهد: اولین پرداخت `FIRST`، بعدی‌ها `RENEWAL`.
- بازپرداخت: همان رویداد با `refundOf` = `transactionId` تراکنش اصلی و مبلغ برگشتی؛ پورسانت به‌نسبت و فوری برگشت می‌خورد. جمع بازپرداخت‌ها بیش از مبلغ اصلی = ۴۲۲.
- `subscription.activated/renewed` و `payment.refunded` هم خودکار به همین دفتر می‌روند (`txType=SUBSCRIPTION`، `itemCode=planCode`).

پاسخ: `detail = { transactionId, occurrence, commissionStatus, commission }`. `commissionStatus`: `CREDITED` | `NO_RULE` (قانونی تعریف نشده) | `NOT_ATTRIBUTED` (مشتری بدون نماینده) | `AGENT_INACTIVE` | `REVERSED` | `ZERO`.

```json
{ "eventId": "evt-9001", "type": "transaction.recorded",
  "data": { "transactionId": "INV-2026-1187", "externalCustomerId": "cust-42", "txType": "SUBSCRIPTION",
            "itemCode": "crm", "itemName": "اشتراک CRM", "grossAmount": 10000000, "discountAmount": 2000000,
            "taxAmount": 720000, "currency": "IRT", "paidAt": "2026-11-09T08:00:00Z", "periodEnd": "2027-11-09T08:00:00Z" } }
```

کلید ناشناخته در هر سطح = ۴۰۰. مبلغ‌ها عدد صحیح و به «واحد پایه‌ی تننت» تبدیل می‌شوند (تبدیل ناصحیح رد می‌شود، گرد نمی‌شود).

## پاسخ‌ها
۴۰۰ `VALIDATION_ERROR` · ۴۰۱ `UNAUTHORIZED` (کلید/امضا/زمان) · ۴۰۳ `PRODUCT_INACTIVE|MODULE_DISABLED` · ۴۰۹ `CONFLICT|CUSTOMER_ALREADY_ATTRIBUTED` ·
۴۲۲ `UNKNOWN_REFERRAL_CODE|REFERRAL_CODE_INACTIVE|SELF_REFERRAL|REFUND_EXCEEDS_PAYMENT|PAYMENT_CUSTOMER_MISMATCH|ORIGINAL_TRANSACTION_NOT_FOUND|INVALID_REFUND` · ۴۲۹ `RATE_LIMITED` (`retryAfterSec`).
پرداختِ مشتریِ بدون نماینده خطا نیست: در دفتر مرکزی ثبت و با `commissionStatus=NOT_ATTRIBUTED` پذیرفته می‌شود. هر ورودی (حتی ردشده) در لاگ ممیزی ثبت می‌شود.

## نمونه
`curl`/Node در صفحه‌ی «تنظیمات نمایندگی ← مستندات» آماده‌ی کپی است.
