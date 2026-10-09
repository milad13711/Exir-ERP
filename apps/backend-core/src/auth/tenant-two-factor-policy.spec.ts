import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AdminSecurityController } from '../admin/admin-security.controller.js';
import { AuthService } from './auth.service.js';
import {
  assertTwoFactorForSensitiveAction,
  effectiveMode,
  evaluateTwoFactor,
  graceDays,
  isAllowedForRestrictedSession,
  wouldBeRestrictedWithout2FA,
} from './tenant-two-factor-policy.js';

const DAY = 86_400_000;
const SECRET = 'unit-test-secret-unit-test-secret-1234';
const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: 3600 }, verifyOptions: { algorithms: ['HS256'] } });

beforeEach(() => {
  delete process.env.TENANT_REQUIRE_2FA_FOR_ADMINS;
  delete process.env.TENANT_2FA_GRACE_DAYS;
});
afterEach(() => {
  delete process.env.TENANT_REQUIRE_2FA_FOR_ADMINS;
  delete process.env.TENANT_2FA_GRACE_DAYS;
});

describe('policy knobs', () => {
  it('defaults to grace / 14 days; env and tenant override resolve in that order', () => {
    expect(effectiveMode()).toBe('grace');
    expect(graceDays()).toBe(14);
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    expect(effectiveMode()).toBe('enforce');
    expect(effectiveMode('off')).toBe('off'); // tenant override wins
    expect(effectiveMode('bogus')).toBe('enforce');
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'nonsense';
    expect(effectiveMode()).toBe('grace');
    process.env.TENANT_2FA_GRACE_DAYS = '30';
    expect(graceDays()).toBe(30);
    process.env.TENANT_2FA_GRACE_DAYS = 'x';
    expect(graceDays()).toBe(14);
  });
});

describe('evaluateTwoFactor', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const base = { authType: 'tenant_user', role: 'OWNER', enrolled: false, now, graceDays: 14 };

  it('off: never required, never restricted', () => {
    expect(evaluateTwoFactor({ ...base, mode: 'off' })).toMatchObject({ required: false, restricted: false });
  });
  it('grace: required with an end date, not restricted before it, restricted after', () => {
    const start = new Date(now.getTime() - 3 * DAY);
    const s = evaluateTwoFactor({ ...base, mode: 'grace', graceStartedAt: start });
    expect(s).toMatchObject({ required: true, enrolled: false, restricted: false, graceEndsAt: new Date(start.getTime() + 14 * DAY).toISOString() });
    expect(evaluateTwoFactor({ ...base, mode: 'grace', graceStartedAt: new Date(now.getTime() - 15 * DAY) }).restricted).toBe(true);
    // clock not started yet: never restricted
    expect(evaluateTwoFactor({ ...base, mode: 'grace', graceStartedAt: null })).toMatchObject({ restricted: false, graceEndsAt: null });
  });
  it('enforce: restricted immediately unless enrolled', () => {
    expect(evaluateTwoFactor({ ...base, mode: 'enforce' }).restricted).toBe(true);
    expect(evaluateTwoFactor({ ...base, mode: 'enforce', enrolled: true })).toMatchObject({ restricted: false, enrolled: true });
  });
  it('admin reset sentinel (epoch) = expired grace', () => {
    expect(evaluateTwoFactor({ ...base, mode: 'grace', graceStartedAt: new Date(0) }).restricted).toBe(true);
  });
  it('MEMBERs and API keys are never affected', () => {
    expect(evaluateTwoFactor({ ...base, mode: 'enforce', role: 'MEMBER' })).toMatchObject({ required: false, restricted: false });
    expect(evaluateTwoFactor({ ...base, mode: 'enforce', authType: 'api_key' })).toMatchObject({ required: false, restricted: false });
  });
  it('wouldBeRestrictedWithout2FA mirrors enforce / expired grace', () => {
    const t = (o: object) => ({ mode: 'grace' as const, required: true, enrolled: true, graceEndsAt: null, restricted: false, ...o });
    expect(wouldBeRestrictedWithout2FA(t({ mode: 'enforce' }))).toBe(true);
    expect(wouldBeRestrictedWithout2FA(t({ graceEndsAt: new Date(Date.now() + DAY).toISOString() }))).toBe(false);
    expect(wouldBeRestrictedWithout2FA(t({ graceEndsAt: new Date(Date.now() - DAY).toISOString() }))).toBe(true);
    expect(wouldBeRestrictedWithout2FA(t({ required: false }))).toBe(false);
  });
});

