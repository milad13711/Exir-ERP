import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { VaultTicketGuard } from './vault-ticket.guard.js';
import type { VaultTicketPayload } from '../../auth/jwt-payload.type.js';

const TENANT_ID = 'tenant-1';
const SUB = 'global-user-1';

function makeExecutionContext(headers: Record<string, string>, ctx: { tenantId: string; auth: { sub: string } } | undefined) {
  const req: any = { headers, ctx };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard(jwtVerify: (token: string) => Promise<VaultTicketPayload>, requireEdit: boolean | undefined) {
  const jwt = { verifyAsync: vi.fn(jwtVerify) } as any;
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(requireEdit) } as any;
  return new VaultTicketGuard(jwt, reflector);
}

describe('VaultTicketGuard', () => {
  it('passes through when req.ctx is not set (JwtAuthGuard did not run first)', async () => {
    const guard = makeGuard(async () => {
      throw new Error('should not be called');
    }, undefined);
    const execCtx = makeExecutionContext({}, undefined);
    await expect(guard.canActivate(execCtx)).resolves.toBe(true);
  });

  it('rejects when the X-Vault-Ticket header is missing', async () => {
    const guard = makeGuard(async () => {
      throw new Error('should not be called');
    }, undefined);
    const execCtx = makeExecutionContext({}, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired/invalid JWT', async () => {
    const guard = makeGuard(async () => {
      throw new Error('invalid token');
    }, undefined);
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'bad' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket issued for a DIFFERENT tenant', async () => {
    const guard = makeGuard(
      async () => ({ type: 'vault_ticket', sub: SUB, tenantId: 'other-tenant', canEdit: true }) as VaultTicketPayload,
      undefined,
    );
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'tok' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket issued for a DIFFERENT user (cannot be replayed cross-account)', async () => {
    const guard = makeGuard(
      async () => ({ type: 'vault_ticket', sub: 'someone-else', tenantId: TENANT_ID, canEdit: true }) as VaultTicketPayload,
      undefined,
    );
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'tok' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a valid view-only ticket on a route that does not require edit', async () => {
    const guard = makeGuard(
      async () => ({ type: 'vault_ticket', sub: SUB, tenantId: TENANT_ID, canEdit: false }) as VaultTicketPayload,
      undefined,
    );
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'tok' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).resolves.toBe(true);
  });

  it('rejects a view-only ticket on a route that requires edit', async () => {
    const guard = makeGuard(
      async () => ({ type: 'vault_ticket', sub: SUB, tenantId: TENANT_ID, canEdit: false }) as VaultTicketPayload,
      true,
    );
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'tok' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an edit-capable ticket on a route that requires edit', async () => {
    const guard = makeGuard(
      async () => ({ type: 'vault_ticket', sub: SUB, tenantId: TENANT_ID, canEdit: true }) as VaultTicketPayload,
      true,
    );
    const execCtx = makeExecutionContext({ 'x-vault-ticket': 'tok' }, { tenantId: TENANT_ID, auth: { sub: SUB } });
    await expect(guard.canActivate(execCtx)).resolves.toBe(true);
  });
});
