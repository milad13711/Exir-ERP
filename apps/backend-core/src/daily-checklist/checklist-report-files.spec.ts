import { describe, expect, it, vi } from 'vitest';
import { archiveFilesToReport, listChecklistFiles } from './checklist-report-files.js';

type Row = Record<string, any>;

/** یک Attachment ساختگیِ درون‌حافظه با همان کلید یکتای (entityType, entityId, sourceAttachmentId). */
function fakeDb(rows: Row[]) {
  let seq = 0;
  const attachment = {
    findMany: vi.fn(async ({ where }: any) =>
      rows.filter((r) => {
        if (where.entityType && r.entityType !== where.entityType) return false;
        if (where.entityId?.in) return where.entityId.in.includes(r.entityId);
        if (where.entityId && r.entityId !== where.entityId) return false;
        if (where.sourceAttachmentId?.not === null && r.sourceAttachmentId == null) return false;
        return true;
      }),
    ),
    findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const d of data) {
        const dup = rows.some((r) => r.entityType === d.entityType && r.entityId === d.entityId && r.sourceAttachmentId === d.sourceAttachmentId);
        if (dup && skipDuplicates) continue;
        rows.push({ id: `copy-${++seq}`, ...d });
        count++;
      }
      return { count };
    }),
  };
  return { attachment } as any;
}

const src = (id: string, title: string, size = 10): Row => ({ id, entityType: 'DailyChecklistItem', entityId: 'item-1', title, fileUrl: `data:application/pdf;base64,${'A'.repeat(size)}` });

describe('archiveFilesToReport', () => {
  it('copies each checklist file into the report once and stays idempotent on refresh', async () => {
    const rows = [src('a1', 'رسید'), src('a2', 'قرارداد')];
    const db = fakeDb(rows);
    const files = await listChecklistFiles(db, [{ id: 'item-1', title: 'کار ۱' }]);
    expect(files.map((f) => f.title)).toEqual(['رسید', 'قرارداد']);

    await archiveFilesToReport(db, 'rep-1', files, 'u1');
    await archiveFilesToReport(db, 'rep-1', files, 'u1');
    await archiveFilesToReport(db, 'rep-1', files, 'u1');

    const copies = rows.filter((r) => r.entityType === 'Report');
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => c.sourceAttachmentId).sort()).toEqual(['a1', 'a2']);
    expect(copies[0]).toMatchObject({ entityId: 'rep-1', sourceNote: 'کار ۱', createdByUserId: 'u1' });
    expect(copies[0].fileUrl).toBe(rows[0].fileUrl);
  });

  it('syncs a renamed source title onto the existing copy without duplicating', async () => {
    const rows = [src('a1', 'رسید')];
    const db = fakeDb(rows);
    await archiveFilesToReport(db, 'rep-1', [{ id: 'a1', title: 'رسید', itemTitle: 'کار' }], null);
    await archiveFilesToReport(db, 'rep-1', [{ id: 'a1', title: 'رسید نهایی', itemTitle: 'کار' }], null);
    const copies = rows.filter((r) => r.entityType === 'Report');
    expect(copies).toHaveLength(1);
    expect(copies[0].title).toBe('رسید نهایی');
  });

  it('skips files beyond the total archive size cap and reports them', async () => {
    const rows = [src('a1', 'بزرگ', 30_000_000), src('a2', 'بزرگ دوم', 30_000_000)];
    const db = fakeDb(rows);
    const files = [
      { id: 'a1', title: 'بزرگ', itemTitle: 'k' },
      { id: 'a2', title: 'بزرگ دوم', itemTitle: 'k' },
    ];
    const res = await archiveFilesToReport(db, 'rep-1', files, null);
    expect(res.skipped).toEqual(['a2']);
    expect(rows.filter((r) => r.entityType === 'Report')).toHaveLength(1);
  });

  it('does nothing without files', async () => {
    const db = fakeDb([]);
    expect(await archiveFilesToReport(db, 'rep-1', [], null)).toEqual({ skipped: [] });
    expect(db.attachment.findMany).not.toHaveBeenCalled();
  });
});
