import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * سقف و فهرست مجاز برای فایل‌هایی که به‌صورت data-URI در Postgres ذخیره می‌شوند.
 * طول‌ها «تعداد نویسه‌ی کل رشته‌ی data-URI» است (base64 ≈ ۱٫۳۳ برابر حجم خام).
 * مرورگر عکس‌ها را قبل از ارسال کوچک می‌کند (هدف ≤ ۱٫۵ مگابایت)؛ این سقف‌ها خط دفاعیِ سمت سرور است.
 */
export const UPLOAD_CAPS = {
  /** تصویر عمومی (کاور، عکس محصول، کارت ملی، عکس چک…): ≈ ۳ مگابایت خام. */
  imageChars: 4_000_000,
  /** تصویر کوچک (آواتار، لوگو، مهر/امضا، امضای دست‌نویس): ≈ ۷۵۰ کیلوبایت خام. */
  smallImageChars: 1_000_000,
  /** فایل غیرتصویری: ۱۰ مگابایت خام. */
  fileChars: 13_400_000,
  /** ویدئو: ۵۰ مگابایت خام. (سقف بدنه‌ی JSON در main.ts فعلاً ۲۰ مگابایت است؛ ویدئو از مسیر مخصوص خودش می‌آید.) */
  videoChars: 67_000_000,
} as const;

/** گونه‌هایی که مرورگر می‌تواند به‌عنوان سند فعال (اسکریپت‌دار) باز کند — هیچ‌جا پذیرفته نمی‌شوند (XSS ذخیره‌شده). */
export const ACTIVE_CONTENT_MIME =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/(?:x-)?javascript|application\/(?:x-)?javascript|text\/xml|application\/xml|text\/xsl|application\/x-shockwave-flash)$/i;

const IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif|avif)$/i;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime|x-matroska|3gpp)$/i;
const FILE_MIME_ALLOW = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/octet-stream',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);
const AUDIO_MIME = /^audio\/(mpeg|mp3|mp4|ogg|webm|wav|x-wav|aac|x-m4a|m4a)$/i;

const DATA_URI = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w=.+-]+)*;base64,/;

export type UploadKind = 'image' | 'smallImage' | 'file';

function mb(chars: number): string {
  return String(Math.round(((chars * 3) / 4 / 1024 / 1024) * 10) / 10).replace('.', '٫');
}

/** `null` یعنی معتبر؛ وگرنه پیام فارسی. فقط خود data-URI را بررسی می‌کند (لینک http در تابع جداست). */
export function checkDataUri(value: string, kind: UploadKind): string | null {
  const m = DATA_URI.exec(value);
  if (!m) return 'فرمت فایل نامعتبر است';
  const mime = m[1].toLowerCase();
  if (ACTIVE_CONTENT_MIME.test(mime)) return 'این نوع فایل مجاز نیست';
  if (kind === 'file') {
    if (IMAGE_MIME.test(mime)) {
      if (value.length > UPLOAD_CAPS.imageChars) return `حجم تصویر زیاد است (حداکثر ${mb(UPLOAD_CAPS.imageChars)} مگابایت پس از کم‌حجم‌سازی)`;
      return null;
    }
    if (VIDEO_MIME.test(mime)) return value.length > UPLOAD_CAPS.videoChars ? 'حجم ویدئو زیاد است (حداکثر ۵۰ مگابایت)' : null;
    if (FILE_MIME_ALLOW.has(mime) || AUDIO_MIME.test(mime)) {
      return value.length > UPLOAD_CAPS.fileChars ? 'حجم فایل زیاد است (حداکثر ۱۰ مگابایت)' : null;
    }
    return 'نوع فایل پشتیبانی نمی‌شود';
  }
  if (!IMAGE_MIME.test(mime) && !/^image\/png$/i.test(mime)) return 'فقط فایل تصویری (JPG، PNG، WebP) پذیرفته می‌شود';
  const cap = kind === 'smallImage' ? UPLOAD_CAPS.smallImageChars : UPLOAD_CAPS.imageChars;
  if (value.length > cap) return `حجم تصویر زیاد است (حداکثر ${mb(cap)} مگابایت). تصویر کوچک‌تری انتخاب کنید`;
  return null;
}

/**
 * فیلد DTO که data-URI آپلودشده را می‌پذیرد (و رشته‌ی خالی/لینک http(s) را هم می‌گذراند).
 * کنار `@IsOptional()` استفاده شود؛ `null` را `@ValidateIf` رد می‌کند.
 */
export function IsUploadDataUri(kind: UploadKind, options?: ValidationOptions & { allowHttp?: boolean; each?: boolean }) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUploadDataUri',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true;
          if (typeof value !== 'string') return false;
          if (value.startsWith('data:')) return checkDataUri(value, kind) === null;
          return !!options?.allowHttp && /^https?:\/\/\S+$/.test(value) && value.length <= 2000;
        },
        defaultMessage(args) {
          const v = args?.value;
          if (typeof v === 'string' && v.startsWith('data:')) return checkDataUri(v, kind) ?? 'فایل نامعتبر است';
          return 'فایل نامعتبر است';
        },
      },
    });
  };
}
