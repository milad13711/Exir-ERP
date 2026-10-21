import { BadRequestException } from '@nestjs/common';

// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;

/**
 * نام نمایشی کاربر: trim، حذف کاراکترهای کنترلی و جهت‌دهی دوسویه (Trojan-Source / جعل نام)، فاصله‌های پیاپی → یکی،
 * ۲ تا ۸۰ نویسه. خطا = پیام فارسی روشن (۴۰۰).
 */
export function normalizeDisplayName(raw: string): string {
  const name = raw.replace(BAD, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw new BadRequestException('نام باید دست‌کم ۲ نویسه باشد');
  if (name.length > 80) throw new BadRequestException('نام نمی‌تواند بیش از ۸۰ نویسه باشد');
  if (/^[\d\s\p{P}\p{S}]+$/u.test(name)) throw new BadRequestException('نام باید شامل حرف باشد');
  return name;
}
