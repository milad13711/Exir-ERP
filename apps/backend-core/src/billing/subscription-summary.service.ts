import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { LicenseRuntimeService } from '../licensing/license-runtime.service.js';
import { ModuleRenewalService } from '../modules-catalog/module-renewal.service.js';
import {
  buildSummary,
  isPlanLevelInvoice,
  redactForMember,
  RENEWAL_NOTICE_DAYS,
  timeLeft,
  type InvoiceInput,
  type LicenseLike,
  type SubscriptionSummary,
} from './subscription-summary.js';

/**
 * بارگذاری داده‌ی control-plane برای یک تننت و سپس فقط فراخوانی تابع‌های خالص subscription-summary.ts.
 * تنها مسیر ساخت «وضعیت اشتراک» برای هدر، تنظیمات، پنل ادمین و کرون‌هاست.
 */
@Injectable()
export class SubscriptionSummaryService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly moduleRenewal: ModuleRenewalService,
    @Optional() private readonly license?: LicenseRuntimeService,
  ) {}

  /** @param opts.viewer ADMIN = جزئیات کامل (مالک/ادمین تننت یا کارشناس پنل ادمین)، MEMBER = وضعیت خنثی. */
  async forTenant(tenantId: string, opts: { viewer: 'ADMIN' | 'MEMBER'; useLocalLicense?: boolean } = { viewer: 'ADMIN' }, now: Date = new Date()): Promise<SubscriptionSummary> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');

    const [subs, invoices, defs, installs] = await Promise.all([
      this.controlDb.subscription.findMany({ where: { tenantId }, orderBy: { startedAt: 'desc' }, take: 5, include: { plan: true } }),
      this.controlDb.invoice.findMany({
        where: { tenantId, OR: [{ status: { in: ['PENDING', 'AWAITING_APPROVAL'] } }, { status: 'PAID', paidAt: { gte: new Date(now.getTime() - 120 * 86_400_000) } }] },
        orderBy: { issuedAt: 'desc' },
        take: 200,
      }),
      this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } }),
      this.controlDb.tenantModule.findMany({ where: { tenantId } }),
    ]);
    // همان انتخاب BillingController.subscription: جدیدترین اشتراکِ TRIAL/ACTIVE/PAST_DUE
    const sub = subs.find((s) => s.status === 'TRIAL' || s.status === 'ACTIVE' || s.status === 'PAST_DUE') ?? null;
    const inv: InvoiceInput[] = invoices.map((i) => ({ id: i.id, amount: i.amount, status: i.status, purpose: i.purpose, items: i.items, dueAt: i.dueAt, paidAt: i.paidAt }));
    const installByModule = new Map(installs.map((i) => [i.moduleId, i]));

    const license: LicenseLike | null = opts.useLocalLicense === false ? null : this.licenseLike();
    const summary = buildSummary(
      {
        tenantStatus: tenant.status,
        subscription: sub
          ? { status: sub.status, startedAt: sub.startedAt, currentPeriodEnd: sub.currentPeriodEnd, lifetime: sub.lifetime, autoRenew: sub.autoRenew, planName: sub.plan.name, planCode: sub.plan.code }
          : null,
        planInvoices: inv.filter(isPlanLevelInvoice),
        license,
      },
      defs.map((d) => ({
        code: d.code,
        name: d.name,
        isCore: d.isCore,
        priceMonthly: d.priceMonthly,
        install: installByModule.get(d.id)
          ? { status: installByModule.get(d.id)!.status, billingMode: installByModule.get(d.id)!.billingMode, currentPeriodEnd: installByModule.get(d.id)!.currentPeriodEnd, pendingRenewalInvoiceId: installByModule.get(d.id)!.pendingRenewalInvoiceId }
          : null,
      })),
      inv.filter((i) => !isPlanLevelInvoice(i)),
      now,
    );
    return opts.viewer === 'ADMIN' ? summary : redactForMember(summary);
  }

  private licenseLike(): LicenseLike | null {
    const st = this.license?.getStatus();
    if (!st || st.mode !== 'on_premise') return null;
    if (st.state === 'valid' || st.state === 'grace') return { mode: 'on_premise', state: st.state, daysLeft: st.daysLeft, warningLevel: st.warningLevel, reasonCode: st.reasonCode };
    return { mode: 'on_premise', state: st.state, reasonCode: st.reasonCode };
  }

  /**
   * درخواست صدور فاکتور تمدید. moduleCode خالی ⇒ تمدید خودِ پلن (فاکتور PLAN_RENEWAL که پس از پرداخت اشتراک را
   * تمدید می‌کند — TenantsService.settleInvoicePaid).
   */
  async requestRenewal(tenantId: string, moduleCode?: string): Promise<{ invoiceId: string; status: 'PENDING' | 'AWAITING_APPROVAL'; created: boolean }> {
    if (moduleCode) return this.moduleRenewal.requestRenewal(tenantId, moduleCode);

    const sub = await this.controlDb.subscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } }, orderBy: { startedAt: 'desc' }, include: { plan: true } });
    if (!sub) throw new BadRequestException('اشتراک فعالی برای تمدید وجود ندارد؛ با پشتیبانی تماس بگیرید');
    if (sub.lifetime) throw new BadRequestException('اشتراک شما مادام‌العمر است و نیازی به تمدید ندارد');
    const t = timeLeft(sub.currentPeriodEnd, new Date());
    if (!t.expired && sub.status !== 'PAST_DUE' && sub.status !== 'TRIAL' && t.daysLeft > RENEWAL_NOTICE_DAYS) {
      throw new BadRequestException('هنوز زمان تمدید اشتراک نرسیده است');
    }
    // قفل مشورتی به‌ازای تننت: دو درخواست همزمان نباید دو فاکتور PLAN_RENEWAL باز بسازند
    return this.controlDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'plan-renewal:' + tenantId}))`;
      const open = await tx.invoice.findFirst({
        where: { tenantId, status: { in: ['PENDING', 'AWAITING_APPROVAL'] }, OR: [{ purpose: null }, { purpose: { in: ['TENANT_SETUP', 'PLAN_RENEWAL'] } }] },
        orderBy: { issuedAt: 'desc' },
      });
      if (open && isPlanLevelInvoice(open)) return { invoiceId: open.id, status: open.status as 'PENDING' | 'AWAITING_APPROVAL', created: false };

      const invoice = await tx.invoice.create({
        data: { tenantId, subscriptionId: sub.id, amount: sub.plan.priceMonthly, purpose: 'PLAN_RENEWAL', status: 'PENDING', issueSource: 'CHECKOUT', dueAt: t.expired ? new Date() : sub.currentPeriodEnd },
      });
      await tx.auditLog.create({ data: { actorType: 'tenant_user', tenantId, action: 'plan.renewal_requested', entityType: 'Invoice', entityId: invoice.id, metadata: { planCode: sub.plan.code } } });
      return { invoiceId: invoice.id, status: 'PENDING' as const, created: true };
    });
  }
}
