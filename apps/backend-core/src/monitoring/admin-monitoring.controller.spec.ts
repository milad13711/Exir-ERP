import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { ADMIN_TEAMS_KEY } from '../common/decorators/admin-teams.decorator.js';
import { AdminMonitoringController } from './admin-monitoring.controller.js';

const GUARDS_KEY = '__guards__';
const ctx = (team?: string): ExecutionContext =>
  ({
    getHandler: () => AdminMonitoringController.prototype.status,
    getClass: () => AdminMonitoringController,
    switchToHttp: () => ({ getRequest: () => ({ adminCtx: team ? { auth: { team } } : undefined }) }),
  }) as unknown as ExecutionContext;

describe('AdminMonitoringController authz', () => {
  const guard = new AdminTeamsGuard(new Reflector());

  it('is declared SUPER_ADMIN-only and guarded by AdminJwtAuthGuard + AdminTeamsGuard', () => {
    expect(Reflect.getMetadata(ADMIN_TEAMS_KEY, AdminMonitoringController)).toEqual(['SUPER_ADMIN']);
    const guards = (Reflect.getMetadata(GUARDS_KEY, AdminMonitoringController) as { name: string }[]).map((g) => g.name);
    expect(guards).toEqual(['AdminJwtAuthGuard', 'AdminTeamsGuard']);
  });
  it('allows SUPER_ADMIN', () => {
    expect(guard.canActivate(ctx('SUPER_ADMIN'))).toBe(true);
  });
  it.each(['SUPPORT', 'BILLING', 'ENGINEERING'])('denies %s', (team) => {
    expect(() => guard.canActivate(ctx(team))).toThrow(ForbiddenException);
  });
  it('denies a request with no admin context', () => {
    expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException);
  });
});
