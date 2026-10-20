import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { OffboardingController } from './offboarding.controller.js';

function make() {
  const svc = {
    preview: vi.fn().mockResolvedValue({ ok: 'preview' }),
    dryRun: vi.fn().mockResolvedValue({ ok: 'dry' }),
    offboard: vi.fn().mockResolvedValue({ ok: 'real' }),
    buildRunCsv: vi.fn().mockResolvedValue('csv'),
  };
  return { svc, controller: new OffboardingController(svc as never) };
}
const ctx = { auth: { type: 'tenant_user', role: 'OWNER' } } as never;

describe('OffboardingController', () => {
  it('is JWT + role guarded and limited to OWNER/ADMIN at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OffboardingController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, OffboardingController)).toEqual(['OWNER', 'ADMIN']);
  });

  it('RolesGuard rejects a MEMBER for these routes', () => {
    const reflector = { getAllAndOverride: () => ['OWNER', 'ADMIN'] };
    const guard = new RolesGuard(reflector as never);
    const http = { getRequest: () => ({ ctx: { auth: { role: 'MEMBER' } } }) };
    expect(() => guard.canActivate({ getHandler: () => null, getClass: () => null, switchToHttp: () => http } as never)).toThrow(ForbiddenException);
  });

  it('routes the mode query to the preview, defaulting to deactivate', async () => {
    const { svc, controller } = make();
    await controller.preview('u1', undefined, ctx);
    await controller.preview('u1', 'delete', ctx);
    await controller.preview('u1', 'transfer-only', ctx);
    await controller.preview('u1', 'garbage', ctx);
    expect(svc.preview.mock.calls.map((c) => c[2])).toEqual(['deactivate', 'delete', 'transfer-only', 'deactivate']);
  });

  it('dry-run and csv are read-only paths; offboard delegates after the 2FA check', async () => {
    const { svc, controller } = make();
    await controller.dryRun('u1', { transferToUserId: 'u2' }, ctx);
    expect(svc.dryRun).toHaveBeenCalledWith(ctx, 'u1', { transferToUserId: 'u2' });
    await expect(controller.runCsv('r1', ctx)).resolves.toBe('csv');
    await controller.offboard('u1', { transferToUserId: 'u2', mode: 'deactivate' }, ctx);
    expect(svc.offboard).toHaveBeenCalledWith(ctx, 'u1', { transferToUserId: 'u2', mode: 'deactivate' });
  });

  it('refuses to offboard when mandatory 2FA is not enrolled', async () => {
    const { svc, controller } = make();
    const restricted = { auth: { type: 'tenant_user', role: 'OWNER' }, twoFactor: { enrolled: false, mode: 'enforce', restricted: true } } as never;
    expect(() => controller.offboard('u1', {}, restricted)).toThrow();
    expect(svc.offboard).not.toHaveBeenCalled();
  });
});
