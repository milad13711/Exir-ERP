import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { HumanOnly } from '../common/decorators/human-only.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CreateApiKeyDto, RotateApiKeyDto } from './dto/create-api-key.dto.js';
import { buildScopes, parseIpEntry } from './api-key-scopes.js';
import { invalidateApiKeyCache } from './api-key-verifier.js';
import { API_KEY_PREFIX, API_KEY_LOOKUP_PREFIX_LENGTH } from './api-key.constants.js';
import { assertTwoFactorForSensitiveAction } from '../auth/tenant-two-factor-policy.js';

const KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  scopes: true,
  expiresAt: true,
  ipAllowlist: true,
  lastUsedIp: true,
  useCount: true,
  rotatedFromId: true,
} as const;

/** یک کلید API هرگز نباید بتواند کلید دیگری بسازد/ابطال کند (ارتقای دسترسی)؛ مدیریت کلیدها فقط با نشست انسانی. */
function assertHumanSession(ctx: TenantRequestContext): void {
  if (ctx.auth.type === 'api_key') throw new ForbiddenException('مدیریت کلیدهای API فقط از داخل پنل و با نشست کاربری ممکن است');
}

/**
 * API keys are the credential for everything under "API، وب‌هوک و MCP":
 * REST API calls (same JwtAuthGuard, just a different token shape — see
 * jwt-auth.guard.ts) and MCP client connections both authenticate with one
 * of these. Webhook *delivery* itself doesn't need a key (the tenant's own
 * receiving server is what gets called), only managing the subscriptions
 * does — same as any other settings write.
 *
 * هر کلید دامنه‌ی دسترسی دارد (api-key-scopes.ts). کلیدهای قدیمی با scopes خالی «دسترسی کامل» می‌مانند.
 */
@Controller('settings/api-keys')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('api-access')
@Roles('OWNER', 'ADMIN')
@HumanOnly()
export class ApiKeysController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    // keyHash هرگز برنمی‌گردد (select صریح)؛ فقط پیشوند شناسایی.
    return this.controlDb.apiKey.findMany({
      where: { tenantId: ctx.tenantId },
      select: KEY_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateApiKeyDto, @Ctx() ctx: TenantRequestContext) {
    assertHumanSession(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    const ipAllowlist = this.cleanIps(dto.ipAllowlist);
    const scopes = buildScopes(dto.preset ?? 'read_only', dto.modules ?? [], dto.tools ?? []);
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null;
    return this.issue(ctx, { name: dto.name.trim(), scopes, ipAllowlist, expiresAt, rotatedFromId: null });
  }

  /** چرخش: کلید جدید با همان دامنه‌ها ساخته می‌شود و کلید قدیمی پس از مهلت (پیش‌فرض ۲۴ ساعت) منقضی می‌شود. */
  @Post(':id/rotate')
  async rotate(@Param('id') id: string, @Body() dto: RotateApiKeyDto, @Ctx() ctx: TenantRequestContext) {
    assertHumanSession(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    const old = await this.controlDb.apiKey.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!old) throw new NotFoundException('کلید API یافت نشد');
    if (old.revokedAt) throw new BadRequestException('این کلید قبلاً باطل شده است');
    const graceHours = dto.graceHours ?? 24;
    const created = await this.issue(ctx, {
      name: old.name,
      scopes: old.scopes ?? [],
      ipAllowlist: old.ipAllowlist ?? [],
      expiresAt: old.expiresAt && old.expiresAt.getTime() > Date.now() ? old.expiresAt : null,
      rotatedFromId: old.id,
    });
    if (graceHours === 0) {
      await this.controlDb.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    } else {
      const graceEnd = new Date(Date.now() + graceHours * 3_600_000);
      const keepEnd = old.expiresAt && old.expiresAt < graceEnd ? old.expiresAt : graceEnd;
      await this.controlDb.apiKey.update({ where: { id }, data: { expiresAt: keepEnd } });
    }
    invalidateApiKeyCache();
    return created;
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertHumanSession(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    const key = await this.controlDb.apiKey.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!key) throw new NotFoundException('کلید API یافت نشد');
    const updated = await this.controlDb.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: KEY_SELECT,
    });
    invalidateApiKeyCache();
    return updated;
  }

  private cleanIps(list: string[] | undefined): string[] {
    const out: string[] = [];
    for (const raw of list ?? []) {
      if (!raw.trim()) continue;
      if (!parseIpEntry(raw)) throw new BadRequestException(`IP یا CIDR نامعتبر: ${raw}`);
      out.push(raw.trim());
    }
    return out;
  }

  private async issue(
    ctx: TenantRequestContext,
    d: { name: string; scopes: string[]; ipAllowlist: string[]; expiresAt: Date | null; rotatedFromId: string | null },
  ) {
    const rawKey = API_KEY_PREFIX + randomBytes(16).toString('hex');
    const keyPrefix = rawKey.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
    const keyHash = await bcrypt.hash(rawKey, 10);
    const key = await this.controlDb.apiKey.create({
      data: { tenantId: ctx.tenantId, name: d.name, keyPrefix, keyHash, scopes: d.scopes, ipAllowlist: d.ipAllowlist, expiresAt: d.expiresAt, rotatedFromId: d.rotatedFromId },
      select: KEY_SELECT,
    });
    // The only moment the raw key is ever visible, client or server side —
    // only its bcrypt hash is kept from here on.
    return { ...key, rawKey };
  }
}
