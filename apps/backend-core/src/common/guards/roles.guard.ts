import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { TenantRole } from '../../../generated/control-client/index.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/** Runs after JwtAuthGuard — reads the tenant role JwtAuthGuard already put on req.ctx. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const role = req.ctx?.auth.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('دسترسی لازم برای این عملیات را ندارید');
    }
    return true;
  }
}
