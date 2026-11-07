/**
 * صفحه‌های HTML سروری فروشگاه کتاب (بازگشت از درگاه، دریافت نسخه‌ی الکترونیک) —
 * بدون JS تا روی شبکه‌هایی که چانک‌های JS را فیلتر می‌کنند هم کار کنند.
 */

const BRAND_PAGE_HEAD = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
__EXTRA_HEAD__<style>
  body { font-family: Tahoma, sans-serif; background: #f6f2e9; color: #1a362e; display: flex;
    align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { background: #fff; border: 1px solid #e4e9e6; border-radius: 20px; padding: 40px 32px;
    max-width: 420px; text-align: center; box-shadow: 0 8px 30px -12px rgba(26,54,46,.15); }
  h1 { font-size: 18px; margin: 16px 0 8px; }
  p { font-size: 13.5px; color: #62766f; line-height: 1.9; margin: 0 0 20px; }
  a.btn { display: inline-block; background: #254c41; color: #fff; text-decoration: none;
    font-weight: bold; font-size: 13.5px; padding: 12px 28px; border-radius: 12px; }
  .icon { font-size: 40px; }
  .files { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; }
  .files a.btn { display: block; }
  .files small { display: block; font-weight: normal; font-size: 11.5px; opacity: .85; margin-top: 4px; }
  a.btn.alt { background: #fff; color: #254c41; border: 1.5px solid #254c41; }
  .code { direction: ltr; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 15px; letter-spacing: 1px;
    background: #f6f2e9; border: 1px dashed #c9a24a; border-radius: 10px; padding: 10px 12px; margin: 0 0 6px; }
  .muted { font-size: 12px; color: #8a9a94; margin: 0 0 16px; }
  .links { font-size: 12.5px; margin-top: 4px; }
  .links a { color: #254c41; }
</style></head><body><div class="card">`;
const BRAND_PAGE_TAIL = `</div></body></html>`;

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function brandPage(body: string, opts: { refreshSeconds?: number } = {}): string {
  const extra = opts.refreshSeconds ? `<meta http-equiv="refresh" content="${opts.refreshSeconds}">\n` : '';
  return BRAND_PAGE_HEAD.replace('__EXTRA_HEAD__', extra) + body + BRAND_PAGE_TAIL;
}

export function siteUrl(): string {
  return (process.env.FUNNELKING_PUBLIC_URL ?? '').replace(/\/$/, '');
}

export interface EbookBlockInput {
  licenseCode: string | null;
  pdfUrl: string;
  epubUrl: string;
  ready: boolean;
  failed: boolean;
}

/** دو دکمه‌ی دانلود + کد مجوز + راهنمای کوتاه؛ هم در بازگشت از درگاه و هم در صفحه‌ی دریافت. */
export function ebookDeliveryBlock(b: EbookBlockInput): string {
  const site = siteUrl();
  const state = b.ready
    ? ''
    : b.failed
      ? '<p class="muted">آماده‌سازی نسخه‌ی شما با خطا روبه‌رو شد؛ با زدن یکی از دکمه‌ها دوباره تلاش می‌شود. اگر باز هم نشد با پشتیبانی تماس بگیرید.</p>'
      : '<p class="muted">نسخه‌ی اختصاصی شما (با نام خودتان) در حال آماده‌سازی است؛ معمولاً کمتر از یک دقیقه. این صفحه خودکار به‌روز می‌شود.</p>';
  return `${state}<div class="files">
  <a class="btn" href="${esc(b.pdfUrl)}">دانلود PDF<small>صفحه‌به‌صفحه، مثل کتاب چاپی — لپ‌تاپ و تبلت</small></a>
  <a class="btn alt" href="${esc(b.epubUrl)}">دانلود EPUB<small>متن روان برای موبایل و اپ‌های کتاب‌خوان</small></a>
</div>${
    b.licenseCode ? `<p class="muted" style="margin:0 0 6px">کد مجوز نسخه‌ی شما</p><div class="code">${esc(b.licenseCode)}</div>` : ''
  }<p class="muted">این نسخه به نام شما صادر شده و فقط برای استفاده‌ی شخصی است. لینک‌ها موقت‌اند؛ پیامک حاوی لینک هم برایتان ارسال شد.</p>${
    site ? `<div class="links"><a href="${esc(site)}/library">دریافت دوباره در آینده (کتابخانه‌ی من)</a></div>` : ''
  }`;
}
