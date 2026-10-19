import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { getParentTenant } from '../common/parent-tenant.js';
import { platformTenantSlug } from '../common/guards/platform-owner.guard.js';
import { getManagerUsers } from '../common/manager-users.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import {
  applyLineEdits,
  describeLines,
  invoiceContentHash,
  normalizeInvoiceApprovalSettings,
  PURPOSE_LABEL,
  requiresApproval,
  type InvoiceApprovalSettings,
  type InvoiceIssueSource,
} from './tenant-invoice-approval.logic.js';

export const TENANT_INVOICE = 'TENANT_INVOICE';
const SETTING = { moduleCode: 'platform', key: 'invoice-approval' } as const;
const PARENT_SOURCE = 'parent-tenant';

/**
 * فاکتورهای خودکارِ تننت‌ها (تمدید ماژول و...) ابتدا AWAITING_APPROVAL هستند و در «کارتابل تأیید» تننت مادر
 * (entityType = TENANT_INVOICE) می‌نشینند. فقط بعد از تأیید مدیر PENDING می‌شوند: برای تننت دیده می‌شوند،
 * قابل‌پرداخت‌اند و اعلان می‌گیرند. ردِ مدیر (با دلیل) فاکتور را FAILED می‌کند.
 * فاکتورِ در انتظار تأیید هیچ اثری روی تعلیق/تمدید/فعال‌سازی ندارد.
 */
