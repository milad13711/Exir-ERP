/**
 * تیک‌های «واتساپی» وظایف (برای سازنده/مدیر):
 *  - none      : هنوز برای ارجاع‌گیرنده ارسال نشده (زمان‌بندی‌شده) یا وظیفه لغو شده → بدون تیک
 *  - sent      : ارسال شد ولی هنوز به ارجاع‌گیرنده «نرسیده» (یک تیک کم‌رنگ)
 *  - delivered : در سیستم به او رسید/دید که وظیفه دارد ولی هنوز بازش نکرده (یک تیک خاکستری)
 *  - seen      : باز کرد (دو تیک آبی)
 * چندنفره: seen فقط وقتی همه seen باشند؛ delivered وقتی همه delivered باشند؛ در غیر این صورت sent.
 */
export type TickState = 'none' | 'sent' | 'delivered' | 'seen';

export type TickAssigneeRow = { userId: string; deliveredAt: Date | string | null; seenAt: Date | string | null };

export function deriveAssigneeTick(row: Pick<TickAssigneeRow, 'deliveredAt' | 'seenAt'> | null | undefined): Exclude<TickState, 'none'> {
  if (row?.seenAt) return 'seen'; // seenAt ⇒ deliveredAt
  if (row?.deliveredAt) return 'delivered';
  return 'sent';
}

export function deriveTaskTick(
  task: { isPublished: boolean; status: string },
  assignees: TickAssigneeRow[],
): TickState {
  if (!task.isPublished || task.status === 'CANCELLED') return 'none';
  if (assignees.length === 0) return 'none';
  const states = assignees.map(deriveAssigneeTick);
  if (states.every((s) => s === 'seen')) return 'seen';
  if (states.every((s) => s === 'seen' || s === 'delivered')) return 'delivered';
  return 'sent';
}

/** استخراج شناسه‌ی وظیفه از اعلان: entityId (وقتی entityType==='Task') یا لینک `/tasks?open=<id>`. */
export function taskIdFromNotification(n: { entityType?: string | null; entityId?: string | null; link?: string | null }): string | null {
  const type = n.entityType?.toLowerCase();
  if (type === 'task' && n.entityId) return n.entityId;
  if (type && type !== 'task') return null;
  const m = /^\/tasks\?(?:[^#]*&)?open=([A-Za-z0-9-]{8,64})(?:[&#].*)?$/.exec(n.link ?? '');
  return m ? m[1] : null;
}
