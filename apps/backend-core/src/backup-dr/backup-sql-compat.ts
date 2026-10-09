import { Transform, type TransformCallback } from 'node:stream';

/**
 * pg_dump (client v18 در کانتینر) در سرآیند خروجی خطوطی می‌نویسد که سرور Postgres 16 نمی‌شناسد
 * (`SET transaction_timeout = 0;` — پارامتر نسخه‌ی ۱۷+). بدون حذف آن، psql روی سرور با
 * `unrecognized configuration parameter` متوقف می‌شود و بازیابی شکست می‌خورد (آزمون بازیابی همین را گرفت).
 *
 * فقط **سرآیند** (۶۴ کیلوبایت اول) پالایش می‌شود: آن‌جا فقط دستورهای SET/تنظیمات هستند و داده‌ی جدول‌ها
 * هرگز دست نمی‌خورد. از همین Transform هم هنگام ساخت dump (تا فایل‌های جدید به هر سرور بخورند) و هم
 * هنگام بازیابی (برای فایل‌های قدیمی‌تر) استفاده می‌شود.
 */
const HEADER_BYTES = 64 * 1024;
const DROP = [/^SET transaction_timeout\s*=/];

export function stripIncompatibleHeaderLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !DROP.some((re) => re.test(line)))
    .join('\n');
}

export class SqlCompatTransform extends Transform {
  private head: Buffer[] = [];
  private headLen = 0;
  private done = false;

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.done) return cb(null, chunk);
    this.head.push(chunk);
    this.headLen += chunk.length;
    if (this.headLen < HEADER_BYTES) return cb();
    this.flushHead(true);
    cb();
  }

  _flush(cb: TransformCallback): void {
    if (!this.done) this.flushHead(false);
    cb();
  }

  private flushHead(keepTail: boolean): void {
    this.done = true;
    const all = Buffer.concat(this.head);
    this.head = [];
    // آخرین خطِ ناقص (اگر مرز بافر وسط یک خط است) بدون تغییر عبور می‌کند.
    const cut = keepTail ? all.lastIndexOf(0x0a) + 1 : all.length;
    const headText = all.subarray(0, cut).toString('utf8');
    this.push(Buffer.from(stripIncompatibleHeaderLines(headText), 'utf8'));
    if (cut < all.length) this.push(all.subarray(cut));
  }
}
