import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import type { TenantAuthPayload, TenantJwtPayload } from '../../auth/jwt-payload.type.js';
import { API_KEY_PREFIX, API_KEY_LOOKUP_PREFIX_LENGTH } from '../../api-keys/api-key.constants.js';

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/**
 * Verifies a tenant-scoped access token, then resolves that tenant's own
 * database connection and attaches a ready-to-use Prisma client for it to
 * the request as `req.ctx.tenantDb` — every tenant-scoped controller reads
 * from `req.ctx`, never from a raw tenantId a client could tamper with.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedException('توکن ورود یافت نشد');

    const payload = token.startsWith(API_KEY_PREFIX)
      ? await this.verifyApiKey(token)
      : await this.verifyUserToken(token);

    const tenant = await this.controlDb.tenant.findUnique({
      where: { id: payload.tenantId },
    });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new UnauthorizedException('دسترسی به این محیط کاری غیرفعال شده است');
    }

    const tenantDb = this.tenantPrisma.forTenant({
      dbHost: tenant.dbHost,
      dbPort: tenant.dbPort,
      dbName: tenant.dbName,
    });

    req.ctx = {
      auth: payload,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantDb,
    };
    return true;
  }

  private async verifyUserToken(token: string): Promise<TenantAuthPayload> {
    let payload: TenantJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<TenantJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده است، دوباره وارد شوید');
    }
    if (payload.type !== 'tenant_user' || !payload.tenantId) {
      throw new UnauthorizedException('این نشست برای محیط کاری معتبر نیست، دوباره وارد شوید');
    }
    return payload;
  }

  private async verifyApiKey(token: string): Promise<TenantAuthPayload> {
    const prefix = token.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    const candidates = await this.controlDb.apiKey.findMany({
      where: { keyPrefix: prefix, revokedAt: null },
    });

    for (const candidate of candidates) {
      if (await bcrypt.compare(token, candidate.keyHash)) {
        await this.controlDb.apiKey
          .update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {}); // best-effort — never fail auth over this bookkeeping write
        return { type: 'api_key', sub: candidate.id, tenantId: candidate.tenantId, role: 'OWNER' };
      }
    }
    throw new UnauthorizedException('کلید API نامعتبر یا غیرفعال است');
  }
}
