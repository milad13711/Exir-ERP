import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRequestContext, AdminRequestContext } from '../request-context.js';

/** Injects the tenant-scoped request context set by JwtAuthGuard. */
export const Ctx = createParamDecorator(
  (_: unknown, exec: ExecutionContext): TenantRequestContext => {
    const req = exec.switchToHttp().getRequest<Request>();
    return req.ctx!;
  },
);

/** Injects the internal-staff request context set by AdminJwtAuthGuard. */
export const AdminCtx = createParamDecorator(
  (_: unknown, exec: ExecutionContext): AdminRequestContext => {
    const req = exec.switchToHttp().getRequest<Request>();
    return req.adminCtx!;
  },
);
