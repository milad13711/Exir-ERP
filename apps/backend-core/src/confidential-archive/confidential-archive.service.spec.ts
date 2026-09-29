import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfidentialArchiveService } from './confidential-archive.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

const USER_PHONE = '09120000000';
const USER_ID = 'user-1';
const GLOBAL_USER_ID = 'global-user-1';
const TENANT_ID = 'tenant-1';

function makeCtx(role: 'OWNER' | 'ADMIN' | 'MEMBER', overrides: Partial<TenantRequestContext['tenantDb']> = {}) {
  const tenantDb = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: USER_ID, phone: USER_PHONE, name: 'کاربر تست' }),
    },
    confidentialArchiveAccess: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as unknown as TenantRequestContext['tenantDb'];

  const ctx = {
    auth: { type: 'tenant_user', sub: GLOBAL_USER_ID, tenantId: TENANT_ID, role, membershipId: 'm1' },
    tenantId: TENANT_ID,
    tenantSlug: 'demo',
    tenantDb,
  } as unknown as TenantRequestContext;

  return ctx;
}

function makeService(otpRow: { codeHash: string; attempts: number } | null) {
  const controlDb = {
    otpCode: {
      findFirst: vi.fn().mockResolvedValue(
        otpRow
          ? { id: 'otp-1', codeHash: otpRow.codeHash, attempts: otpRow.attempts, expiresAt: new Date(Date.now() + 60_000), consumedAt: null }
          : null,
      ),
      update: vi.fn().mockResolvedValue(undefined),
    },
  } as any;

  const jwt = {
    signAsync: vi.fn().mockResolvedValue('signed.jwt.ticket'),
  } as any;

  const auth = {} as any; // requestVaultOtp not exercised here

  const service = new ConfidentialArchiveService(controlDb, auth, jwt);
  return { service, controlDb, jwt };
}

describe('ConfidentialArchiveService.verifyVaultOtp', () => {
  it('rejects a wrong code and increments attempts, without ever checking the grant', async () => {
    const codeHash = await bcrypt.hash('1234', 10);
    const { service, controlDb } = makeService({ codeHash, attempts: 0 });
    const ctx = makeCtx('MEMBER');

    await expect(service.verifyVaultOtp(ctx, '9999')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(controlDb.otpCode.update).toHaveBeenCalledWith({ where: { id: 'otp-1' }, data: { attempts: { increment: 1 } } });
    expect((ctx.tenantDb as any).confidentialArchiveAccess.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when there is no OTP row at all (expired/never requested)', async () => {
    const { service } = makeService(null);
    const ctx = makeCtx('MEMBER');
    await expect(service.verifyVaultOtp(ctx, '1234')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a CORRECT code for a non-manager with no access grant — OTP alone is never enough', async () => {
    const codeHash = await bcrypt.hash('1234', 10);
    const { service } = makeService({ codeHash, attempts: 0 });
    const ctx = makeCtx('MEMBER'); // confidentialArchiveAccess.findUnique defaults to null

    await expect(service.verifyVaultOtp(ctx, '1234')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('issues a vault ticket with canEdit=true for OWNER even without an explicit grant row', async () => {
    const codeHash = await bcrypt.hash('1234', 10);
    const { service, jwt } = makeService({ codeHash, attempts: 0 });
    const ctx = makeCtx('OWNER');

    const result = await service.verifyVaultOtp(ctx, '1234');
    expect(result.canEdit).toBe(true);
    expect(result.vaultTicket).toBe('signed.jwt.ticket');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { type: 'vault_ticket', sub: GLOBAL_USER_ID, tenantId: TENANT_ID, canEdit: true },
      { expiresIn: 25 * 60 },
    );
  });

  it('issues a view-only vault ticket for a MEMBER granted view-only access', async () => {
    const codeHash = await bcrypt.hash('1234', 10);
    const { service } = makeService({ codeHash, attempts: 0 });
    const ctx = makeCtx('MEMBER', {
      confidentialArchiveAccess: { findUnique: vi.fn().mockResolvedValue({ userId: USER_ID, canEdit: false }) },
    } as any);

    const result = await service.verifyVaultOtp(ctx, '1234');
    expect(result.canEdit).toBe(false);
  });

  it('issues an edit-capable vault ticket for a MEMBER granted canEdit access', async () => {
    const codeHash = await bcrypt.hash('1234', 10);
    const { service } = makeService({ codeHash, attempts: 0 });
    const ctx = makeCtx('MEMBER', {
      confidentialArchiveAccess: { findUnique: vi.fn().mockResolvedValue({ userId: USER_ID, canEdit: true }) },
    } as any);

    const result = await service.verifyVaultOtp(ctx, '1234');
    expect(result.canEdit).toBe(true);
  });
});
