import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreditScoreService } from './credit-score.service.js';
import { SupplierRiskService } from './supplier-risk.service.js';
import { PartyStatementService } from './party-statement.service.js';
import { PartyTransactionsService } from './party-transactions.service.js';
import { CreatePartyTransactionDto } from './dto/create-party-transaction.dto.js';
import { CreatePartyTransferDto } from './dto/create-party-transfer.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { UpdateCreditInputsDto } from './dto/update-credit-inputs.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';

@Controller('crm/contacts')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('crm')
export class ContactsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly permissions: PermissionsService,
    private readonly creditScore: CreditScoreService,
    private readonly supplierRisk: SupplierRiskService,
    private readonly partyStatement: PartyStatementService,
    private readonly partyTransactions: PartyTransactionsService,
  ) {}
  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('isSupplier') isSupplier: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    return ctx.tenantDb.crmContact.findMany({
      where: {
        ...scope,
        ...(isSupplier === 'true' ? { isSupplier: true } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { company: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { deals: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id/statement')
  async statement(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contact = await ctx.tenantDb.crmContact.findFirst({ where: { id, ...scope } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return this.partyStatement.statement(ctx, id);
  }

  @Post(':id/transactions')
  async createTransaction(
    @Param('id') id: string,
    @Body() dto: CreatePartyTransactionDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertCreate(ctx, 'crm');
    return this.partyTransactions.create(ctx, id, dto);
  }

  /**
   * تسویه‌ی مستقیم بین دو طرف‌حساب — مثلاً وقتی مشتری بدهکار ما مستقیم به
   * حساب تأمین‌کننده‌ای که ما به او بدهکاریم واریز می‌کند. مسیر ثابت است، نه
   * زیرمجموعه‌ی یک مخاطب خاص، چون دو طرف‌حساب برابر در آن دخیل‌اند.
   */
  @Post('transfers')
  async transferBetweenParties(@Body() dto: CreatePartyTransferDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'crm');
    return this.partyTransactions.transfer(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contact = await ctx.tenantDb.crmContact.findFirst({
      where: { id, ...scope },
      include: {
        deals: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
      },
    });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return contact;
  }

  @Get(':id/credit')
  async credit(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contact = await ctx.tenantDb.crmContact.findFirst({ where: { id, ...scope } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return this.creditScore.assess(ctx, id);
  }

  @Get(':id/supplier-risk')
  async supplierRiskAssessment(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contact = await ctx.tenantDb.crmContact.findFirst({ where: { id, ...scope } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return this.supplierRisk.assess(ctx, id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'crm');
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.crmContact.update({
      where: { id },
      data: {
        type: dto.type,
        name: dto.name,
        company: dto.company,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        nationalId: dto.nationalId,
        economicCode: dto.economicCode,
        legalId: dto.legalId,
        registrationNumber: dto.registrationNumber,
        tags: dto.tags,
        isCustomer: dto.isCustomer,
        isSupplier: dto.isSupplier,
      },
    });
  }

  @Put(':id/credit-inputs')
  async updateCreditInputs(
    @Param('id') id: string,
    @Body() dto: UpdateCreditInputsDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'crm');
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id } });
    await ctx.tenantDb.crmContact.update({
      where: { id },
      data: {
        hasBouncedChecks: dto.hasBouncedChecks,
        bankAvgMonthlyTurnover: dto.bankAvgMonthlyTurnover,
        creditLimitOverride: dto.creditLimitOverride,
      },
    });
    return this.creditScore.assess(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateContactDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'crm');
    const ownerUserId = await resolveTenantUserId(ctx);
    const contact = await ctx.tenantDb.crmContact.create({
      data: {
        type: dto.type ?? 'INDIVIDUAL',
        name: dto.name,
        company: dto.company,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        nationalId: dto.nationalId,
        economicCode: dto.economicCode,
        legalId: dto.legalId,
        registrationNumber: dto.registrationNumber,
        tags: dto.tags ?? [],
        ownerUserId,
      },
    });
    await ctx.tenantDb.activityLog.create({
      data: {
        userId: ownerUserId,
        action: 'crm.contact.created',
        entityType: 'CrmContact',
        entityId: contact.id,
        metadata: { name: contact.name },
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'crm.contact.created', { id: contact.id, name: contact.name });
    return contact;
  }

  @Post(':id/activities')
  async addActivity(
    @Param('id') id: string,
    @Body() dto: AddActivityDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'crm');
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id } });
    const userId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.crmActivity.create({
      data: { type: dto.type, body: dto.body, contactId: id, userId },
      include: { user: { select: { name: true } } },
    });
  }
}
