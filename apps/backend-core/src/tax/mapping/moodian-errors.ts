/**
 * کدهای خطای سامانه مودیان (RC_TICS.IS_V01 جدول‌های ۱۳ و ۱۴) → پیام فارسی.
 * بخشی از «نگاشت نسخه‌دار» است (moodian-field-map.ts)؛ سازمان ممکن است کدها را تغییر داده باشد.
 */

/** جدول ۱۳: خطاهای لایه‌ی انتقال (کد → شناسه‌ی انگلیسی سرور + پیام فارسی). */
export const TRANSPORT_ERRORS: Record<string, { key: string; fa: string; transient: boolean }> = {
  '5000': { key: 'internal.server.error', fa: 'خطای داخلی سرور سامانه مودیان', transient: true },
  '1500': { key: 'bad.request', fa: 'بسته‌ی ارسالی مشکل دارد (خطای عمومی)', transient: false },
  '5002': { key: 'un.authorized', fa: 'دسترسی ارسال این درخواست وجود ندارد', transient: false },
  '5003': { key: 'uid.format.is.not.valid', fa: 'قالب شناسه‌ی یکتای ارسال (uid) نادرست است', transient: false },
  '5004': { key: 'invalid.json.structure', fa: 'ساختار JSON درخواست نادرست است', transient: false },
  '5005': { key: 'duplicate.request.uid', fa: 'uid تکراری است؛ این بسته قبلاً ارسال شده', transient: false },
  '5006': { key: 'packet.size.is.too.large', fa: 'تعداد بسته‌ها بیش از حد مجاز است', transient: false },
  '5007': { key: 'not.supported.packet-type', fa: 'نوع بسته پشتیبانی نمی‌شود', transient: false },
  '5008': { key: 'encryption.key.id.not.valid', fa: 'شناسه‌ی کلید رمزنگاری سازمان نامعتبر است؛ کلید سرور را دوباره دریافت کنید', transient: false },
  '5009': { key: 'not.match.packet-type.with.request', fa: 'نوع بسته با نوع درخواست هم‌خوان نیست', transient: false },
  '5010': { key: 'request.time.has.passed', fa: 'زمان درخواست گذشته است؛ ساعت سرور را بررسی کنید', transient: true },
  '5011': { key: 'duplicate.request.trace.id', fa: 'شناسه‌ی پیگیری درخواست تکراری است', transient: true },
  '5012': { key: 'fiscal.id.not.found', fa: 'شناسه‌ی یکتای حافظه مالیاتی یافت نشد', transient: false },
  '5013': { key: 'invalid.packet.signature', fa: 'امضای درخواست معتبر نیست (کلید/گواهی یا روش نرمال‌سازی را بررسی کنید)', transient: false },
  '5014': { key: 'invalid.format', fa: 'قالب ساختار نادرست است', transient: false },
  '5015': { key: 'invalid.token', fa: 'توکن نامعتبر یا منقضی است', transient: true },
};

