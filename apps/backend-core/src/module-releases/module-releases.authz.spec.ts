import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ADMIN_TEAMS_KEY } from '../common/decorators/admin-teams.decorator.js';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AdminModuleReleasesController } from './admin-module-releases.controller.js';
import { ModuleReleasesController } from './module-releases.controller.js';
import { ModuleReleasesTenantService } from './module-releases-tenant.service.js';

vi.mock('../common/module-enabled.util.js', () => ({
  enabledModuleSnapshot: vi.fn(async () => ({ defined: new Set(['sales', 'hr']), enabled: new Set(['sales']) })),
}));
const resolveMock = vi.hoisted(() => vi.fn(async () => 'u1' as string | null));
vi.mock('../common/resolve-tenant-user.js', () => ({ resolveTenantUserId: resolveMock }));

const proto = AdminModuleReleasesController.prototype as unknown as Record<string, object>;
const teamsOf = (m: string) => Reflect.getMetadata(ADMIN_TEAMS_KEY, proto[m]) as string[] | undefined;

describe('admin controller authorization', () => {
  it('is behind the admin JWT guard (admin-only identity, 2FA enrollment and password rules) and the team guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminModuleReleasesController) as unknown[];
    expect(guards).toContain(AdminJwtAuthGuard);
    expect(guards).toContain(AdminTeamsGuard);
  });
  it('every route declares allowed teams; mutating routes exclude SUPPORT/BILLING', () => {
    for (const m of ['meta', 'list', 'get', 'create', 'update', 'remove', 'recipients', 'publish', 'retry', 'testSend', 'report']) expect(teamsOf(m), m).toBeDefined();
    for (const m of ['create', 'update', 'remove', 'publish', 'retry', 'testSend']) expect(teamsOf(m), m).toEqual(['SUPER_ADMIN', 'ENGINEERING']);
    for (const m of ['meta', 'list', 'get', 'recipients', 'report']) expect(teamsOf(m)).not.toContain('BILLING');
  });
});

describe('tenant controller', () => {
  it('requires the tenant JWT guard; settings are OWNER/ADMIN only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ModuleReleasesController)).toContain(JwtAuthGuard);
    const p = ModuleReleasesController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(ROLES_KEY, p.getSettings)).toEqual(['OWNER', 'ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, p.setSettings)).toEqual(['OWNER', 'ADMIN']);
  });
});

describe('tenant visibility (isolation + module semantics)', () => {
  const base = { id: 'r1', shortCode: 'abc', moduleCode: 'sales', version: '1', title: 't', summary: '', publishedAt: new Date(), changes: [{ id: 'c1', type: 'NEW', title: 'x', description: '', valueText: '', deepLink: 'https://evil.com', sortOrder: 0 }] };
  function make(release: Record<string, unknown> | null, testRow: unknown = null) {
    const controlDb: any = {
      moduleDefinition: { findMany: vi.fn(async () => [{ code: 'sales', name: 'فروش' }, { code: 'hr', name: 'منابع انسانی' }]) },
      moduleRelease: { findFirst: vi.fn(async () => release), findMany: vi.fn(async () => []) },
      moduleReleaseDelivery: { findUnique: vi.fn(async () => testRow) },
    };
    const ctx: any = { tenantId: 'T1', auth: { type: 'tenant_user' }, tenantDb: { moduleReleaseRead: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) } } };
    return { svc: new ModuleReleasesTenantService(controlDb), ctx, controlDb };
  }
  it('shows a published release of an enabled module and replaces a stored unsafe deepLink', async () => {
    const { svc, ctx } = make({ ...base, status: 'PUBLISHED' });
    const d = await svc.detail(ctx, 'abc');
    expect(d.moduleName).toBe('فروش');
    expect(d.changes[0].deepLink).toBe('/sales');
  });
  it('404 for a module the tenant does not have (no existence leak)', async () => {
    const { svc, ctx } = make({ ...base, moduleCode: 'hr', status: 'PUBLISHED' });
    await expect(svc.detail(ctx, 'abc')).rejects.toThrow('یافت نشد');
  });
  it('drafts are hidden unless a test-send was made to this very tenant', async () => {
    const hidden = make({ ...base, status: 'DRAFT' });
    await expect(hidden.svc.detail(hidden.ctx, 'abc')).rejects.toThrow('یافت نشد');
    const shown = make({ ...base, status: 'DRAFT' }, { id: 'x' });
    expect((await shown.svc.detail(shown.ctx, 'abc')).isDraftPreview).toBe(true);
  });
  it('API-key sessions cannot use read-state endpoints', async () => {
    resolveMock.mockResolvedValueOnce(null);
    const { svc, ctx } = make({ ...base, status: 'PUBLISHED' });
    await expect(svc.list(ctx)).rejects.toThrow('کلید API');
  });
  it('list only queries the tenant\'s enabled module codes', async () => {
    const { svc, ctx, controlDb } = make(null);
    await svc.list(ctx);
    expect((controlDb.moduleRelease.findMany.mock.calls[0] as any)[0].where.moduleCode.in).toEqual(['sales']);
  });
});
