import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { StaffTeam } from '../../../generated/control-client/index.js';
import { ADMIN_TEAMS_KEY } from '../decorators/admin-teams.decorator.js';

/** Runs after AdminJwtAuthGuard. SUPER_ADMIN always passes, regardless of the route's teams. */
@Injectable()
export class AdminTeamsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffTeam[]>(ADMIN_TEAMS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const team = req.adminCtx?.auth.team;
    if (team === 'SUPER_ADMIN') return true;
    if (!team || !required.includes(team as StaffTeam)) {
      throw new ForbiddenException('دسترسی لازم برای این عملیات را ندارید');
    }
    return true;
  }
}