/** جدول ۱۴: خطاهای لایه‌ی محتوا — ردیف، متن انگلیسی سرور (برای تطبیق متنی) و پیام فارسی. */
export const CONTENT_ERRORS: Array<{ row: number; en: string; fa: string }> = [
  { row: 1, en: 'Seller economic code is empty', fa: 'شماره اقتصادی فروشنده ثبت نشده است' },
  { row: 2, en: 'Buyer economic code is empty', fa: 'شماره اقتصادی خریدار (در صورتحساب نوع اول) ثبت نشده است' },
  { row: 3, en: 'Invoice date time is empty', fa: 'تاریخ و زمان صدور ثبت نشده است' },
  { row: 4, en: 'Payment date time is empty', fa: 'تاریخ و زمان پرداخت (صورتحساب نوع سوم) ثبت نشده است' },
  { row: 5, en: 'Invoice number is empty', fa: 'سریال صورتحساب ثبت نشده است' },
  { row: 6, en: 'Invoice type is empty', fa: 'نوع صورتحساب ثبت نشده است' },
  { row: 7, en: 'Invoice pattern is empty', fa: 'الگوی صورتحساب ثبت نشده است' },
  { row: 8, en: 'Invoice subject is empty', fa: 'موضوع صورتحساب ثبت نشده است' },
  { row: 9, en: 'Reference tax-id is empty', fa: 'شماره مالیاتی صورتحساب مرجع برای اصلاحی/ابطالی/برگشت ثبت نشده است' },
  { row: 10, en: 'Service-stuff-id is empty', fa: 'شناسه کالا/خدمت ثبت نشده است' },
  { row: 11, en: 'Fee is empty', fa: 'مبلغ واحد ثبت نشده است' },
  { row: 12, en: 'Currency-fee is empty', fa: 'میزان ارز ثبت نشده است' },
  { row: 13, en: 'Vat rate is empty', fa: 'نرخ مالیات بر ارزش افزوده ثبت نشده است' },
  { row: 14, en: 'Amount is empty', fa: 'تعداد/مقدار ثبت نشده است' },
  { row: 15, en: 'Contract registration number is empty', fa: 'شناسه یکتای ثبت قرارداد فروشنده ثبت نشده است' },
  { row: 16, en: 'Seller customs license is empty', fa: 'شماره پروانه گمرکی فروشنده ثبت نشده است' },
  { row: 17, en: 'Seller customs code is empty', fa: 'کد گمرک محل اظهار ثبت نشده است' },
  { row: 18, en: 'Buyer type is empty', fa: 'نوع شخص خریدار ثبت نشده است' },
  { row: 19, en: 'Flight type is empty', fa: 'نوع پرواز ثبت نشده است' },
  { row: 20, en: 'Currency type is empty', fa: 'نوع ارز ثبت نشده است' },
  { row: 21, en: 'Exchange rate is empty', fa: 'نرخ برابری ارز با ریال ثبت نشده است' },
  { row: 22, en: 'Billing identification is empty', fa: 'شماره اشتراک/شناسه قبض ثبت نشده است' },
  { row: 23, en: 'Pre-discount amount is empty', fa: 'مبلغ قبل از تخفیف ثبت نشده است' },
  { row: 24, en: 'Discount amount is empty', fa: 'مبلغ تخفیف ثبت نشده است' },
  { row: 25, en: 'After discount amount is empty', fa: 'مبلغ بعد از تخفیف ثبت نشده است' },
  { row: 26, en: 'Vat amount is empty', fa: 'مبلغ مالیات بر ارزش افزوده ثبت نشده است' },
  { row: 27, en: 'Vat of payment is empty', fa: 'سهم مالیات بر ارزش افزوده از پرداخت ثبت نشده است' },
  { row: 28, en: 'Settlement method is empty', fa: 'روش تسویه ثبت نشده است' },
  { row: 29, en: 'Total service-stuff amount is empty', fa: 'مبلغ کل کالا/خدمت ثبت نشده است' },
  { row: 30, en: 'Total Pre-discount amount is empty', fa: 'مجموع مبلغ قبل از کسر تخفیف ثبت نشده است' },
  { row: 31, en: 'Total Discount amount is empty', fa: 'مجموع تخفیفات ثبت نشده است' },
  { row: 32, en: 'Total After discount amount is empty', fa: 'مجموع مبلغ پس از کسر تخفیف ثبت نشده است' },
  { row: 33, en: 'Total Vat amount is empty', fa: 'مجموع مالیات بر ارزش افزوده ثبت نشده است' },
  { row: 34, en: 'Total other-duty amount is empty', fa: 'مجموع سایر مالیات، عوارض و وجوه قانونی ثبت نشده است' },
  { row: 35, en: 'Total bill is empty', fa: 'مجموع صورتحساب ثبت نشده است' },
  { row: 36, en: 'Total Vat of payment is empty', fa: 'مجموع سهم مالیات بر ارزش افزوده از پرداخت ثبت نشده است' },
  { row: 37, en: 'JSON file is invalid', fa: 'قالب JSON صورتحساب نامعتبر است' },
  { row: 38, en: 'Invalid tax-id', fa: 'شماره منحصر به فرد مالیاتی (taxid) نامعتبر است' },
  { row: 39, en: 'Invalid invoice number', fa: 'سریال صورتحساب نامعتبر است' },
  { row: 40, en: 'Invalid reference tax-id', fa: 'شماره منحصر به فرد مالیاتی صورتحساب مرجع نامعتبر است' },
  { row: 41, en: 'Invalid invoice date time', fa: 'تاریخ و زمان صدور نامعتبر است (مهلت صدور اصلاحی/ابطالی/برگشت یا زمان آینده)' },
  { row: 43, en: 'Invalid invoice type', fa: 'نوع صورتحساب نامعتبر است' },
  { row: 44, en: 'Invalid invoice pattern', fa: 'الگوی صورتحساب نامعتبر است' },
  { row: 45, en: 'Invalid seller economic code', fa: 'شماره اقتصادی فروشنده نامعتبر است' },
  { row: 46, en: 'Invalid buyer economic code', fa: 'شماره اقتصادی خریدار نامعتبر است' },
  { row: 47, en: 'Essential field is empty', fa: 'فیلد ضروری مرتبط با الگوی صورتحساب تکمیل نشده است' },
  { row: 48, en: 'Invalid Contract registration number', fa: 'شناسه یکتای ثبت قرارداد فروشنده نامعتبر است' },
  { row: 49, en: 'Invalid Service-stuff-id', fa: 'شناسه کالا/خدمت نامعتبر است' },
  { row: 50, en: 'Invalid measurement unit', fa: 'واحد اندازه‌گیری نامعتبر است' },
  { row: 51, en: 'Invalid currency type', fa: 'نوع ارز نامعتبر است' },
  { row: 52, en: 'Error in digit ranges', fa: 'خطا در محاسبه‌ی محدوده‌ی مجاز ارقام (جمع‌ها با اقلام نمی‌خواند)' },
  { row: 53, en: 'Invalid Settlement method', fa: 'روش تسویه نامعتبر است' },
  { row: 55, en: 'Invalid invoice subject', fa: 'موضوع صورتحساب نامعتبر است' },
  { row: 56, en: 'Invalid Data type', fa: 'نوع مقدار وارد شده با نوع فیلد مغایرت دارد' },
  { row: 57, en: 'Duplicate tax id', fa: 'شماره منحصر به فرد مالیاتی تکراری است' },
  { row: 58, en: 'Mismatch buyer info', fa: 'نوع شخص خریدار با اطلاعات او در سامانه مغایرت دارد' },
  { row: 59, en: 'Mismatch seller economic code and fiscal Id', fa: 'شماره اقتصادی فروشنده با شناسه حافظه مالیاتی مغایرت دارد' },
  { row: 60, en: 'Tax id and fiscal Id does not match', fa: 'شناسه حافظه مالیاتی با بخش مربوط در شماره منحصر به فرد مالیاتی مطابقت ندارد' },
  { row: 61, en: 'Seller Economic code and fiscal Id does not match', fa: 'شماره اقتصادی فروشنده با شناسه حافظه مالیاتی در taxid مطابقت ندارد' },
];

