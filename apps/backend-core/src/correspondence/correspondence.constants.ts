/** ثابت‌ها و برچسب‌های ماژول «مکاتبات سازمانی» (دبیرخانه) — مقادیر مجاز ستون‌های String در schema. */

export const MODULE_CODE = 'correspondence';
/** نوع موجودیت در مدارک امضا (SignatureEvidence) و پیوست عمومی */
export const EVIDENCE_ENTITY = 'correspondence_letter';
export const ATTACHMENT_ENTITY = 'Letter';
/** PDF امضاشده‌ی تغییرناپذیر: فقط خواندنی؛ هیچ نقشی (حتی مدیر) نمی‌تواند حذف/افزودن کند. */
export const SNAPSHOT_ATTACHMENT_ENTITY = 'LetterSnapshot';
/** اسکن نامه‌ی اصلی وارده: افزودن مجاز، حذف/تغییر نام ممنوع (سند مادر) */
export const SCAN_ATTACHMENT_ENTITY = 'LetterScan';
/** رسید تحویل نامه‌ی صادره/داخلی پس از امضا: فقط افزودن */
export const RECEIPT_ATTACHMENT_ENTITY = 'LetterReceipt';

export const LETTER_TYPES = ['INCOMING', 'OUTGOING', 'INTERNAL'] as const;
export type LetterType = (typeof LETTER_TYPES)[number];
export const LETTER_TYPE_LABELS: Record<LetterType, string> = { INCOMING: 'وارده', OUTGOING: 'صادره', INTERNAL: 'داخلی' };
/** مقدار توکن {TYPE} در الگوی شماره */
export const LETTER_TYPE_CODES: Record<LetterType, string> = { INCOMING: 'و', OUTGOING: 'ص', INTERNAL: 'د' };

export const LETTER_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PENDING_SIGNATURE',
  'RETURNED_FOR_EDIT',
  'REJECTED',
  'ISSUED',
  'SENT',
  'DELIVERED',
  'REGISTERED',
  'REFERRED',
  'IN_PROGRESS',
  'ANSWERED',
  'CLOSED',
  'VOID',
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];
export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_REVIEW: 'در انتظار بازبینی',
  PENDING_SIGNATURE: 'در انتظار امضا',
  RETURNED_FOR_EDIT: 'برگشت برای اصلاح',
  REJECTED: 'ردشده',
  ISSUED: 'صادرشده (امضاشده)',
  SENT: 'ارسال‌شده',
  DELIVERED: 'تحویل‌شده',
  REGISTERED: 'ثبت‌شده',
  REFERRED: 'ارجاع‌شده',
  IN_PROGRESS: 'در دست اقدام',
  ANSWERED: 'پاسخ داده شده',
  CLOSED: 'مختومه',
  VOID: 'باطل‌شده',
};

export const PRIORITIES = ['NORMAL', 'URGENT', 'IMMEDIATE'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { NORMAL: 'عادی', URGENT: 'فوری', IMMEDIATE: 'آنی' };

export const CONFIDENTIALITIES = ['NORMAL', 'CONFIDENTIAL', 'VERY_CONFIDENTIAL', 'SECRET'] as const;
export type Confidentiality = (typeof CONFIDENTIALITIES)[number];
export const CONFIDENTIALITY_LABELS: Record<Confidentiality, string> = {
  NORMAL: 'عادی',
  CONFIDENTIAL: 'محرمانه',
  VERY_CONFIDENTIAL: 'خیلی محرمانه',
  SECRET: 'سری',
};

export const DELIVERY_METHODS = ['POST', 'COURIER', 'EMAIL', 'HAND', 'SYSTEM'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = { POST: 'پست', COURIER: 'پیک', EMAIL: 'ایمیل', HAND: 'دستی', SYSTEM: 'سامانه' };

export const PARTICIPANT_ROLES = ['CREATOR', 'REFERRAL', 'SIGNER', 'REVIEWER', 'CC', 'PARAPHER', 'VIEWER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const REFERRAL_STATUSES = ['PENDING', 'SEEN', 'DONE', 'RETURNED', 'CANCELLED'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_OPEN_STATUSES: readonly ReferralStatus[] = ['PENDING', 'SEEN'];

export const NUMBER_RESET_POLICIES = ['YEARLY', 'MONTHLY', 'NEVER'] as const;
export type NumberResetPolicy = (typeof NUMBER_RESET_POLICIES)[number];

export const EVENT_TYPES = [
  'CREATED', 'EDITED', 'SUBMITTED', 'REVIEWED', 'RETURNED', 'REJECTED', 'SIGNED', 'ISSUED', 'SENT', 'DELIVERED',
  'RECEIPT_RECEIVED', 'REGISTERED', 'REFERRED', 'REFERRAL_SEEN', 'REFERRAL_DONE', 'REFERRAL_RETURNED', 'REFERRAL_FORWARDED',
  'REFERRAL_CANCELLED', 'PARAPHED', 'REPLIED', 'ANSWERED', 'CLOSED', 'VOIDED', 'ARCHIVED', 'UNARCHIVED', 'REOPENED',
  'EXTERNAL_FOLLOWUP', 'CORRECTION_CREATED', 'REMINDER', 'EVIDENCE_PENDING', 'VOID_REQUESTED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED',
] as const;
export type LetterEventType = (typeof EVENT_TYPES)[number];
export const EVENT_LABELS: Record<LetterEventType, string> = {
  CREATED: 'ایجاد نامه', EDITED: 'ویرایش', SUBMITTED: 'ارجاع برای امضا', REVIEWED: 'بازبینی', RETURNED: 'برگشت برای اصلاح',
  REJECTED: 'رد شد', SIGNED: 'امضا شد', ISSUED: 'شماره خورد و صادر شد', SENT: 'ارسال شد', DELIVERED: 'تحویل شد',
  RECEIPT_RECEIVED: 'رسید تحویل دریافت شد', REGISTERED: 'ثبت در دبیرخانه', REFERRED: 'ارجاع', REFERRAL_SEEN: 'ارجاع دیده شد',
  REFERRAL_DONE: 'ارجاع انجام شد', REFERRAL_RETURNED: 'ارجاع برگشت خورد', REFERRAL_FORWARDED: 'ارجاع به فرد دیگر',
  REFERRAL_CANCELLED: 'ارجاع لغو شد', PARAPHED: 'پاراف', REPLIED: 'ایجاد پاسخ', ANSWERED: 'پاسخ داده شد', CLOSED: 'مختومه شد',
  VOIDED: 'باطل شد', ARCHIVED: 'بایگانی شد', UNARCHIVED: 'از بایگانی خارج شد', REOPENED: 'بازگشایی شد',
  EXTERNAL_FOLLOWUP: 'پیگیری بیرونی', CORRECTION_CREATED: 'ایجاد اصلاحیه', REMINDER: 'یادآوری', EVIDENCE_PENDING: 'مدرک امضا ثبت نشد', VOID_REQUESTED: 'درخواست ابطال', ATTACHMENT_ADDED: 'افزودن پیوست', ATTACHMENT_REMOVED: 'حذف پیوست',
};

export const isLetterType = (v: unknown): v is LetterType => (LETTER_TYPES as readonly string[]).includes(v as string);
