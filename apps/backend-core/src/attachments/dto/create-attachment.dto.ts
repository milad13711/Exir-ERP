import { registerDecorator, ValidationOptions } from 'class-validator';
import { IsString, MaxLength, MinLength } from 'class-validator';

// یک فایل واقعی که کاربر از دستگاهش انتخاب کرده، به‌صورت data URI (تا حدود ۱۱ مگابایت
// خام؛ base64 حدود ۳۳٪ حجم را بیشتر می‌کند) یا یک لینک خارجی معمولی (گوگل‌درایو و…).
// محدودیت اندازه‌ی بدنه‌ی JSON در main.ts روی ۲۰ مگابایت است — این کران با فاصله زیر آن می‌ماند.
const MAX_DATA_URI_LENGTH = 15_000_000;
const DATA_URI_PATTERN = /^data:[\w.+-]+\/[\w.+-]+;base64,/;
// انواعی که مرورگر می‌تواند به‌عنوان سند فعال (اسکریپت‌دار) باز کند — به‌عنوان «پیوست» پذیرفته نمی‌شوند (XSS ذخیره‌شده).
const ACTIVE_CONTENT_MIME = /^data:(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/(?:x-)?javascript|application\/(?:x-)?javascript|text\/xml|application\/xml|text\/xsl|application\/x-shockwave-flash)[;,]/i;

/** یا یک data URI معتبر (فایل واقعی آپلودشده)، یا یک URL خارجی معمولی (http/https). */
function IsFileUrlOrDataUri(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isFileUrlOrDataUri',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || value.length === 0) return false;
          if (DATA_URI_PATTERN.test(value)) return value.length <= MAX_DATA_URI_LENGTH && !ACTIVE_CONTENT_MIME.test(value);
          return /^https?:\/\/\S+$/.test(value);
        },
        defaultMessage() {
          return 'فایل انتخاب‌شده خیلی بزرگ است یا لینک نامعتبر است — حجم فایل باید کمتر از ۱۵ مگابایت باشد';
        },
      },
    });
  };
}

export class CreateAttachmentDto {
  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsString()
  @MinLength(1)
  entityId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsFileUrlOrDataUri()
  fileUrl!: string;
}
