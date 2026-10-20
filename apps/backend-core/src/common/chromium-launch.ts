import type { LaunchOptions } from 'puppeteer';

/**
 * گزینه‌های راه‌اندازی مشترک Chromium برای تولید PDF.
 *  - env حداقلی: Chromium هیچ‌یک از اسرار پردازش (کلید دیتابیس، JWT، APP_SECRETS_KEY …) را به ارث نمی‌برد.
 *  - فلگ‌ها: بدون GPU/افزونه، بدون /dev/shm، JIT خاموش (--jitless) تا سطح حمله‌ی موتور JS کم شود.
 *  - sandbox: در تصویر فعلی (کاربر غیرروت `exir` روی Alpine، Docker با seccomp پیش‌فرض) user-namespace در دسترس نیست
 *    و Chromium با sandbox بالا نمی‌آید؛ پس پیش‌فرض --no-sandbox است. روی میزبانی که userns دارد با CHROMIUM_SANDBOX=1
 *    روشن می‌شود (docs/security/correspondence-pdf-hardening.md). جبران: JS خاموش، قطع هر درخواست غیر data:،
 *    context تازه برای هر رندر، env حداقلی و بازیافت دوره‌ای مرورگر.
 */
export function minimalChromiumEnv(src: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'LANG'] as const) {
    const v = src[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  out.LANG ??= 'C.UTF-8';
  return out;
}

export function chromiumArgs(src: NodeJS.ProcessEnv = process.env): string[] {
  const args = ['--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--js-flags=--jitless'];
  if (src.CHROMIUM_SANDBOX !== '1') args.push('--no-sandbox', '--disable-setuid-sandbox');
  return args;
}

export function chromiumLaunchOptions(src: NodeJS.ProcessEnv = process.env): LaunchOptions {
  return {
    headless: true,
    executablePath: src.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: chromiumArgs(src),
    env: minimalChromiumEnv(src),
  };
}
