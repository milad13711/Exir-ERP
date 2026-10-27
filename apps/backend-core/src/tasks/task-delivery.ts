import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const MAX_IDS = 500;

/**
 * ثبت «دریافت‌شد» (deliveredAt) برای ردیف ارجاعِ خودِ کاربر — idempotent (فقط وقتی null است).
 * فقط وظایف منتشرشده‌ای که کاربر ارجاع‌گیرنده‌ی آن است؛ بقیه‌ی شناسه‌ها بی‌صدا نادیده گرفته می‌شوند.
 * هزینه: ۱ findMany محدود + (فقط در صورت لزوم) ۱ updateMany + ۱ findMany/createMany رویداد.
 * بدون وابستگی به DI تا تقویم/داشبورد هم بتوانند صدایش بزنند.
 * @returns تعداد وظایفی که همین الان «دریافت» شدند
 */
export async function markTasksDelivered(db: TenantPrismaClient, userId: string, taskIds: string[], now: Date = new Date()): Promise<number> {
  const ids = [...new Set(taskIds.filter((s) => typeof s === 'string' && s))].slice(0, MAX_IDS);
  if (!userId || ids.length === 0) return 0;
  const rows = await db.task.findMany({
    where: { id: { in: ids }, isPublished: true, OR: [{ assignedUserId: userId }, { assignees: { some: { userId } } }] },
    select: { id: true, assignees: { where: { userId }, select: { deliveredAt: true } } },
  });
  const pending = rows.filter((t) => t.assignees.length === 0 || t.assignees[0].deliveredAt === null).map((t) => t.id);
  if (pending.length === 0) return 0;
  const missingRow = rows.filter((t) => t.assignees.length === 0).map((t) => t.id);
  if (missingRow.length) {
    // وظیفه‌ی ساخته‌شده توسط ماژول‌های دیگر که فقط ستون قدیمی assignedUserId را دارد
    await db.taskAssignee.createMany({ data: missingRow.map((taskId) => ({ taskId, userId, deliveredAt: now })), skipDuplicates: true });
  }
  await db.taskAssignee.updateMany({ where: { userId, taskId: { in: pending }, deliveredAt: null }, data: { deliveredAt: now } });
  // یک رویداد DELIVERED برای هر (وظیفه، ارجاع‌گیرنده) — با حذف تکرار در برابر رقابت همزمان
  const existing = await db.taskEvent.findMany({ where: { taskId: { in: pending }, type: 'delivered', actorUserId: userId }, select: { taskId: true } });
  const had = new Set(existing.map((e) => e.taskId));
  const toRecord = pending.filter((id) => !had.has(id));
  if (toRecord.length) {
    await db.taskEvent.createMany({ data: toRecord.map((taskId) => ({ taskId, type: 'delivered', actorUserId: userId, createdAt: now })) });
  }
  return pending.length;
}
