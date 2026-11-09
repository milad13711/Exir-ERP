import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AGENTS_MODULE_CODE } from './agent-constants.js';
import { AgentCustomersService } from './agent-customers.service.js';
import { AgentProductsService } from './agent-products.service.js';
import { AgentsService } from './agents.service.js';
import { AgentCommissionService } from './agent-commission.service.js';
import { maskSheba } from './sheba.js';
import { assertRegistryTenant, requireMyMembership, requireMyProfile } from './agents-access.js';
import { RequestPayoutDto } from './dto/commission.dto.js';
import { AgentPayoutsService } from './agent-payouts.service.js';
import { AcceptAgreementDto, ConfirmProfileChangeDto, RequestProfileChangeDto, UpdateMyProfileDto } from './dto/agents.dto.js';

const M = AGENTS_MODULE_CODE;

/**
 * پنل خودِ نماینده. هر مسیر ابتدا «پروفایل خودِ من» را از userId نشست می‌گیرد و هر شناسه‌ی عضویت/مشتری را
 * فقط در دامنه‌ی عضویت‌های خودش می‌پذیرد → نماینده‌ی دیگر یا محصول دیگر ۴۰۴ می‌شود.
 * سوابق (مشتری/پرداخت) پس از پایان همکاری هم فقط‌خواندنی در دسترس می‌ماند.
 */
