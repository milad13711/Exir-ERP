import type { Confidentiality, ParticipantRole } from './correspondence.constants.js';

/**
 * دامنه‌ی دید نامه — خالص و امنیتی.
 *
 * قواعد (تصمیم‌شده؛ در گزارش نهایی مستند شده):
 *  - OWNER: همه‌چیز، حتی «سری».
 *  - ADMIN: همه‌ی نامه‌ها به‌جز «سری» و پیش‌نویس‌های دیگران، مگر مشارکت‌کننده باشد.
 *  - دارنده‌ی «مشاهده‌ی همه» (غیرمدیر): فقط نامه‌های «عادی» غیرپیش‌نویس + نامه‌هایی که خودش مشارکت دارد.
 *  - دارنده‌ی «فقط خودم»: نامه‌هایی که سازنده/مسئول/امضاکننده/مشارکت‌کننده‌شان است (هر سطح محرمانگی).
 *  - مدیر زنجیره‌ی سازمانی به‌طور پیش‌فرض نامه‌های زیردستان را نمی‌بیند (فقط با مشارکت/ارجاع).
 *  - بدون userId (کلید API غیرمدیر) هرگز دامنه‌ی «خودم» ندارد.
 */
export type ScopeActor = {
  userId: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  viewAll: boolean;
  viewOwn: boolean;
};

export type Where = Record<string, unknown>;

export function mineWhere(userId: string): Where {
  return {
    OR: [
      { createdByUserId: userId },
      { ownerUserId: userId },
      { signerUserId: userId },
      { participants: { some: { userId } } },
    ],
  };
}

/** where مربوط به دید؛ null = هیچ دسترسی. {} = همه. */
export function letterVisibilityWhere(a: ScopeActor): Where | null {
  if (a.isOwner) return {};
  const branches: Where[] = [];
  if (a.userId && (a.isAdmin || a.viewAll || a.viewOwn)) branches.push(mineWhere(a.userId));
  if (a.isAdmin) branches.push({ AND: [{ confidentiality: { not: 'SECRET' } }, { status: { not: 'DRAFT' } }] });
  else if (a.viewAll) branches.push({ AND: [{ confidentiality: 'NORMAL' }, { status: { not: 'DRAFT' } }] });
  if (branches.length === 0) return null;
  return branches.length === 1 ? branches[0] : { OR: branches };
}

export type VisibleLetterFacts = {
  createdByUserId: string | null;
  ownerUserId: string | null;
  signerUserId: string | null;
  confidentiality: string;
  status: string;
};

/** معادل درون‌حافظه‌ای letterVisibilityWhere (برای اعلان‌ها و تست هم‌ارزی). */
export function canSeeLetter(a: ScopeActor, l: VisibleLetterFacts, participantUserIds: readonly string[]): boolean {
  if (a.isOwner) return true;
  const mine = !!a.userId && (l.createdByUserId === a.userId || l.ownerUserId === a.userId || l.signerUserId === a.userId || participantUserIds.includes(a.userId));
  if (mine && (a.isAdmin || a.viewAll || a.viewOwn)) return true;
  if (a.isAdmin) return l.confidentiality !== 'SECRET' && l.status !== 'DRAFT';
  if (a.viewAll) return l.confidentiality === 'NORMAL' && l.status !== 'DRAFT';
  return false;
}

export const isConfidential = (c: string | null | undefined): boolean => !!c && c !== 'NORMAL';

/** متن اعلان: برای نامه‌ی محرمانه هرگز موضوع/شماره درز نمی‌کند. */
export function notificationText(
  kind: string,
  letter: { subject: string; letterNumber: string | null; confidentiality: Confidentiality | string },
): { title: string; body?: string } {
  if (isConfidential(letter.confidentiality)) return { title: kind, body: 'جزئیات نامه‌ی محرمانه است؛ برای مشاهده وارد شوید.' };
  const num = letter.letterNumber ? ` (${letter.letterNumber})` : '';
  return { title: kind, body: `${letter.subject}${num}` };
}

/** نقش‌هایی که می‌توانند پاراف بزنند / نامه را ببینند، از روی مشارکت. */
export const PARAPH_ROLES: readonly ParticipantRole[] = ['CREATOR', 'REFERRAL', 'SIGNER', 'REVIEWER', 'CC', 'PARAPHER'];
