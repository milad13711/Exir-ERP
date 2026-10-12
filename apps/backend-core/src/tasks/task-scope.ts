/**
 * دامنه‌ی دید وظایف. مدیر (OWNER/ADMIN یا «مشاهده‌ی همه») همه را می‌بیند؛ بقیه فقط وظایفی که خودشان ساخته‌اند یا به آن‌ها ارجاع شده.
 * وظیفه‌ی زمان‌بندی‌شده‌ی هنوز-منتشرنشده برای ارجاع‌گیرنده نامرئی است (فقط سازنده و مدیر).
 * `assignedUserId` ستون قدیمیِ «مسئول اصلی» است و برای وظایف ساخته‌شده توسط ماژول‌های دیگر هم لحاظ می‌شود.
 */
export function taskScopeWhere(manager: boolean, userId: string | null): Record<string, unknown> {
  if (manager) return {};
  if (!userId) return { id: '__none__' };
  return {
    OR: [
      { createdByUserId: userId },
      { isPublished: true, assignedUserId: userId },
      { isPublished: true, assignees: { some: { userId } } },
    ],
  };
}

/** کاربر ارجاع‌گیرنده‌ی این وظیفه است؟ (ردیف TaskAssignee یا ستون قدیمی) */
export function isTaskAssignee(task: { assignedUserId: string | null; assignees?: Array<{ userId: string }> }, userId: string | null): boolean {
  if (!userId) return false;
  return task.assignedUserId === userId || (task.assignees ?? []).some((a) => a.userId === userId);
}

export type TaskRole = { manager: boolean; creator: boolean; assignee: boolean };

/** سازنده یا مدیر می‌تواند اقدام‌های مدیریتی (تأیید/بازگشت/ارجاع مجدد/لغو/ویرایش) بزند. */
export function canManageTask(role: TaskRole): boolean {
  return role.manager || role.creator;
}

export function resolveTaskRole(
  task: { createdByUserId: string | null; assignedUserId: string | null; assignees?: Array<{ userId: string }> },
  userId: string | null,
  manager: boolean,
): TaskRole {
  return { manager, creator: !!userId && task.createdByUserId === userId, assignee: isTaskAssignee(task, userId) };
}
