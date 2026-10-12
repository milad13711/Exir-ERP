/**
 * سیاست‌های پیام‌رسان — توابع خالص (بدون دیتابیس) تا هم در سرویس و هم در تست‌ها یک‌جا استفاده شوند.
 */

export const MESSENGER_POLICIES = ['OPEN', 'MANAGERS_AND_SHARED_ROLE', 'MANAGERS_INITIATE'] as const;
/**
 * OPEN: همه با همه.
 * MANAGERS_AND_SHARED_ROLE: کاربر عادی فقط با مدیران و هم‌نقش‌های خودش (نقش‌های تعریف‌شده در تنظیمات → نقش‌ها، مثل «واحد/دپارتمان») گفتگوی مستقیم دارد.
 * MANAGERS_INITIATE: فقط مدیران می‌توانند گفتگوی مستقیم شروع کنند؛ بقیه فقط به گفتگوهایی که مدیر آغاز کرده پاسخ می‌دهند.
 */
export type MessengerPolicy = (typeof MESSENGER_POLICIES)[number];

export const GROUP_CREATION_MODES = ['EVERYONE', 'MANAGERS'] as const;
export type GroupCreationMode = (typeof GROUP_CREATION_MODES)[number];

export type MessengerSettings = {
  policy: MessengerPolicy;
  groupCreation: GroupCreationMode;
  /** true: متن پیام در اعلان پوش نمایش داده نمی‌شود. */
  hidePreview: boolean;
  /** نگه‌داری متن پیام‌ها به روز؛ null = نامحدود. */
  retentionDays: number | null;
  /** نمایش آنلاین/آخرین بازدید در این محیط کاری. */
  showPresence: boolean;
};

export const DEFAULT_MESSENGER_SETTINGS: MessengerSettings = {
  policy: 'OPEN',
  groupCreation: 'EVERYONE',
  hidePreview: false,
  retentionDays: null,
  showPresence: true,
};

export function normalizeSettings(raw: unknown): MessengerSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<MessengerSettings>;
  const days = typeof v.retentionDays === 'number' && Number.isFinite(v.retentionDays) && v.retentionDays >= 1 ? Math.floor(v.retentionDays) : null;
  return {
    policy: (MESSENGER_POLICIES as readonly string[]).includes(v.policy as string) ? (v.policy as MessengerPolicy) : DEFAULT_MESSENGER_SETTINGS.policy,
    groupCreation: (GROUP_CREATION_MODES as readonly string[]).includes(v.groupCreation as string) ? (v.groupCreation as GroupCreationMode) : DEFAULT_MESSENGER_SETTINGS.groupCreation,
    hidePreview: typeof v.hidePreview === 'boolean' ? v.hidePreview : DEFAULT_MESSENGER_SETTINGS.hidePreview,
    retentionDays: days,
    showPresence: typeof v.showPresence === 'boolean' ? v.showPresence : DEFAULT_MESSENGER_SETTINGS.showPresence,
  };
}

export type PairContext = {
  actorIsManager: boolean;
  targetIsManager: boolean;
  /** آیا دو نفر حداقل یک نقش (Role) مشترک دارند. */
  sharesRole: boolean;
};

/** شروع گفتگوی مستقیم جدید. */
export function canStartDirect(policy: MessengerPolicy, p: PairContext): boolean {
  switch (policy) {
    case 'OPEN':
      return true;
    case 'MANAGERS_AND_SHARED_ROLE':
      return p.actorIsManager || p.targetIsManager || p.sharesRole;
    case 'MANAGERS_INITIATE':
      return p.actorIsManager;
  }
}

/** ارسال پیام در گفتگوی مستقیم موجود (پس از تغییر سیاست هم باید همین قاعده برقرار باشد). */
export function canSendDirect(policy: MessengerPolicy, p: PairContext & { createdByManager: boolean }): boolean {
  if (policy === 'MANAGERS_INITIATE') return p.actorIsManager || p.createdByManager;
  return canStartDirect(policy, p);
}

export function canCreateGroup(mode: GroupCreationMode, actorIsManager: boolean): boolean {
  return mode === 'EVERYONE' || actorIsManager;
}

export function directKeyFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function savedKeyFor(userId: string): string {
  return `saved:${userId}`;
}

/** ایموجی‌های مجاز برای واکنش. */
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '👎'] as const;

/** هر کاربر روی هر پیام یک واکنش دارد: همان ایموجی = برداشتن، ایموجی دیگر = جایگزینی. */
export function nextReactionState(existing: string | null, clicked: string): { remove: string | null; add: string | null } {
  if (existing === clicked) return { remove: existing, add: null };
  return { remove: existing, add: clicked };
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export function canManageMembers(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** حذف عضو: مالک همه را (جز خودش)، ادمین فقط اعضای عادی را. */
export function canRemoveMember(actorRole: MemberRole, targetRole: MemberRole): boolean {
  if (targetRole === 'OWNER') return false;
  if (actorRole === 'OWNER') return true;
  return actorRole === 'ADMIN' && targetRole === 'MEMBER';
}

/** حذف پیام برای همه: فرستنده یا (در گروه) مالک/ادمین. */
export function canDeleteForAll(opts: { isSender: boolean; conversationType: 'DIRECT' | 'GROUP' | 'SAVED'; role: MemberRole }): boolean {
  if (opts.isSender) return true;
  return opts.conversationType === 'GROUP' && canManageMembers(opts.role);
}

/** نامزد مالکیت پس از ترک مالک: ادمین قدیمی‌تر، وگرنه عضو قدیمی‌تر. */
export function pickNextOwner(members: { userId: string; role: MemberRole; joinedAt: Date }[]): string | null {
  const sorted = [...members].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return (sorted.find((m) => m.role === 'ADMIN') ?? sorted[0])?.userId ?? null;
}

/** پیش‌نمایش کوتاه برای پاسخ/اعلان. */
export function snippet(text: string | null | undefined, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** محدودکننده‌ی نرخ ساده‌ی پنجره‌ی لغزان در حافظه (برای هر کلید). */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** true = مجاز (و ثبت می‌شود). */
  take(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
