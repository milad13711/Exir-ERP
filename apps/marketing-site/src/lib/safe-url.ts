/**
 * href امن برای لینک‌هایی که مقدارشان از کاربر/فرم عمومی می‌آید. فقط http/https (و در صورت نیاز data: غیرفعال)
 * عبور می‌کند؛ `javascript:`، `vbscript:`، `data:text/html` و... به "#" تبدیل می‌شوند (defense-in-depth کنار اعتبارسنجی بک‌اند).
 */
const ACTIVE_DATA = /^data:(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/javascript|text\/xml|application\/xml)/i;

export function safeHref(url: string | null | undefined, opts: { allowData?: boolean } = {}): string {
  const v = (url ?? "").trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (opts.allowData && /^data:[\w.+-]+\/[\w.+-]+;base64,/i.test(v) && !ACTIVE_DATA.test(v)) return v;
  return "#";
}
