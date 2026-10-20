import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSFERABLE, type TransferEntry } from './ownership-registry.js';
import { UNASSIGN, cleanupPersonal, countOwned, transferOwnership } from './offboarding.engine.js';
import { makeFakeTenantDb } from '../../../test/helpers/fake-tenant-db.js';

describe('offboarding engine — array kind (SQL)', () => {
  const entry: TransferEntry = { key: 'Fake.watcherIds', moduleCode: 'tasks', label: 'ناظران', model: 'Fake', field: 'watcherIds', kind: 'array', table: 'fakes', column: 'watcherIds', scopeNote: 'تست' };
  afterEach(() => {
    TRANSFERABLE.splice(TRANSFERABLE.indexOf(entry), 1);
  });

  it('replaces the element with the target (dedup) via parameterised SQL, and counts in dry-run without writing', async () => {
    TRANSFERABLE.push(entry);
    const { db } = makeFakeTenantDb();
    const query = vi.fn(async () => [{ n: 3 }]);
    const exec = vi.fn(async () => 3);
    db.$queryRawUnsafe = query;
    db.$executeRawUnsafe = exec;

    const dry = await transferOwnership(db, { fromUserId: 'a', targetFor: () => 'b', now: new Date(), dryRun: true });
    expect(dry.entries.find((e) => e.key === 'Fake.watcherIds')).toMatchObject({ moved: 3 });
    expect(exec).not.toHaveBeenCalled();

    const real = await transferOwnership(db, { fromUserId: 'a', targetFor: () => 'b', now: new Date(), dryRun: false });
    expect(real.entries.find((e) => e.key === 'Fake.watcherIds')).toMatchObject({ moved: 3 });
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, from, to] = exec.mock.calls[0] as unknown as [string, string, string];
    expect(sql).toContain('array_replace');
    expect(sql).toContain('"fakes"');
    expect([from, to]).toEqual(['a', 'b']);

    const owned = await countOwned(db, 'a', new Date());
    expect(owned.find((o) => o.entry === entry)!.count).toBe(3);
  });

  it('unassign removes the element from the array', async () => {
    TRANSFERABLE.push(entry);
    const { db } = makeFakeTenantDb();
    db.$queryRawUnsafe = vi.fn(async () => [{ n: 1 }]);
    const exec = vi.fn(async () => 1);
    db.$executeRawUnsafe = exec;
    const r = await transferOwnership(db, { fromUserId: 'a', targetFor: () => UNASSIGN, now: new Date(), dryRun: false });
    expect(r.entries.find((e) => e.key === 'Fake.watcherIds')).toMatchObject({ unassigned: 1 });
    expect(String((exec.mock.calls[0] as unknown[])[0])).toContain('array_remove');
  });

  it('rejects unsafe identifiers in table/column', async () => {
    const bad = { ...entry, table: 'fakes"; DROP TABLE x; --' };
    TRANSFERABLE.push(bad);
    const { db } = makeFakeTenantDb();
    await expect(countOwned(db, 'a', new Date())).rejects.toThrow('نامعتبر');
    TRANSFERABLE.splice(TRANSFERABLE.indexOf(bad), 1);
    TRANSFERABLE.push(entry); // afterEach حذف می‌کند
  });
});

describe('offboarding engine — cleanup policy', () => {
  it('messenger: groups are left on deactivate, direct chats kept until full delete', async () => {
    const seed = {
      messengerConversation: [{ id: 'g1', type: 'GROUP' }, { id: 'd1', type: 'DIRECT' }],
      messengerMember: [{ id: 'm1', conversationId: 'g1', userId: 'u' }, { id: 'm2', conversationId: 'd1', userId: 'u' }],
      confidentialArchiveAccess: [{ id: 'x', userId: 'u' }],
    };
    const a = makeFakeTenantDb(seed);
    const res = await cleanupPersonal(a.db, { userId: 'u', mode: 'deactivate', dryRun: false });
    expect(a.tables().messengerMember.map((m) => m.id)).toEqual(['m2']);
    expect(res.find((r) => r.key === 'ConfidentialArchiveAccess.userId')).toMatchObject({ action: 'delete', count: 1 }); // دسترسی حساس همیشه لغو می‌شود
    const b = makeFakeTenantDb(seed);
    await cleanupPersonal(b.db, { userId: 'u', mode: 'delete', dryRun: false });
    expect(b.tables().messengerMember).toHaveLength(0);
    const c = makeFakeTenantDb(seed);
    expect(await cleanupPersonal(c.db, { userId: 'u', mode: 'transfer-only', dryRun: false })).toEqual([]);
  });
});
