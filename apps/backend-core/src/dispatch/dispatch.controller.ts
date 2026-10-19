import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Param, Post, Put, Query, Res, UseGuards, Patch } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { DispatchService } from './dispatch.service.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { DispatchSuggestionsService } from './dispatch-suggestions.service.js';
import { DispatchReportService, type ReportFilters } from './dispatch-report.service.js';
import { isManagerCtx } from './dispatch-common.js';
import {
  AddDocumentDto,
  CleanlinessDto,
  DeclareShipmentDto,
  DecideAdjustmentDto,
  DocRuleDto,
  DocTypeDto,
  DriverDto,
  FinalCheckDto,
  GrossDto,
  ManualStatusDto,
  NetEditDto,
  NoteDto,
  OptionalReasonDto,
  PaperReceiptDto,
  ProductionTriggerDto,
  ReasonDto,
  TareDto,
  UpdateDispatchSettingsDto,
  UpdateDocTypeDto,
} from './dto/dispatch.dto.js';

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function filtersFrom(q: Record<string, string | undefined>): ReportFilters {
  return {
    status: q.status || undefined,
    driverId: q.driverId || undefined,
    region: q.region || undefined,
    cargoType: q.cargoType || undefined,
    contactId: q.contactId || undefined,
    minNetKg: num(q.minNetKg),
    maxNetKg: num(q.maxNetKg),
    from: q.from || undefined,
    to: q.to || undefined,
    q: q.q || undefined,
    onlyDispatch: q.all === '1' ? false : true,
    limit: num(q.limit),
  };
}

