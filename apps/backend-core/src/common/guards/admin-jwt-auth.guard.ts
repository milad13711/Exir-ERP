import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import type { AdminJwtPayload } from '../../auth/jwt-payload.type.js';

/**
 * Verifies an internal-staff (management team) token. Completely separate
 * identity space from tenant users — an AdminUser can never sign in as a
 * tenant, and a tenant user's token is never accepted here.
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('توکن ورود یافت نشد');
    }
    const token = header.slice('Bearer '.length);

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده است، دوباره وارد شوید');
    }
    if (!payload.isAdmin) throw new UnauthorizedException();

    const admin = await this.controlDb.adminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('حساب کارشناسی شما غیرفعال است');
    }

    req.adminCtx = { auth: payload };
    return true;
  }
}
