/**
 * ماشین وضعیت وظیفه — منطق خالص (بدون دیتابیس) تا هم کنترلر هم cron هم تست‌ها از یک منبع استفاده کنند.
 *
 * NEW → SEEN → IN_PROGRESS → DONE(انجام‌شده، منتظر تأیید) → APPROVED
 * به‌علاوه: HAS_PROBLEM، RETURNED_FOR_FIX، EXPIRED، CANCELLED.
 * OPEN فقط مقدار قدیمیِ enum است و مثل NEW رفتار می‌کند (بک‌فیل مهاجرت همه را به NEW برده).
 */
export type TaskStatusValue =
  | 'OPEN'
  | 'NEW'
  | 'SEEN'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'APPROVED'
  | 'HAS_PROBLEM'
  | 'RETURNED_FOR_FIX'
  | 'EXPIRED'
  | 'CANCELLED';

export type TaskAction =
  | 'SEE'
  | 'START'
  | 'SUBMIT'
  | 'REPORT_PROBLEM'
  | 'RESOLVE_PROBLEM'
  | 'APPROVE'
  | 'RETURN'
  | 'EXPIRE'
  | 'RESUME'
  | 'CANCEL'
  | 'REASSIGN'
  | 'REOPEN';

/** وضعیت‌هایی که هنوز کار باز است (برای شمارنده‌ها، یادآوری و انقضا). */
export const ACTIVE_STATUSES: TaskStatusValue[] = ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'HAS_PROBLEM', 'RETURNED_FOR_FIX', 'EXPIRED'];
/** وضعیت‌هایی که ارجاع‌گیرنده هنوز باید روی‌شان کار کند و موعدشان معنا دارد. */
export const WORKING_STATUSES: TaskStatusValue[] = ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'RETURNED_FOR_FIX'];
/** انجام‌شده‌ی نهایی. */
export const FINISHED_STATUSES: TaskStatusValue[] = ['DONE', 'APPROVED'];
export const TERMINAL_STATUSES: TaskStatusValue[] = ['APPROVED', 'CANCELLED'];

/** اقدام‌هایی که ارجاع‌گیرنده مجاز است. */
export const ASSIGNEE_ACTIONS: ReadonlySet<TaskAction> = new Set<TaskAction>(['SEE', 'START', 'SUBMIT', 'REPORT_PROBLEM']);
/** اقدام‌هایی که فقط سازنده/مدیر مجاز است. */
export const MANAGER_ACTIONS: ReadonlySet<TaskAction> = new Set<TaskAction>(['APPROVE', 'RETURN', 'RESOLVE_PROBLEM', 'CANCEL', 'REASSIGN', 'REOPEN']);
/** اقدام‌های سیستمی (cron). */
export const SYSTEM_ACTIONS: ReadonlySet<TaskAction> = new Set<TaskAction>(['EXPIRE', 'RESUME']);

const WORK: TaskStatusValue[] = ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'RETURNED_FOR_FIX', 'EXPIRED'];

const RULES: Record<TaskAction, { from: TaskStatusValue[]; to: TaskStatusValue }> = {
  SEE: { from: ['OPEN', 'NEW'], to: 'SEEN' },
  START: { from: ['OPEN', 'NEW', 'SEEN', 'RETURNED_FOR_FIX', 'EXPIRED'], to: 'IN_PROGRESS' },
  SUBMIT: { from: WORK, to: 'DONE' },
  REPORT_PROBLEM: { from: WORK, to: 'HAS_PROBLEM' },
  RESOLVE_PROBLEM: { from: ['HAS_PROBLEM'], to: 'IN_PROGRESS' },
  APPROVE: { from: ['DONE'], to: 'APPROVED' },
  RETURN: { from: ['DONE'], to: 'RETURNED_FOR_FIX' },
  EXPIRE: { from: ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'RETURNED_FOR_FIX'], to: 'EXPIRED' },
  // to = «وضعیت قبل از انقضا» — در nextStatus با expiredFrom جایگزین می‌شود
  RESUME: { from: ['EXPIRED'], to: 'NEW' },
  CANCEL: { from: ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'DONE', 'HAS_PROBLEM', 'RETURNED_FOR_FIX', 'EXPIRED'], to: 'CANCELLED' },
  REASSIGN: { from: ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'DONE', 'HAS_PROBLEM', 'RETURNED_FOR_FIX', 'EXPIRED'], to: 'NEW' },
  REOPEN: { from: ['CANCELLED', 'APPROVED'], to: 'NEW' },
};

export class TaskTransitionError extends Error {
  constructor(public readonly from: TaskStatusValue, public readonly action: TaskAction) {
    super(`انتقال ${action} از وضعیت ${from} مجاز نیست`);
  }
}

export function canTransition(from: TaskStatusValue, action: TaskAction): boolean {
  return RULES[action].from.includes(from);
}

export function nextStatus(from: TaskStatusValue, action: TaskAction, opts: { expiredFrom?: TaskStatusValue | null } = {}): TaskStatusValue {
  if (!canTransition(from, action)) throw new TaskTransitionError(from, action);
  if (action === 'RESUME') {
    const back = opts.expiredFrom && opts.expiredFrom !== 'EXPIRED' ? opts.expiredFrom : 'NEW';
    return back === 'OPEN' ? 'NEW' : back;
  }
  return RULES[action].to;
}

/** اقدام‌های ممکن برای نقش فعلی — برای نمایش دکمه‌ها در UI (سرور همچنان هر اقدام را دوباره اعتبارسنجی می‌کند). */
export function availableActions(status: TaskStatusValue, role: { manager: boolean; assignee: boolean }): TaskAction[] {
  const out: TaskAction[] = [];
  (Object.keys(RULES) as TaskAction[]).forEach((a) => {
    if (SYSTEM_ACTIONS.has(a)) return;
    if (!canTransition(status, a)) return;
    if (ASSIGNEE_ACTIONS.has(a) ? role.assignee : role.manager) out.push(a);
  });
  return out;
}

/**
 * آیا ثبت نتیجه نیاز به تأیید دارد؟ وظیفه‌ی شخصی (سازنده = تنها ارجاع‌گیرنده) یا بدون سازنده‌ی مشخص (ساخته‌ی سیستم/ماژول‌های دیگر)
 * مستقیماً APPROVED می‌شود تا کاربر در تأیید کار خودش گیر نکند.
 */
export function requiresApproval(createdByUserId: string | null, assigneeIds: string[]): boolean {
  if (!createdByUserId) return false;
  if (assigneeIds.length === 0) return false;
  if (assigneeIds.length === 1 && assigneeIds[0] === createdByUserId) return false;
  return true;
}