@Controller('dispatch')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('dispatch')
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly rules: DispatchRulesService,
    private readonly suggestions: DispatchSuggestionsService,
    private readonly report: DispatchReportService,
    private readonly permissions: PermissionsService,
  ) {}

  private assertManager(ctx: TenantRequestContext) {
    if (!isManagerCtx(ctx)) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند تنظیمات اعلام بار را تغییر دهد');
  }

  // ── فهرست و گزارش ───────────────────────────────────────────────────
  @Get('shipments')
  async list(@Query() query: Record<string, string | undefined>, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    return this.report.query(ctx, filtersFrom(query));
  }

  /** شمارنده‌ی بارهای فعال به تفکیک وضعیت (ویجت داشبورد) — در دامنه‌ی دید کاربر. */
  @Get('shipments/active-counts')
  async activeCounts(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    return this.report.activeCounts(ctx);
  }

  @Get('shipments/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Query() query: Record<string, string | undefined>, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'dispatch');
    const csv = await this.report.csv(ctx, filtersFrom(query));
    res.setHeader('Content-Disposition', 'attachment; filename="dispatch-report.csv"');
    res.send(csv);
  }

  // ── منبع‌ها: پیشنهاد، پیش‌فرض‌ها ─────────────────────────────────────
  @Get('source-status')
  async sourceStatus(@Query('type') type: string, @Query('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    if (!id) throw new BadRequestException('شناسه‌ی منبع الزامی است');
    return this.suggestions.sourceStatus(ctx, type, id);
  }

  @Get('prefill')
  async prefill(@Query('type') type: string, @Query('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'dispatch');
    if (!id) throw new BadRequestException('شناسه‌ی منبع الزامی است');
    return this.dispatch.prefill(ctx, type, id);
  }

  @Post('source-dismiss')
  async dismiss(@Body() body: { type: string; id: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'dispatch');
    return this.suggestions.dismiss(ctx, body.type, body.id);
  }

  @Put('production/:orderId/trigger')
  async setTrigger(@Param('orderId') orderId: string, @Body() dto: ProductionTriggerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'dispatch');
    return this.suggestions.setProductionTrigger(ctx, orderId, dto.stagesBeforeEnd ?? null);
  }

  // ── تنظیمات، نوع سند، قوانین ─────────────────────────────────────────
  @Get('settings')
  async getSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    await this.rules.ensureDefaults(ctx);
    return this.rules.getSettings(ctx.tenantDb);
  }

  @Put('settings')
  async saveSettings(@Body() dto: UpdateDispatchSettingsDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.saveSettings(ctx, dto);
  }

  @Get('lookups')
  async lookups(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    const [roles, users] = await Promise.all([
      ctx.tenantDb.role.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ctx.tenantDb.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    ]);
    return { roles, users };
  }

  @Get('drivers')
  async drivers(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    return ctx.tenantDb.driver.findMany({
      where: { isActive: true },
      select: { id: true, name: true, phone: true, plateNumber: true, vehicleType: true, capacityKg: true, serviceAreas: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('doc-types')
  async docTypes(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    return this.rules.listDocTypes(ctx, true);
  }

  @Post('doc-types')
  async createDocType(@Body() dto: DocTypeDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.createDocType(ctx, dto);
  }

  @Patch('doc-types/:id')
  async updateDocType(@Param('id') id: string, @Body() dto: UpdateDocTypeDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.updateDocType(ctx, id, dto);
  }

  @Get('rules')
  async listRules(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'dispatch');
    return this.rules.listRules(ctx);
  }

  @Post('rules')
  async createRule(@Body() dto: DocRuleDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.createRule(ctx, dto);
  }

  @Put('rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: DocRuleDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.updateRule(ctx, id, dto);
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(ctx);
    return this.rules.deleteRule(ctx, id);
  }

  // ── بار: ایجاد و جزئیات ──────────────────────────────────────────────
  @Post('shipments')
  declare(@Body() dto: DeclareShipmentDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.declare(ctx, dto);
  }

  @Get('shipments/:id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.detail(ctx, id);
  }

  @Post('shipments/:id/enroll')
  enroll(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.enroll(ctx, id);
  }

  @Post('shipments/:id/driver')
  assignDriver(@Param('id') id: string, @Body() dto: DriverDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.assignDriver(ctx, id, dto.driverId);
  }

  // ── مراحل ───────────────────────────────────────────────────────────
  @Post('shipments/:id/arrival')
  arrival(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.arrival(ctx, id);
  }

  @Post('shipments/:id/cleanliness')
  cleanliness(@Param('id') id: string, @Body() dto: CleanlinessDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.cleanliness(ctx, id, dto);
  }

  @Post('shipments/:id/tare')
  tare(@Param('id') id: string, @Body() dto: TareDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.tare(ctx, id, dto);
  }

  @Post('shipments/:id/loaded')
  loaded(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.loadingDone(ctx, id);
  }

  @Post('shipments/:id/gross')
  gross(@Param('id') id: string, @Body() dto: GrossDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.gross(ctx, id, dto);
  }

  @Post('shipments/:id/net')
  editNet(@Param('id') id: string, @Body() dto: NetEditDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.editNet(ctx, id, dto);
  }

  @Post('shipments/:id/final-check')
  finalCheck(@Param('id') id: string, @Body() dto: FinalCheckDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.finalCheck(ctx, id, dto);
  }

  @Post('shipments/:id/confirm-weight')
  confirmWeight(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.confirmWeight(ctx, id, dto);
  }

  @Post('shipments/:id/ready')
  ready(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.grantReady(ctx, id, dto);
  }

  @Post('shipments/:id/depart')
  depart(@Param('id') id: string, @Body() dto: OptionalReasonDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.depart(ctx, id, dto);
  }

  @Post('shipments/:id/deliver')
  deliver(@Param('id') id: string, @Body() dto: OptionalReasonDto, @Ctx() ctx: TenantRequestContext) {
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return this.dispatch.deliver(ctx, id, dto, publicWebUrl);
  }

  @Post('shipments/:id/status')
  manualStatus(@Param('id') id: string, @Body() dto: ManualStatusDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.manualStatus(ctx, id, dto);
  }

  @Post('shipments/:id/resume')
  resume(@Param('id') id: string, @Body() dto: ReasonDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.resume(ctx, id, dto.reason);
  }

  // ── اسناد ───────────────────────────────────────────────────────────
  @Post('shipments/:id/docs')
  addDoc(@Param('id') id: string, @Body() dto: AddDocumentDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.addDocument(ctx, id, dto);
  }

  @Delete('shipments/:id/docs/:docId')
  removeDoc(@Param('id') id: string, @Param('docId') docId: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.removeDocument(ctx, id, docId);
  }

  @Post('shipments/:id/docs-override')
  overrideDocs(@Param('id') id: string, @Body() dto: ReasonDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.overrideDocs(ctx, id, dto.reason);
  }

  // ── رسید راننده ─────────────────────────────────────────────────────
  @Post('shipments/:id/receipt/send')
  sendReceipt(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.sendReceiptLink(ctx, id);
  }

  @Post('shipments/:id/receipt/paper')
  paperReceipt(@Param('id') id: string, @Body() dto: PaperReceiptDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.attachPaperReceipt(ctx, id, dto);
  }

  @Post('shipments/:id/receipt/pdf')
  receiptPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.regenerateReceiptPdf(ctx, id);
  }

  // ── تعدیل فاکتور ────────────────────────────────────────────────────
  @Post('shipments/:id/adjustment/propose')
  propose(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.proposeAdjustment(ctx, id);
  }

  @Post('shipments/:id/adjustment/decision')
  decide(@Param('id') id: string, @Body() dto: DecideAdjustmentDto, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.decideAdjustment(ctx, id, dto.approve, dto.note);
  }

  @Post('shipments/:id/adjustment/finalize')
  finalize(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.dispatch.retryFinalizeInvoice(ctx, id);
  }
}
