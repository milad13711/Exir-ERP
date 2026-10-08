/**
 * JSON-LD امن برای `<script type="application/ld+json" dangerouslySetInnerHTML>`.
 * JSON.stringify به‌تنهایی `</script>` را escape نمی‌کند؛ اگر نام محصول/توضیح (داده‌ی تننت یا کاربر) شامل
 * `</script><script>...` باشد، XSS ذخیره‌شده روی صفحه‌ی عمومی می‌شد. نویسه‌های < > & و جداکننده‌های خط یونیکد
 * به \\uXXXX تبدیل می‌شوند (در JSON معتبر و معادل‌اند، پس خروجی برای موتورهای جست‌وجو تغییری نمی‌کند).
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}
