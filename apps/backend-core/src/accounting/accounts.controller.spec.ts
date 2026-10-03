import { describe, expect, it, vi } from 'vitest';
import { AccountsController } from './accounts.controller.js';

const perms = { assertEdit: vi.fn(), assertDelete: vi.fn() } as any;

function makeCtx(account: any, over: Record<string, any> = {}) {
  const tenantDb = {
    account: {
      findUnique: vi.fn(async ({ where }: any) => (where.id ? account : over.codeOwner ?? null)),
      update: vi.fn(async ({ data }: any) => ({ ...account, ...data })),
      delete: vi.fn(),
    },
    journalLine: { count: vi.fn(async () => over.lines ?? 0) },
    budgetLine: { count: vi.fn(async () => over.budgetLines ?? 0) },
    bankStatementLine: { count: vi.fn(async () => over.statementLines ?? 0) },
  };
  return { tenantDb } as any;
}

const base = { id: 'a1', code: '6010', name: 'هزینه', type: 'EXPENSE', isCashAccount: false, isSystem: false };

describe('AccountsController.update', () => {
  const c = new AccountsController(perms);

  it('renames a custom account', async () => {
    const ctx = makeCtx(base);
    const r = await c.update('a1', { name: 'هزینه اداری' }, ctx);
    expect(r.name).toBe('هزینه اداری');
  });

  it('refuses to change the code of a system account', async () => {
    await expect(c.update('a1', { code: '9999' }, makeCtx({ ...base, isSystem: true }))).rejects.toThrow(/پیش‌فرض/);
  });

  it('refuses a duplicate code', async () => {
    await expect(c.update('a1', { code: '7000' }, makeCtx(base, { codeOwner: { id: 'other' } }))).rejects.toThrow(/وجود دارد/);
  });

  it('refuses to change type of an account with posted lines', async () => {
    await expect(c.update('a1', { type: 'ASSET' }, makeCtx(base, { lines: 3 }))).rejects.toThrow(/نوع/);
  });

  it('allows a type change when the account has no lines', async () => {
    const r = await c.update('a1', { type: 'ASSET' }, makeCtx(base));
    expect(r.type).toBe('ASSET');
  });

  it('refuses to change type of a system account', async () => {
    await expect(c.update('a1', { type: 'ASSET' }, makeCtx({ ...base, isSystem: true }))).rejects.toThrow(/پیش‌فرض/);
  });
});

describe('AccountsController.remove', () => {
  const c = new AccountsController(perms);

  it('deletes an unused custom account', async () => {
    const ctx = makeCtx(base);
    await expect(c.remove('a1', ctx)).resolves.toEqual({ success: true });
    expect(ctx.tenantDb.account.delete).toHaveBeenCalled();
  });

  it('refuses system accounts', async () => {
    await expect(c.remove('a1', makeCtx({ ...base, isSystem: true }))).rejects.toThrow(/پیش‌فرض/);
  });

  it.each([['lines'], ['budgetLines'], ['statementLines']])('refuses when used (%s)', async (k) => {
    await expect(c.remove('a1', makeCtx(base, { [k]: 1 }))).rejects.toThrow(/استفاده/);
  });
});
