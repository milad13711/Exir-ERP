/** دامنه‌ی دید و مجوز مرحله‌ها — خالص. */

export type StepAccess = { roleIds: string[]; userIds: string[] };
export const OPEN_ACCESS: StepAccess = { roleIds: [], userIds: [] };

export type ActorFacts = { userId: string | null; roleIds: string[]; manager: boolean };

/**
 * تنظیمات «چه نقش‌ها/کاربرانی» اجازه‌ی هر مرحله را دارند. خالی = هر کاربرِ دارای دسترسی ویرایش ماژول؛
 * مدیر (OWNER/ADMIN) همیشه مجاز است.
 */
export function canPerformStep(access: StepAccess | undefined, actor: ActorFacts): boolean {
  if (actor.manager) return true;
  if (!access || (access.roleIds.length === 0 && access.userIds.length === 0)) return true;
  if (actor.userId && access.userIds.includes(actor.userId)) return true;
  return access.roleIds.some((r) => actor.roleIds.includes(r));
}

/** برای مجوزهایی که فقط با فهرست صریح صادر می‌شوند (مثلاً آماده حرکت): خالی = فقط مدیر/مسئول وظیفه. */
export function isExplicitlyAllowed(access: StepAccess | undefined, actor: ActorFacts): boolean {
  if (actor.manager) return true;
  if (!access) return false;
  if (actor.userId && access.userIds.includes(actor.userId)) return true;
  return access.roleIds.some((r) => actor.roleIds.includes(r));
}

/**
 * where برای فهرست/جزئیات: «مشاهده‌ی همه» = {}؛ «فقط خودم» = بارهایی که خودش ساخته، در تایم‌لاینشان نقش داشته،
 * یا مسئول وظیفه‌ی اسناد آن‌هاست. بدون userId هرگز دامنه‌ی «خودم» ندارد (null با بارهای بی‌صاحب یکی نشود).
 */
export function dispatchViewWhere(viewAll: boolean, viewOwn: boolean, userId: string | null, taskShipmentIds: string[]): Record<string, unknown> | null {
  if (viewAll) return {};
  if (!viewOwn || !userId) return null;
  return {
    OR: [
      { createdByUserId: userId },
      { events: { some: { actorUserId: userId } } },
      ...(taskShipmentIds.length ? [{ id: { in: taskShipmentIds } }] : []),
    ],
  };
}
