import { describe, expect, it, vi } from 'vitest';
import { TenantDbAdminService } from './tenant-db-admin.service.js';

describe('TenantDbAdminService.createDatabase (legacy mode)', () => {
  it('revokes PUBLIC access right after CREATE DATABASE, so isolated tenant roles can never connect to a new tenant DB', async () => {
    const queries: string[] = [];
    const pool = { query: vi.fn(async (sql: string) => { queries.push(sql); return {}; }), end: vi.fn(async () => undefined) };
    const svc = new TenantDbAdminService();
    (svc as unknown as { adminPool: () => unknown }).adminPool = () => pool;

    await svc.createDatabase('postgres', 5432, 'exir_tenant_newco');

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('CREATE DATABASE "exir_tenant_newco"');
    expect(queries[1]).toBe('REVOKE ALL ON DATABASE "exir_tenant_newco" FROM PUBLIC');
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('still closes the pool when the revoke fails, and rejects unsafe database names before touching Postgres', async () => {
    const pool = { query: vi.fn(async (sql: string) => { if (sql.startsWith('REVOKE')) throw new Error('boom'); return {}; }), end: vi.fn(async () => undefined) };
    const svc = new TenantDbAdminService();
    (svc as unknown as { adminPool: () => unknown }).adminPool = () => pool;
    await expect(svc.createDatabase('postgres', 5432, 'exir_tenant_x')).rejects.toThrow('boom');
    expect(pool.end).toHaveBeenCalledTimes(1);

    const pool2 = { query: vi.fn(), end: vi.fn() };
    (svc as unknown as { adminPool: () => unknown }).adminPool = () => pool2;
    await expect(svc.createDatabase('postgres', 5432, 'x"; DROP DATABASE postgres; --')).rejects.toThrow();
    expect(pool2.query).not.toHaveBeenCalled();
  });
});
