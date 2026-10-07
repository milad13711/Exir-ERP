import { describe, expect, it, vi } from 'vitest';
import { ActivitySystemSyncService, AUTO_FILED_ACTION } from './activity-system-sync.service.js';

describe('ActivitySystemSyncService', () => {
  it('logs auto-filed daily reports once (idempotent) as AUTOMATIC attributed to the person', async () => {
    const logSystem = vi.fn();
    const db = {
      dailyChecklistDayClose: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', userId: 'u1', date: new Date('2026-10-05T00:00:00Z'), reportId: 'r1' }, { id: 'c2', userId: 'u2', date: new Date('2026-10-05T00:00:00Z'), reportId: 'r2' }]) },
      activityLog: { findMany: vi.fn().mockResolvedValue([{ entityId: 'c2' }]) },
    };
    const svc = new ActivitySystemSyncService({} as never, {} as never, { logSystem } as never);
    expect(await svc.syncAutoFiledReports(db as never)).toBe(1);
    expect(logSystem).toHaveBeenCalledWith(db, expect.objectContaining({ action: AUTO_FILED_ACTION, actorType: 'AUTOMATIC', userId: 'u1', entityId: 'c1', moduleCode: 'daily-checklist' }));
  });
});
