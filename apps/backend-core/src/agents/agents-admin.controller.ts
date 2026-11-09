import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { assertTwoFactorForSensitiveAction } from '../auth/tenant-two-factor-policy.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AGENTS_MODULE_CODE } from './agent-constants.js';
import { AgentApiService } from './agent-api.service.js';
import { AgentCustomersService } from './agent-customers.service.js';
import { AgentProductsService } from './agent-products.service.js';
import { AgentsService } from './agents.service.js';
import { AgentCommissionService } from './agent-commission.service.js';
import { AdminRequestPayoutDto, CreatePlanRuleDto, MarkPayoutPaidDto, RejectPayoutDto, RejectShebaChangeDto, TransferCustomerDto, UpsertCatalogDto } from './dto/commission.dto.js';
import { AgentPayoutsService } from './agent-payouts.service.js';
import { assertRegistryTenant } from './agents-access.js';
import { ApproveApplicationDto, AddMembershipDto, ChangeStageDto, ConfirmProfileChangeDto, CreateAgentProfileDto, RejectApplicationDto, RequestProfileChangeDto, UpdateAgentProfileDto, UpdateMembershipDto } from './dto/agents.dto.js';
import { CreateAgentProductDto, CreateApiKeyDto, CreateCommissionRuleDto, SaveAgreementDto, UpdateAgentProductDto, UpdateApiKeyDto } from './dto/product.dto.js';

const M = AGENTS_MODULE_CODE;

/**
 * مدیریت ماژول نمایندگی (تننت رجیستری). همه‌ی مسیرها «مشاهده‌ی همه» می‌خواهند؛ نقش «نماینده» فقط viewOwn دارد پس اینجا ۴۰۳ می‌گیرد.
 * مسیرهای حساس کلید API فقط مالک/مدیر و با الزام 2FA.
 */
