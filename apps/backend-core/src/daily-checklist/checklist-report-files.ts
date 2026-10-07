import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { CHECKLIST_ITEM_ENTITY, MAX_REPORT_ARCHIVE_CHARS } from './checklist-attachment.util.js';

export type ChecklistFileRef = { id: string; title: string; itemTitle: string };

/** فهرست فایل‌های پیوست‌شده به آیتم‌های یک روز (بدون خواندن محتوای فایل‌ها). */
export async function listChecklistFiles(
  tenantDb: TenantPrismaClient,
  items: Array<{ id: string; title: string }>,
): Promise<ChecklistFileRef[]> {
  if (items.length === 0) return [];
  const itemTitle = new Map(items.map((i) => [i.id, i.title]));
  const rows = await tenantDb.attachment.findMany({
    where: { entityType: CHECKLIST_ITEM_ENTITY, entityId: { in: items.map((i) => i.id) } },
    select: { id: true, title: true, entityId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, itemTitle: itemTitle.get(r.entityId) ?? '' }));
}

/**
 * فایل‌های آیتم‌های چک‌لیست را در گزارش روزانه بایگانی می‌کند (کپیِ Attachment با entityType='Report').
 * Idempotent: کلید یکتای (entityType, entityId, sourceAttachmentId) + بررسی قبلی؛ تکرار بستن/به‌روزرسانی
 * گزارش، فایل تکراری نمی‌سازد و فقط نام/توضیح مبدأ را همگام می‌کند. فایل‌های اضافه‌بر سقف حجم رد می‌شوند.
 * خروجی: شناسه‌ی پیوست‌های مبدأیی که به‌خاطر حجم بایگانی نشدند.
 */
export async function archiveFilesToReport(
  tenantDb: TenantPrismaClient,
  reportId: string,
  files: ChecklistFileRef[],
  ownerUserId: string | null,
): Promise<{ skipped: string[] }> {
  const skipped: string[] = [];
  if (files.length === 0) return { skipped };

  const existing = await tenantDb.attachment.findMany({
    where: { entityType: 'Report', entityId: reportId, sourceAttachmentId: { not: null } },
    select: { id: true, sourceAttachmentId: true, title: true, sourceNote: true, fileUrl: true },
  });
  const bySource = new Map(existing.map((e) => [e.sourceAttachmentId as string, e]));
  let usedChars = existing.reduce((n, e) => n + (e.fileUrl.startsWith('data:') ? e.fileUrl.length : 0), 0);

  for (const f of files) {
    const have = bySource.get(f.id);
    if (have) {
      if (have.title !== f.title || have.sourceNote !== f.itemTitle) {
        await tenantDb.attachment.update({ where: { id: have.id }, data: { title: f.title, sourceNote: f.itemTitle } });
      }
      continue;
    }
    const src = await tenantDb.attachment.findUnique({ where: { id: f.id }, select: { fileUrl: true } });
    if (!src) continue;
    const size = src.fileUrl.startsWith('data:') ? src.fileUrl.length : 0;
    if (usedChars + size > MAX_REPORT_ARCHIVE_CHARS) {
      skipped.push(f.id);
      continue;
    }
    const created = await tenantDb.attachment.createMany({
      data: [
        {
          entityType: 'Report',
          entityId: reportId,
          title: f.title,
          fileUrl: src.fileUrl,
          createdByUserId: ownerUserId,
          sourceAttachmentId: f.id,
          sourceNote: f.itemTitle,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count > 0) usedChars += size;
  }
  return { skipped };
}
