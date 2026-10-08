import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantTwoFactorService } from './tenant-two-factor.service.js';
import { sealSecret, totpAad } from '../security/app-secrets.js';
import { currentStep, generateTotpSecret, hashRecoveryCode, totpCodeAt } from '../security/totp.js';

describe('TenantTwoFactorService', () => {
  let user: Record<string, any>;
  let db: any;
  let svc: TenantTwoFactorService;
  beforeEach(() => {
    process.env.APP_SECRETS_KEY = randomBytes(32).toString('hex');
    user = { id: 'g1', phone: '09121234567', totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] };
    db = {
      globalUser: {
        findUniqueOrThrow: vi.fn().mockImplementation(async () => user),
        findUnique: vi.fn().mockImplementation(async () => user),
        update: vi.fn().mockImplementation(async ({ data }: any) => Object.assign(user, data)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    svc = new TenantTwoFactorService(db, { record: vi.fn() } as never);
  });

  it('setup stores the secret sealed (never plaintext) and enable() issues 10 hashed recovery codes once', async () => {
    const { secret } = await svc.beginSetup('g1');
    expect(user.totpSecretEnc).toMatch(/^enc1:/);
    expect(user.totpSecretEnc).not.toContain(secret);
    await expect(svc.enable('g1', '000000')).rejects.toMatchObject({ status: 400 });
    const { recoveryCodes } = await svc.enable('g1', totpCodeAt(secret, currentStep()));
    expect(recoveryCodes).toHaveLength(10);
    expect(user.totpEnabledAt).toBeInstanceOf(Date);
    expect(user.recoveryCodeHashes).toHaveLength(10);
    expect(JSON.stringify(user)).not.toContain(recoveryCodes[0]);
  });

  it('checkCode accepts a fresh TOTP, rejects garbage, and consumes a recovery code', async () => {
    const secret = generateTotpSecret();
    Object.assign(user, { totpEnabledAt: new Date(), totpSecretEnc: sealSecret(secret, totpAad('user', 'g1')), recoveryCodeHashes: [hashRecoveryCode('abcde-fghjk')] });
    expect(await svc.checkCode('g1', totpCodeAt(secret, currentStep()))).toBe(true);
    expect(await svc.checkCode('g1', '111111')).toBe(false);
    expect(await svc.checkCode('g1', 'abcde-fghjk')).toBe(true);
    expect(db.globalUser.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { recoveryCodeHashes: [] } }));
  });

  it('only OWNER/ADMIN sessions (never API keys) may manage 2FA', () => {
    expect(() => svc.assertCanManage('MEMBER', 'tenant_user')).toThrow();
    expect(() => svc.assertCanManage('OWNER', 'api_key')).toThrow();
    expect(() => svc.assertCanManage('ADMIN', 'tenant_user')).not.toThrow();
  });

  it('refuses to start without APP_SECRETS_KEY (fail-closed)', async () => {
    delete process.env.APP_SECRETS_KEY;
    await expect(svc.beginSetup('g1')).rejects.toMatchObject({ status: 503 });
    expect(user.totpSecretEnc).toBeNull();
  });
});
