import type { Page } from 'puppeteer';

/**
 * سخت‌سازی صفحه‌ی Chromium بی‌سر برای تولید PDF/تصویر از HTML که با داده‌ی کاربر ساخته می‌شود.
 *
 * تهدید: اگر داده‌ی کاربر (نام مشتری، توضیح کالا، ...) به HTML تزریق شود، Chromium می‌تواند
 *  - به آدرس داخلی/متادیتای ابری درخواست بزند (SSRF)،
 *  - فایل محلی `file:///etc/passwd` را در iframe/img بخواند،
 *  - جاوااسکریپت اجرا کند.
 * همه‌ی قالب‌های ما فونت و تصویر را به‌صورت data: URI جاسازی می‌کنند، پس فقط data:/about:/blob: مجاز است
 * و بقیه‌ی درخواست‌ها (http/https/file/ftp/ws) قطع می‌شود. جاوااسکریپت هم خاموش است (قالب‌ها اسکریپت ندارند).
 */
export function isAllowedPuppeteerUrl(url: string): boolean {
  return url.startsWith('data:') || url === 'about:blank' || url.startsWith('blob:');
}

export async function hardenPage(page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (isAllowedPuppeteerUrl(req.url())) void req.continue();
    else void req.abort('blockedbyclient');
  });
}

const SAFE_IMG = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * مقدار `src` تصویر در قالب‌های PDF: فقط data-URI تصویر base64 (بدون نقل‌قول/براکت) عبور می‌کند؛
 * هر چیز دیگر (URL خارجی، `x" onerror=...`) رشته‌ی خالی می‌شود تا نه تزریق ویژگی ممکن باشد و نه SSRF.
 */
export function safeImgSrc(value: unknown): string {
  return typeof value === 'string' && SAFE_IMG.test(value.trim()) ? value.trim() : '';
}
