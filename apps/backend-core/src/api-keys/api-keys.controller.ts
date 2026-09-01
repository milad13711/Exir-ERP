import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import { API_KEY_PREFIX, API_KEY_LOOKUP_PREFIX_LENGTH } from './api-key.constants.js';

/**
 * API keys are the credential for everything under "API، وب‌هوک و MCP":
 * REST API calls (same JwtAuthGuard, just a different token shape — see
 * jwt-auth.guard.ts) and MCP client connections both authenticate with one
 * of these. Webhook *delivery* itself doesn't need a key (the tenant's own
 * receiving server is what gets called), only managing the subscriptions
 * does — same as any other settings write.
 */
@Controller('settings/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
export class ApiKeysController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.controlDb.apiKey.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateApiKeyDto, @Ctx() ctx: TenantRequestContext) {
    const rawKey = API_KEY_PREFIX + randomBytes(16).toString('hex');
    const keyPrefix = rawKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const key = await this.controlDb.apiKey.create({
      data: { tenantId: ctx.tenantId, name: dto.name, keyPrefix, keyHash },
    });

    // The only moment the raw key is ever visible, client or server side —
    // only its bcrypt hash is kept from here on.
    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt,
      rawKey,
    };
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const key = await this.controlDb.apiKey.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!key) throw new NotFoundException('کلید API یافت نشد');
    return this.controlDb.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
  }
}
