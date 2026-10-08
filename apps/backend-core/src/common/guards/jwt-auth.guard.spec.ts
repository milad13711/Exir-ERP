import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard.js';
import { invalidateApiKeyCache } from '../../api-keys/api-key-verifier.js';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: 3600 }, verifyOptions: { algorithms: ['HS256'] } });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function ctxFor(token: string, path = '/api/crm/contacts') {
  const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, path, originalUrl: path, url: path, socket: { remoteAddress: '127.0.0.1' } };
  return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as never };
}

function makeTenantGuard(over: { epoch?: number; tenantTv?: number; memberTv?: number; membership?: Record<string, unknown> | null; tenantStatus?: string } = {}) {
  const tenant = { id: 't1', slug: 'acme', status: over.tenantStatus ?? 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd', tokenVersion: over.tenantTv ?? 0 };
  const controlDb = {
    tenant: { findUnique: vi.fn().mockResolvedValue(tenant) },
    tenantMembership: { findUnique: vi.fn().mockResolvedValue(over.membership === undefined ? { id: 'm1', status: 'ACTIVE', role: 'MEMBER', tokenVersion: over.memberTv ?? 0 } : over.membership) },
    apiKey: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  };
  const epoch = { effective: vi.fn().mockImplementation(async (...v: number[]) => (over.epoch ?? 0) + v.reduce((a, b) => a + (b ?? 0), 0)) };
  const events = { record: vi.fn() };
  const guard = new JwtAuthGuard(jwt, controlDb as never, { forTenant: vi.fn().mockReturnValue({}) } as never, epoch as never, events as never);
  return { guard, controlDb, events };
}

const userToken = (extra: Record<string, unknown> = {}) => jwt.signAsync({ type: 'tenant_user', sub: 'u1', tenantId: 't1', membershipId: 'm1', role: 'OWNER', ...extra });

describe('JwtAuthGuard — token validation & revocation', () => {
  it('accepts a valid current token and re-reads the role from the membership (demotion applies instantly)', async () => {
    const { guard } = makeTenantGuard({ membership: { id: 'm1', status: 'ACTIVE', role: 'MEMBER', tokenVersion: 0 } });
    const { req, context } = ctxFor(await userToken({ tv: 0 }));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req.ctx as { auth: { role: string } }).auth.role).toBe('MEMBER'); // token said OWNER
  });

  it('rejects a token signed with alg=none', async () => {
    const { guard } = makeTenantGuard();
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ type: 'tenant_user', sub: 'u1', tenantId: 't1', membershipId: 'm1', role: 'OWNER' })}.`;
    await expect(guard.canActivate(ctxFor(none).context)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed with a different HMAC algorithm (algorithm confusion)', async () => {
    const { guard } = makeTenantGuard();
    const head = b64({ alg: 'HS512', typ: 'JWT' });
    const body = b64({ type: 'tenant_user', sub: 'u1', tenantId: 't1', membershipId: 'm1', role: 'OWNER', exp: Math.floor(Date.now() / 1000) + 600 });
    const sig = createHmac('sha512', SECRET).update(`${head}.${body}`).digest('base64url');
    await expect(guard.canActivate(ctxFor(`${head}.${body}.${sig}`).context)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed with another secret and an expired token', async () => {
    const { guard } = makeTenantGuard();
    const other = new JwtService({ secret: 'another-secret-another-secret-12345' });
    await expect(guard.canActivate(ctxFor(await other.signAsync({ type: 'tenant_user', sub: 'u', tenantId: 't1', membershipId: 'm1' })).context)).rejects.toMatchObject({ status: 401 });
    const expired = await jwt.signAsync({ type: 'tenant_user', sub: 'u', tenantId: 't1', membershipId: 'm1' }, { expiresIn: -10 });
    await expect(guard.canActivate(ctxFor(expired).context)).rejects.toMatchObject({ status: 401 });
  });

  it('does not accept helper tickets or admin tokens as a session', async () => {
    const { guard } = makeTenantGuard();
    for (const p of [{ type: 'booking_ticket', phone: '0912', tenantSlug: 'acme' }, { sub: 'a', team: 'SUPER_ADMIN', isAdmin: true }, { type: 'tenant_totp_challenge', phone: '0912', tenantSlug: 'acme' }]) {
      await expect(guard.canActivate(ctxFor(await jwt.signAsync(p)).context)).rejects.toMatchObject({ status: 401 });
    }
  });

  it('global "force logout all" (epoch bump) kills tokens issued before it, but not new ones', async () => {
    const old = await userToken({ tv: 0 });
    const fresh = await userToken({ tv: 3 });
    const { guard } = makeTenantGuard({ epoch: 3 });
    await expect(guard.canActivate(ctxFor(old).context)).rejects.toMatchObject({ status: 401 });
    await expect(guard.canActivate(ctxFor(fresh).context)).resolves.toBe(true);
  });

  it('a legacy token without tv is valid until the first revocation (backward compatible), then invalid', async () => {
    const legacy = await userToken();
    await expect(makeTenantGuard({ epoch: 0 }).guard.canActivate(ctxFor(legacy).context)).resolves.toBe(true);
    await expect(makeTenantGuard({ epoch: 1 }).guard.canActivate(ctxFor(legacy).context)).rejects.toMatchObject({ status: 401 });
  });

  it('per-tenant and per-member revocation', async () => {
    const t = await userToken({ tv: 0 });
    await expect(makeTenantGuard({ tenantTv: 1 }).guard.canActivate(ctxFor(t).context)).rejects.toMatchObject({ status: 401 });
    await expect(makeTenantGuard({ memberTv: 1 }).guard.canActivate(ctxFor(t).context)).rejects.toMatchObject({ status: 401 });
  });

  it('a disabled / removed membership is refused immediately', async () => {
    const t = await userToken({ tv: 0 });
    await expect(makeTenantGuard({ membership: { id: 'm1', status: 'DISABLED', role: 'MEMBER', tokenVersion: 0 } }).guard.canActivate(ctxFor(t).context)).rejects.toMatchObject({ status: 401 });
    await expect(makeTenantGuard({ membership: null }).guard.canActivate(ctxFor(t).context)).rejects.toMatchObject({ status: 401 });
  });

  it('suspended tenants are blocked', async () => {
    await expect(makeTenantGuard({ tenantStatus: 'SUSPENDED' }).guard.canActivate(ctxFor(await userToken({ tv: 0 })).context)).rejects.toMatchObject({ status: 401 });
  });
});

describe('JwtAuthGuard — API keys', () => {
  beforeEach(() => invalidateApiKeyCache());
  const RAW = 'exir_live_0123456789abcdef0123456789abcdef';

  it('verifies via bcrypt once, then serves from a short cache (no bcrypt DoS), and revocation clears the cache', async () => {
    const { guard, controlDb } = makeTenantGuard();
    controlDb.apiKey.findMany.mockResolvedValue([{ id: 'k1', tenantId: 't1', keyHash: bcrypt.hashSync(RAW, 4) }]);
    await expect(guard.canActivate(ctxFor(RAW).context)).resolves.toBe(true);
    await expect(guard.canActivate(ctxFor(RAW).context)).resolves.toBe(true);
    expect(controlDb.apiKey.findMany).toHaveBeenCalledTimes(1);
    invalidateApiKeyCache();
    controlDb.apiKey.findMany.mockResolvedValue([]); // revoked
    await expect(guard.canActivate(ctxFor(RAW).context)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unknown key and records a security event', async () => {
    const { guard, events } = makeTenantGuard();
    await expect(guard.canActivate(ctxFor('exir_live_ffffffffffffffffffffffffffffffff').context)).rejects.toMatchObject({ status: 401 });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'API_KEY_AUTH_FAILED' }));
  });
});

describe('AdminJwtAuthGuard', () => {
  function make(over: { epoch?: number; admin?: Record<string, unknown> | null } = {}) {
    const admin = over.admin === undefined ? { id: 'a1', isActive: true, tokenVersion: 0, totpEnabledAt: null } : over.admin;
    const guard = new AdminJwtAuthGuard(jwt, { adminUser: { findUnique: vi.fn().mockResolvedValue(admin) } } as never, { effective: vi.fn().mockImplementation(async (v: number) => (over.epoch ?? 0) + (v ?? 0)) } as never);
    return guard;
  }
  const adminToken = (extra: Record<string, unknown> = {}) => jwt.signAsync({ sub: 'a1', team: 'SUPER_ADMIN', isAdmin: true, ...extra });

  it('accepts a valid admin token; rejects tenant tokens, alg none, revoked epoch and inactive admins', async () => {
    await expect(make().canActivate(ctxFor(await adminToken({ tv: 0 })).context)).resolves.toBe(true);
    await expect(make().canActivate(ctxFor(await jwt.signAsync({ type: 'tenant_user', sub: 'u', tenantId: 't1', membershipId: 'm1' })).context)).rejects.toMatchObject({ status: 401 });
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'a1', team: 'SUPER_ADMIN', isAdmin: true })}.`;
    await expect(make().canActivate(ctxFor(none).context)).rejects.toMatchObject({ status: 401 });
    await expect(make({ epoch: 2 }).canActivate(ctxFor(await adminToken({ tv: 1 })).context)).rejects.toMatchObject({ status: 401 });
    await expect(make({ admin: { id: 'a1', isActive: false, tokenVersion: 0 } }).canActivate(ctxFor(await adminToken({ tv: 0 })).context)).rejects.toMatchObject({ status: 401 });
  });

  it('ADMIN_REQUIRE_TOTP: an admin without 2FA can only reach the 2FA enrolment endpoints', async () => {
    process.env.ADMIN_REQUIRE_TOTP = 'true';
    const t = await adminToken({ tv: 0 });
    await expect(make().canActivate(ctxFor(t, '/api/admin/tenants').context)).rejects.toMatchObject({ status: 403 });
    await expect(make().canActivate(ctxFor(t, '/api/admin/auth/2fa/setup').context)).resolves.toBe(true);
    delete process.env.ADMIN_REQUIRE_TOTP;
  });
});
