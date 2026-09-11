import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { WarrantyService } from './warranty.service.js';
import { WarrantyLabelPdfService } from './warranty-label-pdf.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ManualIssueDto } from './dto/manual-issue.dto.js';
import { ExtendWarrantyDto } from './dto/extend-warranty.dto.js';
import { UpdateProductWarrantySettingsDto } from './dto/update-product-settings.dto.js';
import { UpdateWarrantyGeneralSettingsDto } from './dto/update-general-settings.dto.js';
import { UpdateWarrantySmsSettingsDto } from './dto/update-sms-settings.dto.js';
import { ImportLegacyWarrantiesDto } from './dto/import-legacy.dto.js';

@Controller('warranty')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warranty')
export class WarrantyController {
  constructor(
    private readonly warranty: WarrantyService,
    private readonly labelPdf: WarrantyLabelPdfService,
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  @Get('codes')
  async listCodes(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Query('invoiceId') invoiceId: string | undefined,
    @Query('noInvoice') noInvoice: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.listCodes(ctx, { status, search, invoiceId, noInvoice: noInvoice === 'true', contactId });
  }

  @Get('codes/invoice-groups')
  async invoiceGroups(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.getInvoiceGroups(ctx);
  }

  @Get('codes/:id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.detail(ctx, id);
  }

  @Post('codes/:id/void')
  async void_(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warranty');
    return this.warranty.void(ctx, id);
  }

  @Post('codes/:id/extend')
  async extend(@Param('id') id: string, @Body() dto: ExtendWarrantyDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warranty');
    return this.warranty.extend(ctx, id, dto.expiresAt);
  }

  @Post('codes/delete')
  async deleteMany(@Body() body: { ids: string[] }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'warranty');
    return this.warranty.deleteMany(ctx, body.ids ?? []);
  }

  @Post('codes/manual-issue')
  async manualIssue(@Body() dto: ManualIssueDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warranty');
    return this.warranty.manualIssue(ctx, dto);
  }

  @Get('invoices/search')
  async searchInvoices(@Query('term') term: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.searchInvoices(ctx, term ?? '');
  }

  @Get('invoices/:id/summary')
  async invoiceSummary(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.invoiceSummary(ctx, id);
  }

  @Post('invoices/:id/issue-now')
  async issueNow(@Param('id') id: string, @Body() body: { lineIds?: string[] }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warranty');
    return this.warranty.issueFromInvoiceNow(ctx, id, body.lineIds);
  }

  @Post('codes/print-labels')
  async printLabels(@Body() body: { ids: string[]; columns?: number }, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'warranty');
    const codes = await ctx.tenantDb.warrantyCode.findMany({ where: { id: { in: body.ids ?? [] } }, select: { code: true, itemDescription: true } });
    const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const pdf = await this.labelPdf.render(codes, tenant.name, body.columns);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="warranty-labels.pdf"');
    res.send(pdf);
  }

  @Get('products')
  async listProducts(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.listProducts(ctx);
  }

  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Body() dto: UpdateProductWarrantySettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warranty');
    return this.warranty.updateProductSettings(ctx, id, dto);
  }

  @Get('invoices/:id/has-issuable-warranty')
  async invoiceHasIssuableWarranty(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return { hasIssuable: await this.warranty.invoiceHasIssuableWarranty(ctx, id) };
  }

  @Get('reports')
  async reports(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.getReportsData(ctx);
  }

  @Get('settings/general')
  async getGeneralSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.getGeneralSettings(ctx);
  }

  @Put('settings/general')
  async setGeneralSettings(@Body() dto: UpdateWarrantyGeneralSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warranty');
    return this.warranty.setGeneralSettings(ctx, dto);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'warranty');
    return this.warranty.getSmsSettings(ctx);
  }

  @Put('settings/sms')
  async setSmsSettings(@Body() dto: UpdateWarrantySmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'warranty');
    return this.warranty.setSmsSettings(ctx, dto);
  }

  @Post('import')
  async importLegacy(@Body() dto: ImportLegacyWarrantiesDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warranty');
    return this.warranty.importLegacyRows(ctx, dto.rows);
  }
}
