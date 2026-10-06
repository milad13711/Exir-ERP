import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { taxInvoiceScope } from '../permissions/entity-scopes.js';
import { TaxInvoicesService } from './tax-invoices.service.js';
import { TaxSettingsService } from './tax-settings.service.js';
import { TaxProductsService } from './tax-products.service.js';
import { ChainTaxInvoiceDto, CreateTaxInvoiceDto, DecideTaxInvoiceDto, UpdateTaxInvoiceDto, UpdateTaxSettingsDto, UploadTaxKeyDto, UpsertTaxProductCodeDto } from './dto/tax.dto.js';

/**
 * دسترسی: تنظیمات و کلیدها فقط OWNER/ADMIN (RolesGuard + بررسی دوباره در سرویس). فهرست/جزئیات با `taxInvoiceScope`
 * و همه‌ی مسیرهای by-id در سرویس دوباره با همان scope خوانده می‌شوند (خارج از دامنه → ۴۰۴).
 * تأیید/رد فقط مدیر واقعی (سرویس عضویت را از کنترل‌پلین می‌خواند).
 */
@Controller('tax')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('tax')
export class TaxController {
  constructor(
    private readonly invoices: TaxInvoicesService,
    private readonly settings: TaxSettingsService,
    private readonly products: TaxProductsService,
    private readonly permissions: PermissionsService,
  ) {}

  private scope(ctx: TenantRequestContext) {
    return taxInvoiceScope(this.permissions, ctx);
  }

  // ── تنظیمات (فقط مدیر) ──

  @Get('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  getSettings(@Ctx() ctx: TenantRequestContext) {
    return this.settings.getView(ctx);
  }

  /** وضعیت سبک برای بنر «ارسال واقعی غیرفعال است» — برای همه‌ی کاربران ماژول؛ بدون جزئیات هویتی. */
  @Get('status')
  async status(@Ctx() ctx: TenantRequestContext) {
    await this.scope(ctx);
    const v = await this.settings.getView(ctx);
    return { environment: v.environment, sendingEnabled: v.sendingEnabled, realSendingDisabled: v.realSendingDisabled, verifiedAgainstSandboxAt: v.verifiedAgainstSandboxAt };
  }

  @Put('settings')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  updateSettings(@Body() dto: UpdateTaxSettingsDto, @Ctx() ctx: TenantRequestContext) {
    return this.settings.update(ctx, dto);
  }

  @Put('settings/key')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  uploadKey(@Body() dto: UploadTaxKeyDto, @Ctx() ctx: TenantRequestContext) {
    return this.settings.uploadKey(ctx, dto);
  }

  @Delete('settings/key')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  removeKey(@Ctx() ctx: TenantRequestContext) {
    return this.settings.removeKey(ctx);
  }

  @Post('settings/refresh-server-key')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  refreshServerKey(@Ctx() ctx: TenantRequestContext) {
    return this.settings.refreshServerKey(ctx);
  }

  // ── کد کالا/خدمت ──

  @Get('product-codes')
  async listProducts(@Query('q') q: string | undefined, @Query('unmapped') unmapped: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.scope(ctx);
    return this.products.list(ctx, q, unmapped === '1' || unmapped === 'true');
  }

  @Put('product-codes')
  async upsertProduct(@Body() dto: UpsertTaxProductCodeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.products.upsert(ctx, dto);
  }

  @Delete('product-codes/:productId')
  async removeProduct(@Param('productId', ParseUUIDPipe) productId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'tax');
    return this.products.remove(ctx, productId);
  }

  // ── صورتحساب‌ها ──

  @Get('invoices')
  async list(@Query('q') q: string | undefined, @Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.invoices.list(ctx, await this.scope(ctx), { q, status });
  }

  @Get('invoices/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.invoices.detail(ctx, id, await this.scope(ctx));
  }

  @Post('invoices')
  async create(@Body() dto: CreateTaxInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'tax');
    const salesScope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    return this.invoices.createFromSalesInvoice(ctx, dto.salesInvoiceId, salesScope);
  }

  @Patch('invoices/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.update(ctx, id, dto, await this.scope(ctx));
  }

  @Post('invoices/:id/validate')
  async validate(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.invoices.refresh(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/request-approval')
  async requestApproval(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.requestApproval(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/approve')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideTaxInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    return this.invoices.decide(ctx, id, true, dto.note, await this.scope(ctx));
  }

  @Post('invoices/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideTaxInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    return this.invoices.decide(ctx, id, false, dto.note, await this.scope(ctx));
  }

  @Post('invoices/:id/send')
  async send(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.sendNow(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/inquire')
  async inquire(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.inquire(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/resend')
  async resend(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.resend(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/discard')
  async discard(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tax');
    return this.invoices.discard(ctx, id, await this.scope(ctx));
  }

  @Post('invoices/:id/chain')
  async chain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChainTaxInvoiceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'tax');
    return this.invoices.createChain(ctx, id, dto, await this.scope(ctx));
  }
}
