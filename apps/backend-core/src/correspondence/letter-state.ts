import type { LetterStatus, LetterType } from './correspondence.constants.js';

/**
 * ماشین حالت گردش نامه — خالص (بدون دیتابیس).
 *
 * صادره/داخلی:  DRAFT → (PENDING_REVIEW) → PENDING_SIGNATURE → ISSUED → SENT → DELIVERED
 *               PENDING_* → RETURNED_FOR_EDIT → (submit) …؛ PENDING_SIGNATURE → REJECTED → (reopen) DRAFT
 * وارده:        REGISTERED → REFERRED → IN_PROGRESS → ANSWERED/CLOSED
 * همه:          VOID (شماره‌ی تخصیص‌یافته می‌سوزد و دوباره استفاده نمی‌شود)
 * «بایگانی» ستون جداگانه (archivedAt) است و وضعیت گردش را عوض نمی‌کند.
 */
export type LetterAction =
  | 'submit' | 'submit_review' | 'review_approve' | 'review_changes' | 'sign' | 'return' | 'reject' | 'send' | 'deliver'
  | 'void' | 'reopen' | 'refer' | 'start' | 'answer' | 'close';

type Rule = { types: readonly LetterType[]; from: readonly LetterStatus[]; to: LetterStatus };
const OUT: readonly LetterType[] = ['OUTGOING', 'INTERNAL'];
const IN: readonly LetterType[] = ['INCOMING'];

const RULES: Record<LetterAction, Rule[]> = {
  submit_review: [{ types: OUT, from: ['DRAFT', 'RETURNED_FOR_EDIT'], to: 'PENDING_REVIEW' }],
  submit: [{ types: OUT, from: ['DRAFT', 'RETURNED_FOR_EDIT'], to: 'PENDING_SIGNATURE' }],
  review_approve: [{ types: OUT, from: ['PENDING_REVIEW'], to: 'PENDING_SIGNATURE' }],
  review_changes: [{ types: OUT, from: ['PENDING_REVIEW'], to: 'RETURNED_FOR_EDIT' }],
  sign: [{ types: OUT, from: ['PENDING_SIGNATURE'], to: 'ISSUED' }],
  return: [{ types: OUT, from: ['PENDING_SIGNATURE', 'PENDING_REVIEW'], to: 'RETURNED_FOR_EDIT' }],
  reject: [{ types: OUT, from: ['PENDING_SIGNATURE', 'PENDING_REVIEW'], to: 'REJECTED' }],
  send: [{ types: ['OUTGOING'], from: ['ISSUED'], to: 'SENT' }],
  deliver: [
    { types: ['OUTGOING'], from: ['SENT'], to: 'DELIVERED' },
    { types: ['INTERNAL'], from: ['ISSUED'], to: 'DELIVERED' },
  ],
  void: [
    {
      types: ['INCOMING', 'OUTGOING', 'INTERNAL'],
      from: ['DRAFT', 'PENDING_REVIEW', 'PENDING_SIGNATURE', 'RETURNED_FOR_EDIT', 'REJECTED', 'ISSUED', 'SENT', 'DELIVERED', 'REGISTERED', 'REFERRED', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'],
      to: 'VOID',
    },
  ],
  reopen: [
    { types: OUT, from: ['REJECTED'], to: 'DRAFT' },
    { types: IN, from: ['ANSWERED', 'CLOSED'], to: 'IN_PROGRESS' },
  ],
  refer: [{ types: IN, from: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'], to: 'REFERRED' }],
  start: [{ types: IN, from: ['REFERRED'], to: 'IN_PROGRESS' }],
  answer: [{ types: IN, from: ['REGISTERED', 'REFERRED', 'IN_PROGRESS'], to: 'ANSWERED' }],
  close: [{ types: IN, from: ['REGISTERED', 'REFERRED', 'IN_PROGRESS', 'ANSWERED'], to: 'CLOSED' }],
};

/** وضعیت بعدی یا null اگر انتقال مجاز نیست. */
export function nextStatus(type: LetterType, from: LetterStatus, action: LetterAction): LetterStatus | null {
  const rule = RULES[action]?.find((r) => r.types.includes(type) && r.from.includes(from));
  return rule ? rule.to : null;
}

export function canTransition(type: LetterType, from: LetterStatus, action: LetterAction): boolean {
  return nextStatus(type, from, action) !== null;
}

/** ویرایش محتوای نامه: صادره/داخلی فقط در پیش‌نویس یا برگشتی؛ وارده تا پیش از مختومه/باطل (با دلیل و نسخه). */
export function isEditable(type: LetterType, status: LetterStatus): boolean {
  if (type === 'INCOMING') return ['REGISTERED', 'REFERRED', 'IN_PROGRESS', 'ANSWERED'].includes(status);
  return status === 'DRAFT' || status === 'RETURNED_FOR_EDIT';
}

/** پس از امضا ویرایش ممنوع است؛ فقط «اصلاحیه» (نامه‌ی جدید با ارجاع به اصلی). */
export function canCreateCorrection(type: LetterType, status: LetterStatus): boolean {
  return type !== 'INCOMING' && ['ISSUED', 'SENT', 'DELIVERED'].includes(status);
}

/** بایگانی فقط برای نامه‌های تکمیل‌شده/پایانی. */
export function isArchivable(type: LetterType, status: LetterStatus): boolean {
  if (type === 'INCOMING') return ['ANSWERED', 'CLOSED', 'VOID'].includes(status);
  return ['ISSUED', 'SENT', 'DELIVERED', 'REJECTED', 'VOID'].includes(status);
}

export function isTerminal(status: LetterStatus): boolean {
  return status === 'VOID' || status === 'CLOSED' || status === 'DELIVERED';
}

/** ارجاع/پاراف روی چه وضعیت‌هایی مجاز است. */
export function canRefer(type: LetterType, status: LetterStatus): boolean {
  if (type === 'INCOMING') return ['REGISTERED', 'REFERRED', 'IN_PROGRESS'].includes(status);
  return ['PENDING_SIGNATURE', 'ISSUED', 'SENT', 'DELIVERED', 'DRAFT'].includes(status);
}

export function canParaph(status: LetterStatus): boolean {
  return status !== 'VOID' && status !== 'REJECTED';
}
