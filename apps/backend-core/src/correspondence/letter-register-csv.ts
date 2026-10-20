import { jalaliText, jalaliTimeText } from './tehran-date.js';
import { CONFIDENTIALITY_LABELS, LETTER_STATUS_LABELS, LETTER_TYPE_LABELS, PRIORITY_LABELS, type Confidentiality, type LetterStatus, type LetterType, type Priority } from './correspondence.constants.js';

/** خنثی‌سازی فرمول‌های اکسل (=, +, -, @, tab, CR) + نقل‌قول‌گذاری استاندارد CSV. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/\r?\n/g, ' ');
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type RegisterRow = {
  type: string; status: string; letterNumber: string | null; externalNumber: string | null; externalDate: Date | null;
  letterDate: Date | null; registeredAt: Date | null; subject: string; senderName: string | null; senderOrgName: string | null;
  recipientsText: string; categoryName?: string | null; priority: string; confidentiality: string; responseDueAt: Date | null;
  createdByName: string | null; voidReason: string | null; pageCount: number | null;
};

const HEADERS = [
  'شماره دبیرخانه', 'نوع', 'وضعیت', 'تاریخ نامه', 'تاریخ ثبت', 'شماره نامه‌ی اصلی', 'تاریخ نامه‌ی اصلی', 'موضوع', 'فرستنده', 'گیرنده',
  'دسته', 'فوریت', 'محرمانگی', 'مهلت پاسخ', 'تعداد برگ', 'ثبت‌کننده', 'دلیل ابطال',
];

/**
 * «دفتر ثبت نامه‌ها» — UTF-8 با BOM. فراخواننده فقط ردیف‌های داخل دامنه‌ی کاربر را می‌دهد (scope-aware)؛
 * موضوع نامه‌های محرمانه در خروجی نمی‌آید مگر کاربر دسترسی کامل داشته باشد (که قبلاً در دامنه فیلتر شده است).
 */
export function buildRegisterCsv(rows: RegisterRow[]): string {
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.letterNumber ?? '', LETTER_TYPE_LABELS[r.type as LetterType] ?? r.type, LETTER_STATUS_LABELS[r.status as LetterStatus] ?? r.status,
      r.letterDate ? jalaliText(r.letterDate) : '', r.registeredAt ? jalaliTimeText(r.registeredAt) : '',
      r.externalNumber ?? '', r.externalDate ? jalaliText(r.externalDate) : '', r.subject,
      [r.senderOrgName, r.senderName].filter(Boolean).join(' - '), r.recipientsText, r.categoryName ?? '',
      PRIORITY_LABELS[r.priority as Priority] ?? r.priority, CONFIDENTIALITY_LABELS[r.confidentiality as Confidentiality] ?? r.confidentiality,
      r.responseDueAt ? jalaliText(r.responseDueAt) : '', r.pageCount ?? '', r.createdByName ?? '', r.voidReason ?? '',
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
