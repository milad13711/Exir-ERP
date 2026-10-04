import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { assertInScope } from '../permissions/scope.util.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateDealDto } from './dto/create-deal.dto.js';
import { UpdateDealStageDto } from './dto/update-deal-stage.dto.js';
import { UpdateDealDto } from './dto/update-deal.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';

const STAGE_LABELS_FA: Record<string, string> = {
  NEW: 'جدید',
  CONTACTED: 'در تماس',
  PROPOSAL: 'پیشنهاد قیمت',
  NEGOTIATION: 'مذاکره',
  WON: 'برد',
  LOST: 'باخت',
};

@Controller('crm/deals')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('crm')
export class DealsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** عملیات روی یک فرصت فروش مشخص: کاربر «فقط خودم» فقط فرصت‌های خودش؛ خارج از دامنه → ۴۰۴. */
  private async assertDealInScope(ctx: TenantRequestContext, id: string) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    await assertInScope(ctx.tenantDb.crmDeal, scope, { id }, { message: 'فرصت فروش یافت نشد' });
  }

  /** مخاطبِ مرجع نیز باید در دامنه‌ی دید کاربر باشد. */
  private async assertContactInScope(ctx: TenantRequestContext, contactId: string) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    await assertInScope(ctx.tenantDb.crmContact, scope, { id: contactId }, { message: 'مخاطب یافت نشد' });
  }

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    return ctx.tenantDb.crmDeal.findMany({
      where: scope,
      include: { contact: { select: { id: true, name: true, company: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const deal = await ctx.tenantDb.crmDeal.findFirst({
      where: { id, ...scope },
      include: {
        contact: true,
        activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
      },
    });
    if (!deal) throw new NotFoundException('فرصت فروش یافت نشد');
    return deal;
  }

  @Post()
  async create(@Body() dto: CreateDealDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'crm');
    await this.assertContactInScope(ctx, dto.contactId);
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    const ownerUserId = await resolveTenantUserId(ctx);
    const deal = await ctx.tenantDb.crmDeal.create({
      data: {
        title: dto.title,
        contactId: dto.contactId,
        value: BigInt(dto.value ?? 0),
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : undefined,
        ownerUserId,
      },
      include: { contact: { select: { id: true, name: true, company: true } } },
    });
    await ctx.tenantDb.activityLog.create({
      data: {
        userId: ownerUserId,
        action: 'crm.deal.created',
        entityType: 'CrmDeal',
        entityId: deal.id,
        metadata: { title: deal.title, value: Number(deal.value) },
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'crm.deal.created', {
      id: deal.id,
      title: deal.title,
      value: Number(deal.value),
      stage: deal.stage,
    });
    return deal;
  }

  @Post(':id/stage')
  async updateStage(
    @Param('id') id: string,
    @Body() dto: UpdateDealStageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'crm');
    await this.assertDealInScope(ctx, id);
    const existing = await ctx.tenantDb.crmDeal.findUniqueOrThrow({ where: { id } });
    const userId = await resolveTenantUserId(ctx);
    const isClosing = dto.stage === 'WON' || dto.stage === 'LOST';

    const deal = await ctx.tenantDb.crmDeal.update({
      where: { id },
      data: {
        stage: dto.stage,
        closedAt: isClosing ? new Date() : null,
      },
      include: { contact: { select: { id: true, name: true, company: true } } },
    });

    await ctx.tenantDb.crmActivity.create({
      data: {
        type: 'STAGE_CHANGE',
        body: `مرحله از «${STAGE_LABELS_FA[existing.stage]}» به «${STAGE_LABELS_FA[dto.stage]}» تغییر کرد`,
        dealId: id,
        userId,
      },
    });
    await ctx.tenantDb.activityLog.create({
      data: {
        userId,
        action: 'crm.deal.stage_changed',
        entityType: 'CrmDeal',
        entityId: id,
        metadata: { from: existing.stage, to: dto.stage },
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'crm.deal.stage_changed', {
      id: deal.id,
      title: deal.title,
      from: existing.stage,
      to: dto.stage,
    });

    if (deal.ownerUserId && deal.ownerUserId !== userId) {
      await this.notifications.notify(ctx.tenantDb, {
        userId: deal.ownerUserId,
        type: 'crm.deal.stage_changed',
        title: `مرحله‌ی فرصت فروش «${deal.title}» تغییر کرد`,
        body: `از «${STAGE_LABELS_FA[existing.stage]}» به «${STAGE_LABELS_FA[dto.stage]}»`,
        link: '/crm',
      });
    }

    return deal;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDealDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'crm');
    await this.assertDealInScope(ctx, id);
    const existing = await ctx.tenantDb.crmDeal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('فرصت فروش یافت نشد');
    if (dto.contactId) {
      await this.assertContactInScope(ctx, dto.contactId);
      await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    }
    return ctx.tenantDb.crmDeal.update({
      where: { id },
      data: {
        title: dto.title,
        contactId: dto.contactId,
        value: dto.value !== undefined ? BigInt(dto.value) : undefined,
        ...(dto.expectedCloseAt !== undefined
          ? { expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null }
          : {}),
      },
      include: { contact: { select: { id: true, name: true, company: true } } },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'crm');
    await this.assertDealInScope(ctx, id);
    const existing = await ctx.tenantDb.crmDeal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('فرصت فروش یافت نشد');
    const invoiceCount = await ctx.tenantDb.salesInvoice.count({ where: { dealId: id } });
    if (invoiceCount > 0) {
      throw new ConflictException('این فرصت فروش فاکتور ثبت‌شده دارد و قابل حذف نیست');
    }
    await ctx.tenantDb.crmDeal.delete({ where: { id } });
    return { success: true };
  }

  @Post(':id/activities')
  async addActivity(
    @Param('id') id: string,
    @Body() dto: AddActivityDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'crm');
    await this.assertDealInScope(ctx, id);
    await ctx.tenantDb.crmDeal.findUniqueOrThrow({ where: { id } });
    const userId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.crmActivity.create({
      data: { type: dto.type, body: dto.body, dealId: id, userId },
      include: { user: { select: { name: true } } },
    });
  }
}