@Controller('agents')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule(M)
export class AgentsAdminController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly agents: AgentsService,
    private readonly products: AgentProductsService,
    private readonly customers: AgentCustomersService,
    private readonly api: AgentApiService,
    private readonly commission: AgentCommissionService,
    private readonly payouts: AgentPayoutsService,
  ) {}

  private async view(ctx: TenantRequestContext) {
    assertRegistryTenant(ctx);
    await this.permissions.assertViewAll(ctx, M);
  }
  private async edit(ctx: TenantRequestContext) {
    await this.view(ctx);
    await this.permissions.assertEdit(ctx, M);
  }

  // ── محصولات ──
  @Get('products')
  async listProducts(@Ctx() ctx: TenantRequestContext, @Query('archived') archived?: string) {
    await this.view(ctx);
    return this.products.list(ctx, archived === 'true');
  }
  @Get('products/:id')
  async getProduct(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.products.get(ctx, id);
  }
  @Post('products')
  async createProduct(@Body() dto: CreateAgentProductDto, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    await this.permissions.assertCreate(ctx, M);
    return this.products.create(ctx, dto);
  }
  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Body() dto: UpdateAgentProductDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.update(ctx, id, dto);
  }
  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    await this.permissions.assertDelete(ctx, M);
    return this.products.removeOrArchive(ctx, id);
  }
  @Post('products/:id/restore')
  async restoreProduct(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.restore(ctx, id);
  }

  // ── قوانین پورسانت چندبعدی (سطح × نوع تراکنش × قلم × اول/تمدید) ──
  @Get('products/:id/plan-rules')
  async planRules(@Param('id') id: string, @Query('all') all: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.commission.listPlanRules(ctx, id, all === '1');
  }
  @Post('products/:id/plan-rules')
  @Roles('OWNER', 'ADMIN')
  async createPlanRule(@Param('id') id: string, @Body() dto: CreatePlanRuleDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.commission.createPlanRule(ctx, id, dto);
  }
  @Post('products/:id/plan-rules/:ruleId/end')
  @Roles('OWNER', 'ADMIN')
  async endPlanRule(@Param('id') id: string, @Param('ruleId') ruleId: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.commission.endPlanRule(ctx, id, ruleId);
  }
  @Get('products/:id/plan-rules/simulate')
  async simulate(@Param('id') id: string, @Query() q: { level?: string; txType?: string; itemCode?: string; occurrence?: string; amount?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.commission.simulate(ctx, id, { level: q.level ?? 'B', txType: q.txType ?? '', itemCode: q.itemCode, occurrence: q.occurrence, amount: q.amount ? Number(q.amount) : undefined });
  }
  @Get('products/:id/catalog')
  async catalog(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.commission.catalog(ctx, id);
  }
  @Put('products/:id/catalog/types')
  async upsertType(@Param('id') id: string, @Body() dto: UpsertCatalogDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.commission.upsertCatalog(ctx, id, 'type', dto);
  }
  @Put('products/:id/catalog/items')
  async upsertItem(@Param('id') id: string, @Body() dto: UpsertCatalogDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.commission.upsertCatalog(ctx, id, 'item', dto);
  }

  // ── دفتر مرکزی تراکنش‌ها و کیف پول ──
  @Get('transactions')
  async transactions(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; membershipId?: string; txType?: string; itemCode?: string; commissionStatus?: string; occurrence?: string; from?: string; to?: string; q?: string; take?: string; cursor?: string }) {
    await this.view(ctx);
    return this.commission.transactions(ctx, { ...q, membershipIds: q.membershipId ? [q.membershipId] : undefined, take: q.take ? Number(q.take) : undefined });
  }
  @Get('memberships/:id/wallet')
  async wallet(@Param('id') id: string, @Query() q: { take?: string; cursor?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.commission.wallet(ctx, id, { take: q.take ? Number(q.take) : undefined, cursor: q.cursor });
  }
  @Post('customers/:id/transfer')
  @Roles('OWNER', 'ADMIN')
  async transfer(@Param('id') id: string, @Body() dto: TransferCustomerDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.commission.transferCustomer(ctx, id, dto);
  }
  @Get('customers/:id/transfers')
  async transfers(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.commission.transfers(ctx, id);
  }

  // ── تسویه (پرداخت دستی توسط مالی) و گزارش ──
  @Get('payouts')
  async listPayouts(@Ctx() ctx: TenantRequestContext, @Query() q: { status?: string; productId?: string; membershipId?: string; take?: string; cursor?: string }) {
    await this.view(ctx);
    return this.payouts.list(ctx, { ...q, take: q.take ? Number(q.take) : undefined }, true);
  }
  /** ثبت درخواست تسویه از طرف نماینده (مثلاً درخواست تلفنی). همان قواعد موجودی/حداقل/شبا. */
  @Post('payouts')
  @Roles('OWNER', 'ADMIN')
  async createPayout(@Body() dto: AdminRequestPayoutDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.payouts.request(ctx, dto.membershipId, dto.amount, dto.note, 'ADMIN');
  }
  @Post('payouts/:id/approve')
  @Roles('OWNER', 'ADMIN')
  async approvePayout(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.payouts.approve(ctx, id);
  }
  @Post('payouts/:id/reject')
  @Roles('OWNER', 'ADMIN')
  async rejectPayout(@Param('id') id: string, @Body() dto: RejectPayoutDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.payouts.reject(ctx, id, dto.reason);
  }
  @Post('payouts/:id/paid')
  @Roles('OWNER', 'ADMIN')
  async markPayoutPaid(@Param('id') id: string, @Body() dto: MarkPayoutPaidDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.payouts.markPaid(ctx, id, dto);
  }
  @Get('reports/performance')
  async performanceReport(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; from?: string; to?: string }) {
    await this.view(ctx);
    return this.payouts.report(ctx, q);
  }
  @Get('memberships/:id/card')
  async card(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.payouts.businessCard(ctx, id);
  }

  // ── قوانین کمیسیون و تفاهم‌نامه ──
  @Get('products/:id/rules')
  async rules(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.products.listRules(ctx, id);
  }
  @Post('products/:id/rules')
  async createRule(@Param('id') id: string, @Body() dto: CreateCommissionRuleDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.createRule(ctx, id, dto);
  }
  @Get('products/:id/agreements')
  async agreements(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.products.listAgreements(ctx, id);
  }
  @Put('products/:id/agreements/draft')
  async saveDraft(@Param('id') id: string, @Body() dto: SaveAgreementDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.saveDraft(ctx, id, dto);
  }
  @Post('products/:id/agreements/:agreementId/publish')
  async publish(@Param('id') id: string, @Param('agreementId') agreementId: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.publish(ctx, id, agreementId);
  }

  // ── کلید API و تنظیمات API (فقط مالک/مدیر) ──
  @Get('api-info')
  @Roles('OWNER', 'ADMIN')
  async apiInfo(@Ctx() ctx: TenantRequestContext, @Req() req: Request) {
    await this.view(ctx);
    return { baseUrl: this.products.baseUrl(`${req.protocol}://${req.get('host')}`), signatureHeader: 'X-Exir-Signature', timestampHeader: 'X-Exir-Timestamp', timestampWindowSeconds: 300 };
  }
  @Get('products/:id/api-keys')
  @Roles('OWNER', 'ADMIN')
  async keys(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.products.listKeys(ctx, id);
  }
  @Post('products/:id/api-keys')
  @Roles('OWNER', 'ADMIN')
  async createKey(@Param('id') id: string, @Body() dto: CreateApiKeyDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.products.createKey(ctx, id, dto);
  }
  @Post('products/:id/api-keys/:keyId/rotate')
  @Roles('OWNER', 'ADMIN')
  async rotateKey(@Param('id') id: string, @Param('keyId') keyId: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.products.rotateKey(ctx, id, keyId);
  }
  @Post('products/:id/api-keys/:keyId/revoke')
  @Roles('OWNER', 'ADMIN')
  async revokeKey(@Param('id') id: string, @Param('keyId') keyId: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.products.revokeKey(ctx, id, keyId);
  }
  @Patch('products/:id/api-keys/:keyId')
  @Roles('OWNER', 'ADMIN')
  async updateKey(@Param('id') id: string, @Param('keyId') keyId: string, @Body() dto: UpdateApiKeyDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.products.updateKey(ctx, id, keyId, dto);
  }
  @Post('products/:id/test-event')
  @Roles('OWNER', 'ADMIN')
  async testEvent(@Param('id') id: string, @Body() dto: { referralCode?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    const code = String(dto?.referralCode ?? '').trim();
    if (!code) {
      const m = await ctx.tenantDb.agentProductMembership.findFirst({ where: { productId: id, status: 'ACTIVE', referralCode: { not: null } } });
      if (!m?.referralCode) return { steps: [{ type: 'customer.registered', ok: false, code: 'NO_REFERRAL_CODE', message: 'برای تست، حداقل یک عضویت فعال با کد معرف لازم است' }] };
      return this.api.runTest(ctx.tenantDb, id, m.referralCode);
    }
    return this.api.runTest(ctx.tenantDb, id, code);
  }
  @Get('event-logs')
  @Roles('OWNER', 'ADMIN')
  async eventLogs(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; status?: string; type?: string; q?: string; from?: string; to?: string; take?: string; cursor?: string }) {
    await this.view(ctx);
    return this.customers.eventLogs(ctx, { ...q, take: q.take ? Number(q.take) : undefined });
  }

  // ── درخواست‌های همکاری ──
  @Get('applications')
  async applications(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string) {
    await this.view(ctx);
    return this.agents.listApplications(ctx, status);
  }
  @Post('applications/:id/approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveApplicationDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    await this.permissions.assertCreate(ctx, M);
    return this.agents.approveApplication(ctx, id, dto.memberships);
  }
  @Post('applications/:id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectApplicationDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.agents.rejectApplication(ctx, id, dto.note);
  }

  // ── نمایندگان ──
  @Get('profiles')
  async profiles(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; level?: string; status?: string; q?: string }) {
    await this.view(ctx);
    return this.agents.listProfiles(ctx, q);
  }
  @Get('profiles/:id')
  async profile(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.agents.getProfile(ctx, id);
  }
  @Post('profiles')
  async createProfile(@Body() dto: CreateAgentProfileDto, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    await this.permissions.assertCreate(ctx, M);
    return this.agents.createProfile(ctx, dto);
  }
  @Patch('profiles/:id')
  async updateProfile(@Param('id') id: string, @Body() dto: UpdateAgentProfileDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.agents.updateProfile(ctx, id, dto);
  }
  // ── تأیید مدیر برای تغییر شبای درخواستی نماینده ──
  @Get('sheba-changes')
  async shebaChanges(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string) {
    await this.view(ctx);
    return this.agents.listShebaChanges(ctx, status);
  }
  @Post('sheba-changes/:id/approve')
  @Roles('OWNER', 'ADMIN')
  async approveSheba(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.agents.approveShebaChange(ctx, id);
  }
  @Post('sheba-changes/:id/reject')
  @Roles('OWNER', 'ADMIN')
  async rejectSheba(@Param('id') id: string, @Body() dto: RejectShebaChangeDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.agents.rejectShebaChange(ctx, id, dto.reason);
  }
  @Post('profiles/:id/change-request')
  @Roles('OWNER', 'ADMIN')
  async changeRequest(@Param('id') id: string, @Body() dto: RequestProfileChangeDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    // شبا/شماره مقصد واریز تسویه را تعیین می‌کند → همان سطح مسیرهای مالی
    assertTwoFactorForSensitiveAction(ctx);
    return this.agents.requestChange(ctx, id, dto.kind, dto.value, 'ADMIN');
  }
  @Post('profiles/:id/change-confirm')
  @Roles('OWNER', 'ADMIN')
  async changeConfirm(@Param('id') id: string, @Body() dto: ConfirmProfileChangeDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    assertTwoFactorForSensitiveAction(ctx);
    return this.agents.confirmChange(ctx, id, dto.changeId, dto.code, 'ADMIN');
  }
  @Post('profiles/:id/memberships')
  async addMembership(@Param('id') id: string, @Body() dto: AddMembershipDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    await this.permissions.assertCreate(ctx, M);
    return this.agents.addMembership(ctx, id, dto);
  }
  @Patch('memberships/:id')
  async updateMembership(@Param('id') id: string, @Body() dto: UpdateMembershipDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.agents.updateMembership(ctx, id, dto);
  }

  // ── مشتریان و دفتر پرداخت (دید ادمین، همه‌ی محصول‌ها/نمایندگان) ──
  @Get('customers')
  async customerList(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; profileId?: string; membershipId?: string; stage?: string; status?: string; q?: string; take?: string; cursor?: string }) {
    await this.view(ctx);
    return this.customers.list(ctx, { productId: q.productId, profileId: q.profileId, membershipIds: q.membershipId ? [q.membershipId] : undefined }, { ...q, take: q.take ? Number(q.take) : undefined });
  }
  @Get('customers/:id')
  async customer(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.view(ctx);
    return this.customers.getInScope(ctx, {}, id);
  }
  @Post('customers/:id/stage')
  async stage(@Param('id') id: string, @Body() dto: ChangeStageDto, @Ctx() ctx: TenantRequestContext) {
    await this.edit(ctx);
    return this.customers.changeStage(ctx, id, dto.stage, dto.note);
  }
  @Get('payments')
  async payments(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; profileId?: string; membershipId?: string; take?: string; cursor?: string }) {
    await this.view(ctx);
    return this.customers.payments(ctx, { productId: q.productId, profileId: q.profileId, membershipIds: q.membershipId ? [q.membershipId] : undefined }, { take: q.take ? Number(q.take) : undefined, cursor: q.cursor });
  }
  @Get('renewals')
  async renewals(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; profileId?: string }) {
    await this.view(ctx);
    return this.customers.renewals(ctx, { productId: q.productId, profileId: q.profileId });
  }
  @Get('funnel')
  async funnel(@Ctx() ctx: TenantRequestContext, @Query() q: { productId?: string; profileId?: string }) {
    await this.view(ctx);
    return this.customers.funnelSummary(ctx, { productId: q.productId, profileId: q.profileId });
  }
}
