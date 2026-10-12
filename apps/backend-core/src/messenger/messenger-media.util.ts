/** قواعد رسانه‌ی پیام‌رسان: سقف حجم، فهرست مجاز MIME، تشخیص نوع از بایت‌های ابتدایی، نام فایل امن، انقضای ۲۴ ساعته. */

export const MEDIA_TTL_MS = 24 * 3_600_000;

export const MEDIA_LIMITS = {
  IMAGE: 2 * 1024 * 1024,
  FILE: 10 * 1024 * 1024,
  VIDEO: 18 * 1024 * 1024,
} as const;
/** بزرگ‌ترین بدنه‌ی قابل‌پذیرش (سقف ویدئو). */
export const MEDIA_MAX_BYTES = MEDIA_LIMITS.VIDEO;

/** سهمیه‌ی روزانه‌ی هر کاربر (۲۴ ساعت اخیر). */
export const MEDIA_DAILY_QUOTA = { count: 60, bytes: 300 * 1024 * 1024 } as const;

/** پیام صوتی (audio/*) سقف ویدئو را دارد (۱۸ مگابایت)، هرچند نوعش FILE ثبت می‌شود. */
export function limitFor(kind: MediaKind, mime: string): number {
  return mime.startsWith('audio/') ? MEDIA_LIMITS.VIDEO : MEDIA_LIMITS[kind];
}

export type MediaKind = 'IMAGE' | 'FILE' | 'VIDEO';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const FILE_MIMES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'audio/mpeg',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
];

export function kindForMime(mime: string): MediaKind | null {
  if (IMAGE_MIMES.includes(mime)) return 'IMAGE';
  if (VIDEO_MIMES.includes(mime)) return 'VIDEO';
  if (FILE_MIMES.includes(mime)) return 'FILE';
  return null;
}

export function normalizeMime(raw: string | undefined): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** فایل اجرایی/اسکریپت را در هر MIME ردّ می‌کند (MZ، ELF، Mach-O، شبانگ). */
export function looksExecutable(buf: Buffer): boolean {
  return (
    startsWith(buf, [0x4d, 0x5a]) ||
    startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(buf, [0xca, 0xfe, 0xba, 0xbe]) ||
    startsWith(buf, [0x23, 0x21])
  );
}

/** آیا بایت‌های ابتدایی با MIME ادعاشده می‌خواند؟ برای MIMEهای بدون امضای ساده (متن، doc قدیمی) فقط ممنوعیت اجرایی. */
export function magicMatches(mime: string, buf: Buffer): boolean {
  if (buf.length === 0) return false;
  if (looksExecutable(buf)) return false;
  switch (mime) {
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    case 'video/mp4':
    case 'video/quicktime':
      return startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4) || startsWith(buf, [0x6d, 0x6f, 0x6f, 0x76], 4) || startsWith(buf, [0x66, 0x72, 0x65, 0x65], 4);
    case 'video/webm':
    case 'audio/webm':
      return startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'audio/ogg':
      return startsWith(buf, [0x4f, 0x67, 0x67, 0x53]);
    case 'audio/mp4':
      return startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4);
    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return startsWith(buf, [0x50, 0x4b]);
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
    default:
      return true;
  }
}

/** نام فایل امن: بدون مسیر/کنترل/کاراکتر خطرناک، حداکثر ۱۰۰ نویسه با حفظ پسوند. */
export function sanitizeFileName(raw: string | undefined, fallback = 'file'): string {
  // eslint-disable-next-line no-control-regex
  let name = (raw ?? '').replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f\u007f<>:"|?*;]+/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  if (!name) return fallback;
  if (name.length > 100) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 100 - ext.length) + ext;
  }
  return name;
}

export function mediaExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + MEDIA_TTL_MS);
}

export type MediaLike = { expiresAt: Date; purgedAt: Date | null };

export function isMediaExpired(m: MediaLike, now = new Date()): boolean {
  return m.purgedAt !== null || m.expiresAt.getTime() <= now.getTime();
}

/** انتخاب رسانه‌های قابل پاکسازی (منقضی و هنوز پاکسازی‌نشده). */
export function selectExpiredMedia<T extends MediaLike>(rows: T[], now = new Date()): T[] {
  return rows.filter((m) => m.purgedAt === null && m.expiresAt.getTime() <= now.getTime());
}

/** ساعت باقی‌مانده تا حذف (رو به بالا)؛ ۰ یعنی منقضی. */
export function hoursUntilExpiry(m: MediaLike, now = new Date()): number {
  if (isMediaExpired(m, now)) return 0;
  return Math.max(1, Math.ceil((m.expiresAt.getTime() - now.getTime()) / 3_600_000));
}
