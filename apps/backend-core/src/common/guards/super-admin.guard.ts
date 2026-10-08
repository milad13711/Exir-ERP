import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** بعد از AdminJwtAuthGuard: فقط تیم SUPER_ADMIN (برخلاف AdminTeamsGuard که تیم‌های دیگر را هم می‌پذیرد). */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.adminCtx?.auth.team !== 'SUPER_ADMIN') {
      throw new ForbiddenException('فقط مدیر ارشد (SUPER_ADMIN) به این عملیات دسترسی دارد');
    }
    return true;
  }
}