export type MappedTaxError = { code: string | null; detail: string | null; fa: string; transient: boolean };

/** خطای خام (کد یا متن سرور) را به پیام فارسی تبدیل می‌کند. متن ناشناخته عیناً نگه داشته می‌شود. */
export function mapMoodianError(code: string | number | null | undefined, detail?: string | null): MappedTaxError {
  const c = code === null || code === undefined || code === '' ? null : String(code);
  if (c && TRANSPORT_ERRORS[c]) {
    const t = TRANSPORT_ERRORS[c];
    return { code: c, detail: detail ?? t.key, fa: t.fa, transient: t.transient };
  }
  const hay = `${detail ?? ''} ${c ?? ''}`.toLowerCase();
  // «Invalid invoice date time» دو ردیف دارد (۴۱ و ۴۲) — اولین را برمی‌گردانیم؛ متن تکراری مشکلی نیست.
  const found = CONTENT_ERRORS.find((e) => hay.includes(e.en.toLowerCase()));
  if (found) return { code: c, detail: detail ?? found.en, fa: found.fa, transient: false };
  const byRow = c && /^\d{1,2}$/.test(c) ? CONTENT_ERRORS.find((e) => e.row === Number(c)) : undefined;
  if (byRow) return { code: c, detail: detail ?? byRow.en, fa: byRow.fa, transient: false };
  return { code: c, detail: detail ?? null, fa: detail ? `خطای سامانه مودیان: ${detail}` : 'خطای نامشخص از سامانه مودیان', transient: false };
}
