import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { flushApiKeyUsage, invalidateApiKeyCache } from '../../api-keys/api-key-verifier.js';
import { API_KEY_SELF_SCOPED_KEY } from '../decorators/api-key-self-scoped.decorator.js';
import { HUMAN_ONLY_KEY, API_KEY_ALLOWED_KEY } from '../decorators/human-only.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator.js';

const RAW = 'exir_live_0123456789abcdef0123456789abcdef';
const jwt = new JwtService({ secret: 'unit-test-secret-unit-test-secret-1234' });

function setup(key: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  const row = { id: 'k1', tenantId: 't1', keyHash: bcrypt.hashSync(RAW, 4), scopes: [], ipAllowlist: [], expiresAt: null, ...key };
  const controlDb = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 't1', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd', tokenVersion: 0 }) },
    tenantMembership: { findUnique: vi.fn() },
    apiKey: { findMany: vi.fn().mockResolvedValue([row]), update: vi.fn().mockResolvedValue({}) },
  };
  const events = { record: vi.fn() };
  const reflector = { getAllAndOverride: vi.fn((k: string) => meta[k]) };
  const guard = new JwtAuthGuard(jwt, controlDb as never, { forTenant: vi.fn().mockReturnValue({}) } as never, { effective: vi.fn() } as never, events as never, reflector as never);
  const run = (method: string, ip = '127.0.0.1', path = '/api/x') => {
    const req: Record<string, unknown> = {
      method,
      headers: { authorization: `Bearer ${RAW}` },
      path,
      originalUrl: path,
      url: path,
      socket: { remoteAddress: ip },
    };
    const context = { getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => req }) } as never;
    return { req, promise: guard.canActivate(context) };
  };
  return { run, controlDb, events };
}

describe('JwtAuthGuard — API key scopes matrix', () => {
  beforeEach(() => invalidateApiKeyCache());

  it('legacy key (no scopes): unchanged — can POST', async () => {
    const { run } = setup();
    await expect(run('POST').promise).resolves.toBe(true);
  });

  it('read-only key: GET ok, every write method 403 with a Persian message', async () => {
    const { run } = setup({ scopes: ['read'] });
    await expect(run('GET').promise).resolves.toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await expect(run(m).promise).rejects.toMatchObject({ status: 403 });
      await expect(run(m).promise).rejects.toThrow('فقط‌خواندنی');
    }
  });

  it('write key may POST; propose-only key may not use REST writes', async () => {
    await expect(setup({ scopes: ['read', 'propose', 'write'] }).run('POST').promise).resolves.toBe(true);
    invalidateApiKeyCache();
    await expect(setup({ scopes: ['read', 'propose'] }).run('POST').promise).rejects.toMatchObject({ status: 403 });
  });

  it('self-scoped route (/mcp) is exempt from the REST write rule and the module restriction', async () => {
    const { run } = setup({ scopes: ['read', 'module:crm'] }, { [API_KEY_SELF_SCOPED_KEY]: true, [REQUIRE_MODULE_KEY]: 'mcp' });
    await expect(run('POST').promise).resolves.toBe(true);
  });

  it('module scope: allowed module passes, other module and module-less routes are denied (fail-closed)', async () => {
    const scopes = ['read', 'module:crm'];
    await expect(setup({ scopes }, { [REQUIRE_MODULE_KEY]: 'crm' }).run('GET').promise).resolves.toBe(true);
    await expect(setup({ scopes }, { [REQUIRE_MODULE_KEY]: 'sales' }).run('GET').promise).rejects.toMatchObject({ status: 403 });
    await expect(setup({ scopes }, {}).run('GET').promise).rejects.toMatchObject({ status: 403 });
  });

  it('expired key and disallowed IP both give the SAME generic 401 (no oracle)', async () => {
    const expired = await setup({ expiresAt: new Date(Date.now() - 1000) }).run('GET').promise.catch((e) => e);
    invalidateApiKeyCache();
    const badIp = await setup({ ipAllowlist: ['10.0.0.0/8'] }).run('GET', '8.8.8.8').promise.catch((e) => e);
    invalidateApiKeyCache();
    const unknown = await (async () => {
      const s = setup();
      s.controlDb.apiKey.findMany.mockResolvedValue([]);
      return s.run('GET').promise.catch((e) => e);
    })();
    expect(expired.getStatus()).toBe(401);
    expect(badIp.getStatus()).toBe(401);
    expect(expired.message).toBe(badIp.message);
    expect(expired.message).toBe(unknown.message);
  });

  it('allowed IP passes; expiry is re-checked on cache hits', async () => {
    const s = setup({ ipAllowlist: ['10.0.0.0/8'], expiresAt: new Date(Date.now() + 10_000) });
    await expect(s.run('GET', '10.2.3.4').promise).resolves.toBe(true);
    const real = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(real + 11_000); // cache TTL (30s) still valid, key expiry (10s) passed
    try {
      await expect(s.run('GET', '10.2.3.4').promise).rejects.toMatchObject({ status: 401 });
    } finally {
      spy.mockRestore();
    }
  });

  it('attaches scopes to the auth context and batches usage writes (no update per request)', async () => {
    await flushApiKeyUsage(); // drop counters accumulated by earlier tests
    const s = setup({ scopes: ['read'] });
    const a = s.run('GET');
    await a.promise;
    expect((a.req.ctx as { auth: { scopes: string[] } }).auth.scopes).toEqual(['read']);
    await s.run('GET').promise;
    await s.run('GET').promise;
    expect(s.controlDb.apiKey.update).not.toHaveBeenCalled();
    await flushApiKeyUsage();
    expect(s.controlDb.apiKey.update).toHaveBeenCalledTimes(1);
    expect(s.controlDb.apiKey.update.mock.calls[0][0].data.useCount).toEqual({ increment: 3 });
  });
});

