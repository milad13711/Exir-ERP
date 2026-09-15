import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreditScoreService } from './credit-score.service.js';
import { SupplierRiskService } from './supplier-risk.service.js';
import { PartyStatementService } from './party-statement.service.js';
import { PartyTransactionsService } from './party-transactions.service.js';
import { FunnelService } from './funnel.service.js';
import { CreatePartyTransactionDto } from './dto/create-party-transaction.dto.js';
import { CreatePartyTransferDto } from './dto/create-party-transfer.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
import { UpdateCreditInputsDto } from './dto/update-credit-inputs.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';

const CONTACT_EXCEL_HEADERS = ['نام', 'نوع', 'شرکت', 'تلفن', 'ایمیل', 'آدرس'];

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
    private readonly funnel: FunnelService,
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

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contacts = await ctx.tenantDb.crmContact.findMany({ where: scope, orderBy: { name: 'asc' } });
    const buffer = await buildExcelBuffer(
      CONTACT_EXCEL_HEADERS,
      contacts.map((c) => ({
        نام: c.name,
        نوع: c.type === 'COMPANY' ? 'شرکت' : 'فرد',
        شرکت: c.company ?? '',
        تلفن: c.phone ?? '',
        ایمیل: c.email ?? '',
        آدرس: c.address ?? '',
      })),
      'مخاطبین',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.xlsx"');
    res.send(buffer);
  }

  /**
   * Contacts have no unique business key (phone is optional, unindexed) —
   * so this is best-effort dedup: a non-empty phone matching an existing
   * contact updates it, everything else (no phone, or no match) creates a
   * new one. Rows with no نام are skipped.
   */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'crm');
    const ownerUserId = await resolveTenantUserId(ctx);
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const name = String(row['نام'] ?? '').trim();
      if (!name) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'نام خالی است' });
        continue;
      }

      const phone = String(row['تلفن'] ?? '').trim() || undefined;
      const data = {
        type: (String(row['نوع'] ?? '').trim() === 'شرکت' ? 'COMPANY' : 'INDIVIDUAL') as 'COMPANY' | 'INDIVIDUAL',
        name,
        company: String(row['شرکت'] ?? '').trim() || undefined,
        phone,
        email: String(row['ایمیل'] ?? '').trim() || undefined,
        address: String(row['آدرس'] ?? '').trim() || undefined,
      };

      const existing = phone ? await ctx.tenantDb.crmContact.findFirst({ where: { phone } }) : null;
      if (existing) {
        await ctx.tenantDb.crmContact.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.crmContact.create({ data: { ...data, ownerUserId } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
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
  @RequireModule('supplier-risk')
  async credit(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
    const contact = await ctx.tenantDb.crmContact.findFirst({ where: { id, ...scope } });
    if (!contact) throw new NotFoundException('مخاطب یافت نشد');
    return this.creditScore.assess(ctx, id);
  }

  @Get(':id/supplier-risk')
  @RequireModule('supplier-risk')
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
    if (dto.referredById) {
      if (dto.referredById === id) throw new NotFoundException('مخاطب نمی‌تواند معرف خودش باشد');
      await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.referredById } });
    }
    const contact = await ctx.tenantDb.crmContact.update({
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
        source: dto.source,
        acquisitionCost: dto.acquisitionCost,
        referredById: dto.referredById,
      },
    });
    if (dto.referredById) {
      await this.funnel.markReferrerAsAmbassador(ctx, dto.referredById);
    }
    return contact;
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
    if (dto.referredById) {
      await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.referredById } });
    }
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
        source: dto.source,
        acquisitionCost: dto.acquisitionCost,
        referredById: dto.referredById,
        ownerUserId,
      },
    });
    await this.funnel.initLead(ctx, contact.id);
    if (dto.referredById) {
      await this.funnel.markReferrerAsAmbassador(ctx, dto.referredById);
    }
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