@Controller('agents/me')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule(M)
export class AgentsMeController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly agents: AgentsService,
    private readonly products: AgentProductsService,
    private readonly customers: AgentCustomersService,
    private readonly commission: AgentCommissionService,
    private readonly payouts: AgentPayoutsService,
  ) {}

  private async me(ctx: TenantRequestContext) {
    assertRegistryTenant(ctx);
    await this.permissions.assertView(ctx, M);
    return requireMyProfile(ctx);
  }

  @Get()
  async profile(@Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    const memberships = await ctx.tenantDb.agentProductMembership.findMany({
      where: { resellerProfileId: p.id },
      orderBy: { createdAt: 'asc' },
      include: { product: { select: { id: true, code: true, name: true, logoUrl: true, websiteUrl: true, holdDays: true, minSettlementAmount: true, isActive: true } } },
    });
    const views = [];
    for (const m of memberships) views.push(await this.agents.membershipView(ctx.tenantDb, m, p));
    return { ...this.agents.publicProfile(p), memberships: views, pendingSheba: await this.agents.pendingSheba(ctx.tenantDb, p.id) };
  }

  @Patch()
  async updateProfile(@Body() dto: UpdateMyProfileDto, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    if (dto.name !== undefined) await ctx.tenantDb.crmContact.update({ where: { id: p.contactId }, data: { name: dto.name } });
    await ctx.tenantDb.resellerProfile.update({ where: { id: p.id }, data: { bio: dto.bio, city: dto.city, logoUrl: dto.logoUrl } });
    await ctx.tenantDb.agentAuditLog.create({ data: { resellerProfileId: p.id, action: 'profile.self_updated', detail: Object.keys(dto).join(','), actorType: 'AGENT' } });
    return this.profile(ctx);
  }

  @Post('change-request')
  async changeRequest(@Body() dto: RequestProfileChangeDto, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    return this.agents.requestChange(ctx, p.id, dto.kind, dto.value, 'AGENT');
  }

  @Post('change-confirm')
  async changeConfirm(@Body() dto: ConfirmProfileChangeDto, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    return this.agents.confirmChange(ctx, p.id, dto.changeId, dto.code, 'AGENT');
  }

  @Get('summary')
  async summary(@Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    const ms = await ctx.tenantDb.agentProductMembership.findMany({ where: { resellerProfileId: p.id }, include: { product: { select: { code: true, name: true } } } });
    const out = [];
    for (const m of ms) out.push({ membershipId: m.id, product: m.product, status: m.status, ...(await this.customers.funnelSummary(ctx, { membershipIds: [m.id] })) });
    return out;
  }

  @Get('memberships/:mid/agreement')
  async agreement(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    const m = await requireMyMembership(ctx, p.id, mid);
    const latest = await this.products.latestPublished(ctx.tenantDb, m.productId);
    if (!latest) return { agreement: null, accepted: false };
    const acc = await ctx.tenantDb.agentAgreementAcceptance.findUnique({ where: { membershipId_agreementId: { membershipId: mid, agreementId: latest.id } } });
    return { agreement: { id: latest.id, version: latest.version, title: latest.title, body: latest.body, publishedAt: latest.publishedAt }, accepted: !!acc, acceptedAt: acc?.acceptedAt ?? null };
  }

  @Post('memberships/:mid/agreement/accept')
  async accept(@Param('mid') mid: string, @Body() dto: AcceptAgreementDto, @Ctx() ctx: TenantRequestContext, @Req() req: Request) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.agents.acceptAgreement(ctx, req, p.id, mid, dto);
  }

  @Get('memberships/:mid/customers')
  async myCustomers(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext, @Query() q: { stage?: string; status?: string; q?: string; take?: string; cursor?: string }) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.customers.list(ctx, { membershipIds: [mid] }, { ...q, take: q.take ? Number(q.take) : undefined });
  }

  @Get('memberships/:mid/customers/:id')
  async myCustomer(@Param('mid') mid: string, @Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.customers.getInScope(ctx, { membershipIds: [mid] }, id);
  }

  @Get('memberships/:mid/payments')
  async myPayments(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext, @Query() q: { take?: string; cursor?: string }) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.customers.payments(ctx, { membershipIds: [mid] }, { take: q.take ? Number(q.take) : undefined, cursor: q.cursor });
  }

  /** کیف پول نماینده در این محصول: پورسانت‌ها (سبز) و برگشت‌ها (قرمز) + موجودی قابل تسویه/در انتظار. فقط‌خواندنی. */
  @Get('memberships/:mid/wallet')
  async myWallet(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext, @Query() q: { take?: string; cursor?: string }) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.commission.wallet(ctx, mid, { take: q.take ? Number(q.take) : undefined, cursor: q.cursor });
  }

  /** قوانین پورسانت سطح فعلی نماینده در این محصول (فقط‌خواندنی). */
  @Get('memberships/:mid/rules')
  async myRules(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    const m = await requireMyMembership(ctx, p.id, mid);
    return this.commission.rulesForLevel(ctx, m.productId, m.level);
  }

  /** درخواست‌های تسویه‌ی من در این محصول (شبا ماسک‌شده). */
  @Get('memberships/:mid/payouts')
  async myPayouts(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext, @Query() q: { take?: string; cursor?: string }) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.payouts.list(ctx, { membershipId: mid, take: q.take ? Number(q.take) : undefined, cursor: q.cursor }, false);
  }

  @Post('memberships/:mid/payouts')
  async requestPayout(@Param('mid') mid: string, @Body() dto: RequestPayoutDto, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    const r = await this.payouts.request(ctx, mid, dto.amount, dto.note, 'AGENT');
    return { ...r, shebaNumber: maskSheba(r.shebaNumber) };
  }

  @Post('payouts/:id/cancel')
  async cancelPayout(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    const r = await this.payouts.cancelOwn(ctx, p.id, id);
    return { ...r, shebaNumber: maskSheba(r.shebaNumber) };
  }

  /** کارت ویزیت من برای این محصول (لینک معرفی + QR). */
  @Get('memberships/:mid/card')
  async myCard(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.payouts.businessCard(ctx, mid);
  }

  @Get('memberships/:mid/renewals')
  async myRenewals(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.customers.renewals(ctx, { membershipIds: [mid] });
  }

  @Get('memberships/:mid/funnel')
  async myFunnel(@Param('mid') mid: string, @Ctx() ctx: TenantRequestContext) {
    const p = await this.me(ctx);
    await requireMyMembership(ctx, p.id, mid);
    return this.customers.funnelSummary(ctx, { membershipIds: [mid] });
  }

  /** برای تشخیص نماینده‌بودن در فرانت بدون خطای 404 مزاحم (۲۰۰ با null). */
  @Get('exists')
  async exists(@Ctx() ctx: TenantRequestContext) {
    try {
      await this.me(ctx);
      return { agent: true };
    } catch (e) {
      if (e instanceof NotFoundException) return { agent: false };
      throw e;
    }
  }
}
