import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { addDays } from './checklist-day.util.js';

/** کارهای انجام‌نشده‌ی یک روز را با برچسب «مانده از قبل» به لیست روز بعد اضافه می‌کند؛ تعداد منتقل‌شده را برمی‌گرداند. */
export async function rollPendingToNextDay(tenantDb: TenantPrismaClient, userId: string, date: Date): Promise<number> {
  const pending = await tenantDb.dailyChecklistItem.findMany({ where: { userId, date, done: false }, orderBy: { order: 'asc' } });
  if (pending.length === 0) return 0;
  const tomorrow = addDays(date, 1);
  const last = await tenantDb.dailyChecklistItem.findFirst({ where: { userId, date: tomorrow }, orderBy: { order: 'desc' }, select: { order: true } });
  let order = (last?.order ?? -1) + 1;
  await tenantDb.dailyChecklistItem.createMany({
    data: pending.map((i) => ({
      userId,
      date: tomorrow,
      title: i.title,
      description: i.description,
      priority: i.priority,
      carriedOver: true,
      createdByUserId: i.createdByUserId,
      order: order++,
    })),
  });
  return pending.length;
}