describe('restricted-session allow-list', () => {
  it('allows only 2FA enrolment, GET /me and logout', () => {
    for (const [m, p] of [['POST', '/api/auth/2fa/setup'], ['POST', '/api/auth/2fa/enable'], ['GET', '/api/auth/2fa/status'], ['GET', '/api/me'], ['GET', '/api/me?x=1'], ['POST', '/api/auth/logout']]) {
      expect(isAllowedForRestrictedSession(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [['GET', '/api/crm/contacts'], ['PATCH', '/api/me/profile'], ['GET', '/api/me/tenants'], ['POST', '/api/me/switch-tenant'], ['GET', '/api/auth/2fa'], ['POST', '/api/auth/2fa/../../users/invite'], ['PUT', '/api/me'], ['GET', '/api/settings/backup/export'], ['GET', '/api/auth/2fastatus']]) {
      expect(isAllowedForRestrictedSession(m, p), `${m} ${p}`).toBe(false);
    }
  });
});

describe('JwtAuthGuard — mandatory 2FA', () => {
  function make(o: { role?: string; enrolled?: boolean; graceStartedAt?: Date | null; tenantPolicy?: string | null } = {}) {
    const tenant = { id: 't1', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd', tokenVersion: 0, twoFactorPolicy: o.tenantPolicy ?? null };
    const membership = { id: 'm1', status: 'ACTIVE', role: o.role ?? 'OWNER', tokenVersion: 0, twoFactorGraceStartedAt: o.graceStartedAt ?? null, globalUser: { totpEnabledAt: o.enrolled ? new Date() : null } };
    const controlDb = {
      tenant: { findUnique: vi.fn().mockResolvedValue(tenant) },
      tenantMembership: { findUnique: vi.fn().mockResolvedValue(membership), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      apiKey: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
    };
    const guard = new JwtAuthGuard(jwt, controlDb as never, { forTenant: vi.fn().mockReturnValue({}) } as never, { effective: vi.fn().mockResolvedValue(0) } as never, { record: vi.fn() } as never);
    return { guard, controlDb };
  }
  const call = async (guard: JwtAuthGuard, path: string, method = 'GET') => {
    const token = await jwt.signAsync({ type: 'tenant_user', sub: 'u1', tenantId: 't1', membershipId: 'm1', role: 'OWNER', tv: 0 });
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, method, path, originalUrl: path, url: path, socket: {} };
    const ok = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never);
    return { ok, ctx: req.ctx as { twoFactor?: { restricted: boolean; required: boolean; graceEndsAt: string | null } } };
  };

  it('grace (default): first sighting starts the clock once, request is allowed everywhere', async () => {
    const { guard, controlDb } = make();
    const { ctx } = await call(guard, '/api/crm/contacts');
    expect(ctx.twoFactor).toMatchObject({ required: true, restricted: false });
    expect(ctx.twoFactor!.graceEndsAt).toBeTruthy();
    expect(controlDb.tenantMembership.updateMany).toHaveBeenCalledWith({ where: { id: 'm1', twoFactorGraceStartedAt: null }, data: { twoFactorGraceStartedAt: expect.any(Date) } });
  });

  it('grace: an already-started clock is not touched; expired grace restricts to the allow-list (everything else 403)', async () => {
    const { guard, controlDb } = make({ graceStartedAt: new Date(Date.now() - 20 * DAY) });
    for (const p of ['/api/auth/2fa/setup', '/api/auth/2fa/enable']) await expect(call(guard, p, 'POST')).resolves.toMatchObject({ ok: true });
    await expect(call(guard, '/api/me')).resolves.toMatchObject({ ok: true });
    for (const [p, m] of [['/api/crm/contacts', 'GET'], ['/api/users/invite', 'POST'], ['/api/settings/backup/export', 'GET'], ['/api/me/switch-tenant', 'POST']] as const) {
      await expect(call(guard, p, m)).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ code: 'TWO_FACTOR_ENROLLMENT_REQUIRED' }) });
    }
    expect(controlDb.tenantMembership.updateMany).not.toHaveBeenCalled();
  });

  it('grace still running: not restricted', async () => {
    const { guard } = make({ graceStartedAt: new Date(Date.now() - 2 * DAY) });
    await expect(call(guard, '/api/crm/contacts')).resolves.toMatchObject({ ok: true });
  });

  it('enforce (env): restricted immediately; enrolled admin passes (enrolment lifts the restriction)', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    await expect(call(make().guard, '/api/crm/contacts')).rejects.toMatchObject({ status: 403 });
    await expect(call(make({ enrolled: true }).guard, '/api/crm/contacts')).resolves.toMatchObject({ ok: true });
  });

  it('per-tenant override beats env (off lifts, enforce tightens)', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    await expect(call(make({ tenantPolicy: 'off' }).guard, '/api/crm/contacts')).resolves.toMatchObject({ ok: true });
    delete process.env.TENANT_REQUIRE_2FA_FOR_ADMINS;
    await expect(call(make({ tenantPolicy: 'enforce' }).guard, '/api/crm/contacts')).rejects.toMatchObject({ status: 403 });
  });

  it('off: no clock, no restriction', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'off';
    const { guard, controlDb } = make();
    await expect(call(guard, '/api/crm/contacts')).resolves.toMatchObject({ ok: true });
    expect(controlDb.tenantMembership.updateMany).not.toHaveBeenCalled();
  });

  it('MEMBER users are unaffected even under enforce', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    await expect(call(make({ role: 'MEMBER' }).guard, '/api/crm/contacts')).resolves.toMatchObject({ ok: true });
  });

  it('API keys are unaffected even under enforce', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    const bcrypt = await import('bcryptjs');
    const { invalidateApiKeyCache } = await import('../api-keys/api-key-verifier.js');
    invalidateApiKeyCache();
    const RAW = 'exir_live_0123456789abcdef0123456789abcdef';
    const { guard, controlDb } = make();
    controlDb.apiKey.findMany.mockResolvedValue([{ id: 'k1', tenantId: 't1', keyHash: bcrypt.hashSync(RAW, 4) }]);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${RAW}` }, method: 'GET', path: '/api/crm/contacts', originalUrl: '/api/crm/contacts', socket: {} };
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never)).resolves.toBe(true);
    expect((req.ctx as { twoFactor?: unknown }).twoFactor).toBeUndefined();
    invalidateApiKeyCache();
  });
});

describe('assertTwoFactorForSensitiveAction', () => {
  const st = (o: object) => ({ mode: 'enforce' as const, required: true, enrolled: false, graceEndsAt: null, restricted: true, ...o });
  it('blocks un-enrolled OWNER/ADMIN under enforce / expired grace', () => {
    expect(() => assertTwoFactorForSensitiveAction({ auth: { type: 'tenant_user', role: 'OWNER' }, twoFactor: st({}) })).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => assertTwoFactorForSensitiveAction({ auth: { type: 'tenant_user', role: 'ADMIN' }, twoFactor: st({ mode: 'grace' }) })).toThrow();
  });
  it('allows enrolled users, running grace, off, members, api keys and missing state', () => {
    const ok = (c: Parameters<typeof assertTwoFactorForSensitiveAction>[0]) => expect(() => assertTwoFactorForSensitiveAction(c)).not.toThrow();
    ok({ auth: { type: 'tenant_user', role: 'OWNER' }, twoFactor: st({ enrolled: true, restricted: false }) });
    ok({ auth: { type: 'tenant_user', role: 'OWNER' }, twoFactor: st({ mode: 'grace', restricted: false }) });
    ok({ auth: { type: 'tenant_user', role: 'OWNER' }, twoFactor: st({ mode: 'off', required: false, restricted: false }) });
    ok({ auth: { type: 'tenant_user', role: 'MEMBER' }, twoFactor: st({}) });
    ok({ auth: { type: 'api_key', role: 'OWNER' }, twoFactor: st({}) });
    ok({ auth: { type: 'tenant_user', role: 'OWNER' } });
  });
});

describe('AuthService — grace clock, restricted token and enrolment', () => {
  function make(o: { role?: string; enrolled?: boolean; graceStartedAt?: Date | null } = {}) {
    const tenant = { id: 't1', slug: 'acme', name: 'A', status: 'ACTIVE', tokenVersion: 0, twoFactorPolicy: null, dbHost: 'h', dbPort: 1, dbName: 'd' };
    const membership = { id: 'm1', tenantId: 't1', globalUserId: 'u1', status: 'ACTIVE', role: o.role ?? 'OWNER', tokenVersion: 0, twoFactorGraceStartedAt: o.graceStartedAt ?? null };
    const user = { id: 'u1', phone: '0912', name: 'n', totpEnabledAt: o.enrolled ? new Date() : null };
    const controlDb = {
      tenant: { findUnique: vi.fn().mockResolvedValue(tenant), findUniqueOrThrow: vi.fn().mockResolvedValue(tenant) },
      tenantMembership: { findUnique: vi.fn().mockResolvedValue(membership), findUniqueOrThrow: vi.fn().mockResolvedValue(membership), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      globalUser: { findUnique: vi.fn().mockResolvedValue(user), findUniqueOrThrow: vi.fn().mockResolvedValue(user), update: vi.fn() },
      invoice: { findFirst: vi.fn() },
    };
    const svc = new AuthService(controlDb as never, {} as never, jwt, {} as never, { record: vi.fn() } as never, { effective: vi.fn().mockResolvedValue(0) } as never, {} as never);
    return { svc, controlDb };
  }
  const decode = (t: string) => jwt.decode(t) as { t2fa?: boolean; exp: number; iat: number };

  it('first login in grace starts the clock; login response exposes twoFactor and a normal token', async () => {
    const { svc, controlDb } = make();
    const res = await (svc as never as { resolveTenantLogin(p: string, s: string, m: boolean): Promise<any> }).resolveTenantLogin('0912', 'acme', true);
    expect(res.twoFactor).toMatchObject({ required: true, enrolled: false, restricted: false });
    expect(res.twoFactor.graceEndsAt).toBeTruthy();
    expect(decode(res.accessToken).t2fa).toBeUndefined();
    expect(controlDb.tenantMembership.updateMany).toHaveBeenCalledTimes(1);
  });

  it('expired grace: short-lived restricted token with t2fa claim', async () => {
    const { svc } = make({ graceStartedAt: new Date(Date.now() - 30 * DAY) });
    const res = await (svc as never as { resolveTenantLogin(p: string, s: string, m: boolean): Promise<any> }).resolveTenantLogin('0912', 'acme', true);
    const d = decode(res.accessToken);
    expect(res.twoFactor.restricted).toBe(true);
    expect(d.t2fa).toBe(true);
    expect(d.exp - d.iat).toBeLessThanOrEqual(30 * 60);
  });

  it('reissueSession after enrolment returns a normal, unrestricted token', async () => {
    process.env.TENANT_REQUIRE_2FA_FOR_ADMINS = 'enforce';
    const { svc } = make({ enrolled: true });
    const s = await svc.reissueSession({ sub: 'u1', tenantId: 't1', membershipId: 'm1' });
    expect(s.twoFactor).toMatchObject({ enrolled: true, restricted: false });
    expect(decode(s.accessToken).t2fa).toBeUndefined();
    expect(decode(s.accessToken).exp - decode(s.accessToken).iat).toBeGreaterThan(30 * 60);
  });

  it('MEMBER login: not required, no clock', async () => {
    const { svc, controlDb } = make({ role: 'MEMBER' });
    const res = await (svc as never as { resolveTenantLogin(p: string, s: string, m: boolean): Promise<any> }).resolveTenantLogin('0912', 'acme', true);
    expect(res.twoFactor).toMatchObject({ required: false, restricted: false });
    expect(controlDb.tenantMembership.updateMany).not.toHaveBeenCalled();
  });
});

describe('AdminSecurityController — reset tenant user 2FA', () => {
  function make(member: unknown = { id: 'm1', role: 'OWNER' }) {
    const controlDb = {
      tenantMembership: { findFirst: vi.fn().mockResolvedValue(member), updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      globalUser: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', totpEnabledAt: new Date() }), update: vi.fn() },
      auditLog: { create: vi.fn() },
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: 't1', twoFactorPolicy: null }), update: vi.fn() },
    };
    const events = { record: vi.fn() };
    return { c: new AdminSecurityController(controlDb as never, {} as never, events as never), controlDb, events };
  }
  const ctx = { auth: { sub: 'admin1', team: 'SUPER_ADMIN', isAdmin: true as const } };

  it('clears 2FA, forces re-enrolment, revokes sessions and writes an audit row with the reason', async () => {
    const { c, controlDb, events } = make();
    const r = await c.resetUserTwoFactor('t1', 'u1', { reason: 'ticket 123, verified by phone' }, ctx);
    expect(r).toEqual({ success: true, sessionsRevoked: 2 });
    expect(controlDb.globalUser.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [] } });
    expect(controlDb.tenantMembership.updateMany).toHaveBeenCalledWith({ where: { globalUserId: 'u1', role: { in: ['OWNER', 'ADMIN'] } }, data: { twoFactorGraceStartedAt: new Date(0) } });
    expect(controlDb.tenantMembership.updateMany).toHaveBeenCalledWith({ where: { globalUserId: 'u1' }, data: { tokenVersion: { increment: 1 } } });
    expect(controlDb.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'admin1', tenantId: 't1', action: 'tenant_user.2fa_reset', entityId: 'u1', metadata: expect.objectContaining({ reason: 'ticket 123, verified by phone' }) }) });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'TOTP_RESET' }));
  });

  it('404s (and changes nothing) when the user is not a member of that tenant', async () => {
    const { c, controlDb } = make(null);
    await expect(c.resetUserTwoFactor('t1', 'u1', { reason: 'xxxxx' }, ctx)).rejects.toMatchObject({ status: 404 });
    expect(controlDb.globalUser.update).not.toHaveBeenCalled();
    expect(controlDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('is SUPER_ADMIN only (guards on the controller) and tenant policy override is audited', async () => {
    const guards = Reflect.getMetadata('__guards__', AdminSecurityController) as Array<{ name: string }>;
    expect(guards.map((g) => g.name)).toEqual(expect.arrayContaining(['AdminJwtAuthGuard', 'SuperAdminGuard']));
    const { c, controlDb } = make();
    await c.setTwoFactorPolicy('t1', { policy: 'enforce' }, ctx);
    expect(controlDb.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { twoFactorPolicy: 'enforce' } });
    expect(controlDb.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'tenant.2fa_policy_changed' }) });
  });
});
