import { BadRequestException } from '@nestjs/common';

/**
 * محافظ zip-bomb برای فایل‌های xlsx (که zip هستند) پیش از باز کردن: فقط فهرست مرکزی (central directory) خوانده می‌شود،
 * هیچ داده‌ای decompress نمی‌شود. ExcelJS بدون این بررسی یک xlsx ۲۰MB را که چند گیگابایت باز می‌شود کامل در حافظه می‌ریخت.
 */
/** 400 به کلاینت (نه 500) — فایل مشکوک خطای کاربر است. */
export class UnsafeArchiveError extends BadRequestException {}

export type ZipLimits = { maxEntries: number; maxTotalUncompressed: number; maxEntryUncompressed: number; maxRatio: number };

export const XLSX_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxTotalUncompressed: 150 * 1024 * 1024,
  maxEntryUncompressed: 100 * 1024 * 1024,
  maxRatio: 300,
};

export function assertSafeZip(buf: Buffer, limits: ZipLimits = XLSX_LIMITS): void {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new UnsafeArchiveError('فایل Excel معتبر نیست');
  // End Of Central Directory: امضای 0x06054b50 در ۶۵۵۵۷ بایت آخر
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UnsafeArchiveError('فایل Excel معتبر نیست');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total > limits.maxEntries) throw new UnsafeArchiveError('فایل Excel تعداد اجزای غیرعادی دارد');
  if (total === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) throw new UnsafeArchiveError('فایل Excel معتبر نیست');

  let off = cdOffset;
  let sum = 0;
  for (let n = 0; n < total; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new UnsafeArchiveError('فایل Excel معتبر نیست');
    const comp = buf.readUInt32LE(off + 20);
    const uncomp = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    if (uncomp === 0xffffffff || comp === 0xffffffff) throw new UnsafeArchiveError('فایل Excel بیش از حد بزرگ است');
    if (uncomp > limits.maxEntryUncompressed) throw new UnsafeArchiveError('فایل Excel پس از باز شدن بیش از حد بزرگ است');
    if (uncomp > 1024 * 1024 && uncomp / Math.max(comp, 1) > limits.maxRatio) throw new UnsafeArchiveError('فایل Excel فشرده‌سازی مشکوک دارد');
    sum += uncomp;
    if (sum > limits.maxTotalUncompressed) throw new UnsafeArchiveError('فایل Excel پس از باز شدن بیش از حد بزرگ است');
    off += 46 + nameLen + extraLen + commentLen;
  }
}
