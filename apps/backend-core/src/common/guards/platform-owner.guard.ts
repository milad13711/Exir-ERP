import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRequestContext } from '../request-context.js';

export function platformTenantSlug(): string {
  return (process.env.PLATFORM_TENANT_SLUG || 'eta').trim();
}

/**
 * True only for a real signed-in user (never an API key) of the PARENT
 * (platform) tenant whose role is OWNER or ADMIN. Pure so /platform/me and the
 * guard can never disagree.
 */
export function isPlatformOwnerContext(ctx: TenantRequestContext | undefined): boolean {
  if (!ctx) return false;
  if (ctx.auth.type !== 'tenant_user') return false;
  if (ctx.tenantSlug !== platformTenantSlug()) return false;
  return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
}

/** Runs AFTER JwtAuthGuard (needs req.ctx). Security-critical: every other tenant gets 403. */
@Injectable()
export class PlatformOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!isPlatformOwnerContext(req.ctx)) {
      throw new ForbiddenException('دسترسی لازم برای این بخش را ندارید');
    }
    return true;
  }
}
