import { PATTERNS } from '../mapping/moodian-field-map.js';

/**
 * شماره منحصر به فرد مالیاتی (taxid) = شناسه‌ی حافظه‌ی مالیاتی (۶) + بخش تاریخ (۵ هگز) + سریال (۱۰ هگز) + رقم کنترل (۱).
 * قالب دقیق (محاسبه‌ی بخش تاریخ و رقم کنترل) در سند جداگانه‌ی «قالب شناسه یکتای حافظه مالیاتی و شماره منحصر به فرد مالیاتی»
 * آمده که در دسترس ما نیست. بنابراین هیچ الگوریتمی ساخته نشده: سازنده‌ی خودکار NotVerifiedError می‌دهد
 * و تنها مسیر کارا «ورود دستی taxid» است که فقط ساختار (۲۲ هگز) و تطابق با شناسه‌ی حافظه را می‌سنجد.
 */
export class NotVerifiedError extends Error {
  constructor(what: string) {
    super(`${what} هنوز راستی‌آزمایی نشده است: قالب رسمی شماره منحصر به فرد مالیاتی در دسترس نیست؛ taxid را دستی وارد کنید`);
    this.name = 'NotVerifiedError';
  }
}

export type TaxIdParts = { fiscalId: string; datePart: string; serial: string; checkDigit: string };

export interface TaxIdBuilder {
  /** شماره‌ی کامل ۲۲ نویسه‌ای را از ورودی‌های ساختاری می‌سازد. */
  build(input: { fiscalId: string; issuedAt: Date; serial: string }): string;
}

/** تقسیم ساختاری (فقط برش نویسه‌ها؛ بدون هیچ ادعایی درباره‌ی معنای بخش‌ها). */
export function splitTaxId(taxid: string): TaxIdParts {
  return { fiscalId: taxid.slice(0, 6), datePart: taxid.slice(6, 11), serial: taxid.slice(11, 21), checkDigit: taxid.slice(21, 22) };
}

/** سازنده‌ی پیش‌فرض: عمداً ناتمام. */
export class UnverifiedTaxIdBuilder implements TaxIdBuilder {
  build(): string {
    // TODO(taxid-spec): بخش تاریخ (۵ هگز) و رقم کنترل را فقط با سند رسمی قالب شناسه پیاده کنید و تست واحد بنویسید.
    throw new NotVerifiedError('ساخت خودکار شماره منحصر به فرد مالیاتی (بخش تاریخ و رقم کنترل)');
  }
}

export type ManualTaxIdCheck = { ok: true; taxid: string; inno: string } | { ok: false; reason: string };

/** اعتبارسنجی ساختاری taxid واردشده‌ی دستی. رقم کنترل بررسی نمی‌شود (NotVerified) — سامانه خطای ۳۸/۶۰ می‌دهد. */
export function checkManualTaxId(raw: string | null | undefined, fiscalId?: string | null): ManualTaxIdCheck {
  const taxid = (raw ?? '').trim().toUpperCase();
  if (!PATTERNS.taxid.test(taxid)) return { ok: false, reason: 'شماره منحصر به فرد مالیاتی باید ۲۲ نویسه‌ی هگز باشد' };
  if (fiscalId && taxid.slice(0, 6).toUpperCase() !== fiscalId.toUpperCase()) {
    return { ok: false, reason: 'شش نویسه‌ی اول شماره مالیاتی با شناسه‌ی حافظه مالیاتی تنظیمات یکی نیست' };
  }
  return { ok: true, taxid, inno: splitTaxId(taxid).serial };
}
