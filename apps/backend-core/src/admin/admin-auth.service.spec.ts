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
    failedLoginCount: 0, lockedUntil: null, tokenVersion: 0, mustChangePassword: false, lastLoginAt: null, totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [], ...over,
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
  const auditLog = { create: vi.fn().mockResolvedValue({}) };
  const events = { record: vi.fn() };
  const epoch = { effective: vi.fn().mockImplementation(async (...v: number[]) => 7 + v.reduce((a, b) => a + b, 0)) };
  const svc = new AdminAuthService({ adminUser, auditLog } as never, jwt, events as never, epoch as never);
  return { svc, adminUser, events, state, auditLog };
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
  it('in production a default-password login is allowed but restricted (mustChangePassword, mcp claim) and the flag is persisted', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { svc, events, state, adminUser } = make(makeAdmin({ passwordHash: bcrypt.hashSync('ExirAdmin123!', 4) }));
      const res = (await svc.login('a@x.ir', 'ExirAdmin123!')) as { accessToken: string; mustChangePassword: boolean };
      expect(res.mustChangePassword).toBe(true);
      const payload = jwt.decode(res.accessToken) as { mcp?: boolean; exp: number; iat: number };
      expect(payload.mcp).toBe(true);
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(30 * 60);
      expect(state.admin!.mustChangePassword).toBe(true);
      expect(adminUser.update).toHaveBeenCalledWith(expect.objectContaining({ data: { mustChangePassword: true } }));
      expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONFIG_INSECURE' }));
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('a normal strong password yields an unrestricted token (no mcp claim)', async () => {
    const { svc } = make(makeAdmin());
    const res = (await svc.login('a@x.ir', 'Correct-Horse-9')) as { accessToken: string; mustChangePassword: boolean };
    expect(res.mustChangePassword).toBe(false);
    expect((jwt.decode(res.accessToken) as { mcp?: boolean }).mcp).toBeUndefined();
  });

  it('an admin flagged by a super-admin reset gets a restricted token on any password', async () => {
    const { svc } = make(makeAdmin({ mustChangePassword: true }));
    const res = (await svc.login('a@x.ir', 'Correct-Horse-9')) as { accessToken: string; mustChangePassword: boolean };
    expect(res.mustChangePassword).toBe(true);
    expect((jwt.decode(res.accessToken) as { mcp?: boolean }).mcp).toBe(true);
  });
});

describe('AdminAuthService.changePassword / profile / me', () => {
  const NEW = 'Brand-New-Passw0rd-xyz';

  it('wrong current password is rejected and counts toward the lockout (5 -> 429)', async () => {
    const { svc, state, events } = make(makeAdmin());
    for (let i = 0; i < 5; i++) await expect(svc.changePassword('a1', 'wrong-current-1', NEW)).rejects.toMatchObject({ status: 401 });
    expect(state.admin!.lockedUntil).toBeInstanceOf(Date);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOGIN_LOCKED' }));
    await expect(svc.changePassword('a1', 'Correct-Horse-9', NEW)).rejects.toMatchObject({ status: 429 });
  });

  it('enforces the policy: short, no digit, default, contains e-mail local-part, same as current', async () => {
    const { svc } = make(makeAdmin({ email: 'robert@x.ir', passwordHash: bcrypt.hashSync('Correct-Horse-99', 4) }));
    for (const bad of ['Short1a', 'onlyletterslongenough', 'ExirAdmin123!', 'Robert-Pass-12345', 'Correct-Horse-99']) {
      await expect(svc.changePassword('a1', 'Correct-Horse-99', bad)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('success: new hash (cost 12), flag cleared, tokenVersion bumped, fresh unrestricted token, audit without secrets', async () => {
    const { svc, state, auditLog, events } = make(makeAdmin({ mustChangePassword: true }));
    const res = await svc.changePassword('a1', 'Correct-Horse-9', NEW, '1.2.3.4');
    expect(await bcrypt.compare(NEW, state.admin!.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(state.admin!.passwordHash)).toBe(12);
    expect(state.admin!.mustChangePassword).toBe(false);
    expect(state.admin!.tokenVersion).toBe(1);
    const p = jwt.decode(res.accessToken) as { tv: number; mcp?: boolean };
    expect(p.tv).toBe(7 + 1); // new session version — old tokens (tv 7) are now below the required version
    expect(p.mcp).toBeUndefined();
    expect(res.mustChangePassword).toBe(false);
    const logged = JSON.stringify([auditLog.create.mock.calls, events.record.mock.calls]);
    expect(logged).not.toContain(NEW);
    expect(logged).not.toContain('Correct-Horse-9');
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'admin_user.password_changed' }) }));
  });

  it('profile: name needs no password; e-mail change needs the password, uniqueness, and is audited', async () => {
    const { svc, adminUser, state, auditLog } = make(makeAdmin());
    await svc.updateProfile('a1', { name: 'New Name' });
    expect(state.admin!.name).toBe('New Name');
    await expect(svc.updateProfile('a1', { email: 'new@x.ir' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateProfile('a1', { email: 'new@x.ir', currentPassword: 'bad-bad-bad-1' })).rejects.toMatchObject({ status: 401 });
    adminUser.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(svc.updateProfile('a1', { email: 'taken@x.ir', currentPassword: 'Correct-Horse-9' })).rejects.toMatchObject({ status: 409 });
    adminUser.findFirst.mockResolvedValueOnce(null);
    const me = await svc.updateProfile('a1', { email: 'New@X.ir', currentPassword: 'Correct-Horse-9' });
    expect(me.email).toBe('new@x.ir');
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'admin_user.profile_updated' }) }));
  });

  it('me returns the public fields only', async () => {
    const { svc } = make(makeAdmin({ totpEnabledAt: new Date() }));
    const me = await svc.me('a1');
    expect(me).toMatchObject({ id: 'a1', email: 'a@x.ir', team: 'SUPER_ADMIN', totpEnabled: true, mustChangePassword: false });
    expect(JSON.stringify(me)).not.toContain('passwordHash');
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
