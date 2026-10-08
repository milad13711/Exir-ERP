import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthService } from './admin-auth.service.js';
import { sealSecret, totpAad } from '../security/app-secrets.js';
import { currentStep, generateTotpSecret, hashRecoveryCode, totpCodeAt } from '../security/totp.js';

const jwt = new JwtService({ secret: 'unit-test-secret-unit-test-secret-1234', signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } });

function makeAdmin(over: Record<string, unknown> = {}): Record<string, any> {
  return {
    id: 'a1', name: 'N', email: 'a@x.ir', team: 'SUPER_ADMIN', isActive: true, passwordHash: bcrypt.hashSync('Correct-Horse-9', 4),
    failedLoginCount: 0, lockedUntil: null, tokenVersion: 0, totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [], ...over,
  };
}

function make(admin: Record<string, any> | null) {
  const state: { admin: Record<string, any> | null } = { admin };
  const adminUser = {
    findFirst: vi.fn().mockImplementation(async () => state.admin),
    findUnique: vi.fn().mockImplementation(async () => state.admin),
    findUniqueOrThrow: vi.fn().mockImplementation(async () => state.admin),
    update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (state.admin) Object.entries(data).forEach(([k, v]) => { state.admin![k] = typeof v === 'object' && v && 'increment' in (v as object) ? state.admin![k] + 1 : v; });
      return state.admin;
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const events = { record: vi.fn() };
  const epoch = { effective: vi.fn().mockImplementation(async (...v: number[]) => 7 + v.reduce((a, b) => a + b, 0)) };
  const svc = new AdminAuthService({ adminUser } as never, jwt, events as never, epoch as never);
  return { svc, adminUser, events, state };
}

describe('AdminAuthService.login', () => {
  beforeEach(() => { process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex'); });

  it('returns a token carrying the session version (tv) and a bounded lifetime', async () => {
    const { svc } = make(makeAdmin());
    const res = (await svc.login('A@x.ir', 'Correct-Horse-9', '1.2.3.4')) as { accessToken: string };
    const payload = jwt.decode(res.accessToken) as { tv: number; exp: number; iat: number; isAdmin: boolean };
    expect(payload.isAdmin).toBe(true);
    expect(payload.tv).toBe(7);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(12 * 3600);
  });

  it('wrong password and unknown e-mail give the same generic message (no enumeration)', async () => {
    const a = make(makeAdmin());
    const b = make(null);
    const e1 = await a.svc.login('a@x.ir', 'nope-nope-nope').catch((e) => e);
    const e2 = await b.svc.login('ghost@x.ir', 'nope-nope-nope').catch((e) => e);
    expect(e1.message).toBe(e2.message);
    expect(e1.getStatus()).toBe(401);
  });

  it('locks the account after 5 consecutive failures and then refuses even the right password', async () => {
    const { svc, state, events } = make(makeAdmin());
    for (let i = 0; i < 5; i++) await svc.login('a@x.ir', 'bad-password-1').catch(() => undefined);
    expect(state.admin!.lockedUntil).toBeInstanceOf(Date);
    const err = await svc.login('a@x.ir', 'Correct-Horse-9').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOGIN_LOCKED' }));
  });
});

describe('AdminAuthService — repository-default credentials', () => {
  it('blocks login in production when the admin still has the published default password', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { svc, events } = make(makeAdmin({ passwordHash: bcrypt.hashSync('ExirAdmin123!', 4) }));
    await expect(svc.login('admin@exir.co', 'ExirAdmin123!')).rejects.toMatchObject({ status: 403 });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONFIG_INSECURE', severity: 'FATAL' }));
    process.env.ADMIN_ALLOW_DEFAULT_PASSWORDS = 'true';
    await expect(svc.login('admin@exir.co', 'ExirAdmin123!')).resolves.toHaveProperty('accessToken');
    delete process.env.ADMIN_ALLOW_DEFAULT_PASSWORDS;
    process.env.NODE_ENV = prev;
  });
});

describe('AdminAuthService — TOTP second factor', () => {
  function withTotp() {
    process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex');
    const secret = generateTotpSecret();
    const admin = makeAdmin({ totpEnabledAt: new Date(), totpSecretEnc: sealSecret(secret, totpAad('admin', 'a1')) });
    return { secret, ...make(admin) };
  }

  it('password alone yields only a challenge token, never an access token', async () => {
    const { svc } = withTotp();
    const res = await svc.login('a@x.ir', 'Correct-Horse-9');
    expect(res).toHaveProperty('requiresTotp', true);
    expect(res).not.toHaveProperty('accessToken');
  });

  it('a valid TOTP completes login; the same code cannot be replayed', async () => {
    const { svc, secret, adminUser, state } = withTotp();
    const ch = (await svc.login('a@x.ir', 'Correct-Horse-9')) as { challengeToken: string };
    const code = totpCodeAt(secret, currentStep());
    const ok = await svc.loginWithTotp(ch.challengeToken, code);
    expect(ok.accessToken).toBeTruthy();
    expect(adminUser.updateMany).toHaveBeenCalled();
    // replay: the DB conditional update reports 0 rows → rejected
    adminUser.updateMany.mockResolvedValueOnce({ count: 0 });
    state.admin!.totpLastStep = currentStep();
    await expect(svc.loginWithTotp(ch.challengeToken, code)).rejects.toMatchObject({ status: 401 });
  });

  it('a wrong code is rejected and counted toward the lockout', async () => {
    const { svc, state, events } = withTotp();
    const ch = (await svc.login('a@x.ir', 'Correct-Horse-9')) as { challengeToken: string };
    await expect(svc.loginWithTotp(ch.challengeToken, '000000')).rejects.toMatchObject({ status: 401 });
    expect(state.admin!.failedLoginCount).toBe(1);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'TOTP_FAILED' }));
  });

  it('a forged/expired challenge token or an access token is not accepted as a challenge', async () => {
    const { svc } = withTotp();
    await expect(svc.loginWithTotp('x'.repeat(40), '123456')).rejects.toMatchObject({ status: 401 });
    const access = await jwt.signAsync({ sub: 'a1', team: 'SUPER_ADMIN', isAdmin: true });
    await expect(svc.loginWithTotp(access, '123456')).rejects.toMatchObject({ status: 401 });
  });

  it('a recovery code logs in once and is consumed', async () => {
    const { svc, adminUser, state } = withTotp();
    const rc = 'abcde-fghjk';
    state.admin!.recoveryCodeHashes = [hashRecoveryCode(rc), hashRecoveryCode('zzzzz-yyyyy')];
    const ch = (await svc.login('a@x.ir', 'Correct-Horse-9')) as { challengeToken: string };
    const ok = await svc.loginWithTotp(ch.challengeToken, rc);
    expect(ok.accessToken).toBeTruthy();
    expect(adminUser.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recoveryCodeHashes: [hashRecoveryCode('zzzzz-yyyyy')] }) }));
  });
});