describe('JwtAuthGuard — privilege-escalation routes are human-only for EVERY key', () => {
  beforeEach(() => invalidateApiKeyCache());
  const keys: Array<[string, string[]]> = [['legacy', []], ['read', ['read']], ['propose', ['read', 'propose']], ['write', ['read', 'propose', 'write']]];
  const routes: Array<[string, string, string]> = [
    ['POST', '/api/users/invite', 'invite'],
    ['PUT', '/api/users/u1/management-role', 'management-role'],
    ['PUT', '/api/roles/r1/permissions', 'role perms'],
    ['POST', '/api/roles', 'roles'],
    ['POST', '/api/settings/webhooks', 'webhooks'],
    ['GET', '/api/settings/webhooks', 'webhooks list'],
    ['PUT', '/api/sync/policy', 'sync policy'],
    ['GET', '/api/licenses/current', 'licensing'],
    ['GET', '/api/security/events', 'security'],
    ['POST', '/api/settings/api-keys', 'api keys'],
    ['POST', '/api/ai-actions/x/approve', 'approve'],
    ['GET', '/api/ai-actions', 'ai-actions list'],
  ];
  for (const [kname, scopes] of keys) {
    for (const [method, path, label] of routes) {
      it(`${kname} key → 403 on ${method} ${label}`, async () => {
        invalidateApiKeyCache();
        await expect(setup({ scopes }).run(method, '127.0.0.1', path).promise).rejects.toMatchObject({ status: 403 });
      });
    }
  }

  it('Persian message', async () => {
    await expect(setup({ scopes: [] }).run('POST', '127.0.0.1', '/api/users/invite').promise).rejects.toThrow('فقط با ورود کاربر');
  });

  it('@HumanOnly and role-gated routes are denied; @ApiKeyAllowed opts a role-gated route back in; normal REST still works for legacy keys', async () => {
    await expect(setup({ scopes: [] }, { [HUMAN_ONLY_KEY]: true }).run('GET', '127.0.0.1', '/api/anything').promise).rejects.toMatchObject({ status: 403 });
    await expect(setup({ scopes: [] }, { [ROLES_KEY]: ['OWNER'] }).run('GET', '127.0.0.1', '/api/anything').promise).rejects.toMatchObject({ status: 403 });
    invalidateApiKeyCache();
    await expect(setup({ scopes: [] }, { [ROLES_KEY]: ['OWNER'], [API_KEY_ALLOWED_KEY]: true }).run('GET', '127.0.0.1', '/api/anything').promise).resolves.toBe(true);
    invalidateApiKeyCache();
    await expect(setup({ scopes: [] }).run('POST', '127.0.0.1', '/api/crm/contacts').promise).resolves.toBe(true);
    invalidateApiKeyCache();
    await expect(setup({ scopes: ['read'] }).run('GET', '127.0.0.1', '/api/crm/contacts').promise).resolves.toBe(true);
    invalidateApiKeyCache();
    await expect(setup({ scopes: ['read', 'propose'] }, { [API_KEY_SELF_SCOPED_KEY]: true }).run('POST', '127.0.0.1', '/api/mcp').promise).resolves.toBe(true);
  });
});