@Injectable()
export class TenantInvoiceApprovalService implements OnModuleInit {
  private readonly logger = new Logger('TenantInvoiceApprovalService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly sms?: ExirSmsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('TENANT_INVOICE', {
      approve: (ctx, invoiceId, opts) => this.approve(ctx, invoiceId, opts.note),
      reject: (ctx, invoiceId, opts) => this.reject(ctx, invoiceId, opts.note),
      describe: async (_ctx, invoiceId) => {
        const inv = await this.controlDb.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { tenant: { select: { name: true, slug: true } } } });
        return {
          fields: [
            { label: 'تننت', value: `${inv.tenant.name} (${inv.tenant.slug})` },
            { label: 'بابت', value: inv.purpose ? (PURPOSE_LABEL[inv.purpose] ?? inv.purpose) : 'پلن' },
            { label: 'اقلام', value: describeLines(inv.items) || '—' },
            { label: 'مبلغ (تومان)', value: inv.amount.toLocaleString('en-US') },
            { label: 'سررسید', value: inv.dueAt.toISOString().slice(0, 10) },
            { label: 'وضعیت', value: inv.status === 'AWAITING_APPROVAL' ? 'در انتظار تأیید مدیر' : inv.status },
            { label: 'ویرایش', value: 'برای اصلاح مبلغ یا سررسید، از «مدیریت پلتفرم ← فاکتورها» اقدام کنید' },
          ],
        };
      },
    });
  }

  // ── تنظیمات (در تنظیمات تننت مادر) ───────────────────────────────────
  async getSettings(tenantDb: TenantPrismaClient): Promise<InvoiceApprovalSettings> {
    const row = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SETTING } });
    return normalizeInvoiceApprovalSettings(row?.value);
  }

  async saveSettings(tenantDb: TenantPrismaClient, input: unknown): Promise<InvoiceApprovalSettings> {
    const value = normalizeInvoiceApprovalSettings(input);
    await tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SETTING }, create: { ...SETTING, value: value as never }, update: { value: value as never } });
    return value;
  }

  /** وضعیت اولیه‌ی یک فاکتور تازه بر اساس منشأ صدور. هر خطایی → PENDING (مثل قبل)، تا صدور فاکتور هیچ‌وقت نخوابد. */
  async initialState(source: InvoiceIssueSource): Promise<{ status: 'PENDING' | 'AWAITING_APPROVAL'; issueSource: InvoiceIssueSource }> {
    try {
      const parent = await getParentTenant(this.controlDb, this.tenantPrisma);
      const settings = parent ? await this.getSettings(parent.tenantDb) : normalizeInvoiceApprovalSettings(undefined);
      return { status: requiresApproval(source, settings, !!parent) ? 'AWAITING_APPROVAL' : 'PENDING', issueSource: source };
    } catch (err) {
      this.logger.warn(`initialState failed, issuing as PENDING: ${err instanceof Error ? err.message : err}`);
      return { status: 'PENDING', issueSource: source };
    }
  }

  /** فاکتور دستیِ تازه‌صادرشده (کارشناس پنل ادمین) را اگر تنظیمات بخواهد، به انتظار تأیید می‌برد. true = نگه داشته شد (اعلان به تننت نرود). */
  async holdIfRequired(invoiceId: string, source: InvoiceIssueSource): Promise<boolean> {
    const init = await this.initialState(source);
    if (init.status !== 'AWAITING_APPROVAL') return false;
    await this.controlDb.invoice.updateMany({ where: { id: invoiceId, status: 'PENDING' }, data: { status: 'AWAITING_APPROVAL', issueSource: source } });
    await this.submit(invoiceId);
    return true;
  }

  /** درخواست تأیید را در کارتابل مدیر تننت مادر می‌سازد (idempotent؛ تکراری نمی‌سازد). */
  async submit(invoiceId: string): Promise<boolean> {
    try {
      const parent = await getParentTenant(this.controlDb, this.tenantPrisma);
      if (!parent) return false;
      const inv = await this.controlDb.invoice.findUnique({ where: { id: invoiceId }, include: { tenant: { select: { name: true } } } });
      if (!inv || inv.status !== 'AWAITING_APPROVAL') return false;
      // اثرانگشت محتوایی که الان در کارتابل نشان داده می‌شود؛ approve فقط با همین معتبر است
      await this.controlDb.invoice.updateMany({ where: { id: inv.id, status: 'AWAITING_APPROVAL' }, data: { approvalHash: invoiceContentHash(inv) } });
      const ctx = this.systemCtx(parent);
      await this.approvals.request(ctx, {
        moduleCode: 'platform',
        entityType: 'TENANT_INVOICE',
        entityId: inv.id,
        title: `تأیید فاکتور ${inv.tenant.name} — ${inv.amount.toLocaleString('en-US')} تومان`,
        summary: `${inv.purpose ? (PURPOSE_LABEL[inv.purpose] ?? inv.purpose) : 'پلن'}: ${describeLines(inv.items) || '—'}`,
        link: `/platform?tab=invoices&invoice=${inv.id}`,
      });
      return true;
    } catch (err) {
      this.logger.warn(`submit(${invoiceId}) failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** فاکتورهای در انتظارِ بدون درخواست باز در کارتابل (مثلاً خطای لحظه‌ای) دوباره ثبت می‌شوند — از cron روزانه. */
  async resubmitMissing(): Promise<number> {
    const parent = await getParentTenant(this.controlDb, this.tenantPrisma).catch(() => null);
    if (!parent) return 0;
    const awaiting = await this.controlDb.invoice.findMany({ where: { status: 'AWAITING_APPROVAL' }, select: { id: true }, take: 200 });
    let n = 0;
    for (const inv of awaiting) {
      const open = await parent.tenantDb.approvalRequest.findFirst({ where: { entityType: 'TENANT_INVOICE', entityId: inv.id, status: 'PENDING' }, select: { id: true } });
      if (!open && (await this.submit(inv.id))) n++;
    }
    return n;
  }

  /** ویرایش مبلغ/سررسید قبل از تأیید (فقط فاکتور در انتظار). */
  async editAwaiting(
    actor: { sub: string; tenantSlug: string },
    invoiceId: string,
    input: { dueAt?: Date; lines?: Array<{ index: number; amount: number }>; amount?: number },
  ) {
    const inv = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('فاکتور یافت نشد');
    if (inv.status !== 'AWAITING_APPROVAL') throw new BadRequestException('فقط فاکتورِ در انتظار تأیید قابل ویرایش است');
    const hasLines = Array.isArray(inv.items) && (inv.items as unknown[]).length > 0;
    let data: { amount?: number; items?: never; dueAt?: Date } = {};
    if (input.lines?.length && hasLines) {
      const r = applyLineEdits(inv.items, input.lines);
      data = { amount: r.amount, items: r.items as never };
    } else if (typeof input.amount === 'number' && input.amount >= 0 && !hasLines) {
      data = { amount: Math.round(input.amount) };
    }
    if (input.dueAt) data.dueAt = input.dueAt;
    if (Object.keys(data).length === 0) throw new BadRequestException('تغییری ارسال نشد');
    // نوشتن مشروط به همان وضعیت: اگر هم‌زمان تأیید/رد شده باشد، ویرایش اعمال نمی‌شود
    const written = await this.controlDb.invoice.updateMany({ where: { id: invoiceId, status: 'AWAITING_APPROVAL' }, data: { ...data, lastEditedById: actor.sub } });
    if (written.count !== 1) throw new BadRequestException('فاکتور هم‌زمان تغییر کرد یا دیگر در انتظار تأیید نیست');
    const updated = await this.controlDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user', actorId: actor.sub, tenantId: inv.tenantId, action: 'invoice.updated', entityType: 'Invoice', entityId: invoiceId,
        metadata: { before: { amount: inv.amount, dueAt: inv.dueAt }, after: { amount: updated.amount, dueAt: updated.dueAt }, source: PARENT_SOURCE, parentTenantSlug: actor.tenantSlug, edited: true } as never,
      },
    });
    // درخواست قبلی (با محتوای قدیمی) باطل و درخواست تازه با اثرانگشت جدید ساخته می‌شود تا تأیید فقط روی محتوای دیده‌شده بنشیند
    const parent = await getParentTenant(this.controlDb, this.tenantPrisma);
    if (parent) {
      await parent.tenantDb.approvalRequest.updateMany({
        where: { entityType: 'TENANT_INVOICE', entityId: invoiceId, status: 'PENDING' },
        data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: 'فاکتور ویرایش شد؛ درخواست تازه جایگزین شد' },
      });
      await this.submit(invoiceId);
    }
    return updated;
  }

  // ── تصمیم مدیر ──────────────────────────────────────────────────────
  private assertParent(ctx: TenantRequestContext) {
    if (ctx.tenantSlug !== platformTenantSlug()) throw new ForbiddenException('فقط تننت مادر می‌تواند فاکتور تننت‌ها را تأیید یا رد کند');
  }

  async approve(ctx: TenantRequestContext, invoiceId: string, note?: string): Promise<void> {
    this.assertParent(ctx);
    const inv = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('فاکتور یافت نشد');
    if (inv.status === 'PENDING' || inv.status === 'PAID') return; // قبلاً از مسیر دیگری باز شده
    if (inv.status !== 'AWAITING_APPROVAL') throw new BadRequestException('این فاکتور دیگر در انتظار تأیید نیست');
    // تأیید فقط روی همان مبلغ/سررسید/اقلامی معتبر است که هنگام ارسال به کارتابل ثبت شده
    if (!inv.approvalHash || inv.approvalHash !== invoiceContentHash(inv)) throw new BadRequestException('فاکتور تغییر کرده است، دوباره آن را ببینید');
    const settings = await this.getSettings(ctx.tenantDb);
    if (settings.requireDifferentApprover && inv.lastEditedById && inv.lastEditedById === ctx.auth.sub) {
      throw new ForbiddenException('ویرایش‌کننده‌ی فاکتور نمی‌تواند خودش آن را تأیید کند');
    }
    // claim اتمیک: دو تأییدِ هم‌زمان فقط یک‌بار اعلان می‌سازند؛ شرطِ hash هم‌زمان با نوشتن بررسی می‌شود
    const claimed = await this.controlDb.invoice.updateMany({
      where: { id: invoiceId, status: 'AWAITING_APPROVAL', approvalHash: inv.approvalHash },
      data: { status: 'PENDING', approvedAt: new Date(), approvalNote: note ?? null },
    });
    if (claimed.count !== 1) return;
    await this.audit(ctx, inv.tenantId, 'invoice.approved', invoiceId, { amount: inv.amount, note });
    await this.notifyTenant(inv);
  }

  async reject(ctx: TenantRequestContext, invoiceId: string, note?: string): Promise<void> {
    this.assertParent(ctx);
    const inv = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('فاکتور یافت نشد');
    if (inv.status !== 'AWAITING_APPROVAL') return;
    // قفل pendingRenewalInvoiceId عمداً آزاد نمی‌شود تا cron هر روز دوباره فاکتور نسازد؛ مدیر در صورت نیاز فاکتور دستی صادر می‌کند.
    await this.controlDb.invoice.updateMany({ where: { id: invoiceId, status: 'AWAITING_APPROVAL' }, data: { status: 'FAILED', approvalNote: note ?? 'رد شد در کارتابل تأیید' } });
    await this.audit(ctx, inv.tenantId, 'invoice.rejected', invoiceId, { amount: inv.amount, note });
  }

  private async audit(ctx: TenantRequestContext, tenantId: string, action: string, invoiceId: string, metadata: Record<string, unknown>) {
    await this.controlDb.auditLog.create({
      data: { actorType: 'global_user', actorId: ctx.auth.sub, tenantId, action, entityType: 'Invoice', entityId: invoiceId, metadata: { ...metadata, source: PARENT_SOURCE, parentTenantSlug: ctx.tenantSlug } as never },
    });
  }

  /** بعد از تأیید: فاکتور برای تننت «صادر شده» حساب می‌شود (اعلان درون‌برنامه/پوش به مدیران تننت + پیامک یادآوری تمدید به مالک). */
  private async notifyTenant(inv: { id: string; tenantId: string; amount: number; purpose: string | null; items: unknown }): Promise<void> {
    try {
      const tenant = await this.controlDb.tenant.findUnique({ where: { id: inv.tenantId } });
      if (!tenant) return;
      const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
      const body = `${describeLines(inv.items) || PURPOSE_LABEL[inv.purpose ?? ''] || 'فاکتور'} — ${inv.amount.toLocaleString('en-US')} تومان`;
      const managers = await getManagerUsers(this.controlDb, tenantDb, tenant.id);
      for (const m of managers) {
        await this.notifications
          .notify(tenantDb, { userId: m.tenantUserId, type: 'billing.invoice_issued', title: 'فاکتور جدید برای شما صادر شد', body, link: '/settings/billing' })
          .catch(() => undefined);
      }
      if (inv.purpose === 'MODULE_RENEWAL' && this.sms?.isConfigured()) {
        const owner = await this.controlDb.tenantMembership.findFirst({ where: { tenantId: tenant.id, role: 'OWNER' }, include: { globalUser: true } });
        const phone = owner?.globalUser.phone;
        if (phone) {
          const names = (Array.isArray(inv.items) ? (inv.items as Array<{ moduleName: string }>) : []).map((l) => l.moduleName).join('، ');
          await this.sms.sendSms(phone, `اکسیر ERP: فاکتور تمدید ماژول «${names}» شرکت ${tenant.name} صادر شد. برای تمدید، فاکتور قابل پرداخت را در پنل خود ببینید.`);
        }
      }
    } catch (err) {
      this.logger.warn(`notifyTenant(${inv.id}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** کانتکست سیستمی روی تننت مادر (برای cron که درخواست HTTP ندارد). */
  private systemCtx(parent: { tenantId: string; slug: string; tenantDb: TenantPrismaClient }): TenantRequestContext {
    return { auth: { type: 'tenant_user', sub: 'system', role: 'OWNER' } as never, tenantId: parent.tenantId, tenantSlug: parent.slug, tenantDb: parent.tenantDb };
  }
}
