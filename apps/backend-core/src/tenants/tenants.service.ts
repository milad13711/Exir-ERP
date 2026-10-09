import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { sealTenantDbPassword } from '../prisma/tenant-db-credentials.js';
import { seedDefaultTenantData, getSystemRoleId, type IndustryTemplateSeed } from './default-tenant-data.seed.js';
import { ReferralSyncService } from './referral-sync.service.js';
import { addBillingPeriod } from '../modules-catalog/module-pricing.js';
import type { Tenant } from '../../generated/control-client/index.js';

export type CreateTenantInput = {
  name: string;
  slug: string;
  ownerPhone: string;
  ownerName: string;
  planCode: string;
  industryTemplateCode?: string;
  /**
   * True only for tenants provisioned through the public self-signup wizard
   * (no admin in the loop). Forces payment for any paid plan even when no
   * industry template was picked — the industry-template-implies-payment
   * shortcut below is safe for admin-created tenants (a trusted actor
   * choosing to skip it for an internal/test tenant) but would otherwise be
   * a free-paid-tenant loophole once tenant creation is reachable publicly.
   */
  isPublicSignup?: boolean;
  /**
   * Extra module codes to install beyond isCore + the industry template's
   * own defaultModules — the "شخصی‌سازی برای کسب‌وکار من" wizard path, where
   * the visitor picks a base industry for its roles/CoA but then hand-picks
   * their own module set on top of it. Ignored for admin-created tenants
   * that don't go through the wizard.
   */
  extraModuleCodes?: string[];
  /** کد رفرال یک نماینده — از لینک ثبت‌نام (`?ref=`) گرفته می‌شود؛ ببینید ReferralSyncService. */
  resellerCode?: string;
};

export type TenantActor = { type: 'admin_user'; id: string } | { type: 'system'; id: null };

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,48}$/;

@Injectable()
export class TenantsService {
  private readonly logger = new Logger('TenantsService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly dbAdmin: TenantDbAdminService,
    private readonly referralSync: ReferralSyncService,
  ) {}

  /**
   * Full tenant onboarding, run synchronously end-to-end: allocate a
   * dedicated Postgres database, migrate it to the current tenant schema,
   * seed default roles, create the owner's membership, and start their
   * subscription. Any failure after the Tenant row is created leaves it in
   * PENDING_PROVISION for the management team to retry or investigate —
   * it never silently leaves a half-built tenant marked ACTIVE.
   */
  async createTenant(input: CreateTenantInput, actor: TenantActor): Promise<Tenant> {
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new BadRequestException(
        'شناسه تننت باید فقط شامل حروف کوچک انگلیسی، عدد و خط تیره باشد',
      );
    }

    const plan = await this.controlDb.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw new NotFoundException('پلن انتخاب‌شده یافت نشد');

    const industryTemplate = input.industryTemplateCode
      ? await this.controlDb.industryTemplate.findUnique({ where: { code: input.industryTemplateCode } })
      : null;
    if (input.industryTemplateCode && !industryTemplate) {
      throw new NotFoundException('قالب صنف انتخاب‌شده یافت نشد');
    }

    const slugTaken = await this.controlDb.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (slugTaken) {
      throw new ConflictException('این شناسه قبلاً استفاده شده است، شناسه‌ی دیگری انتخاب کنید');
    }

    const dbName = `exir_tenant_${input.slug.replace(/-/g, '_')}`;
    const dbHost = process.env.TENANT_DB_HOST ?? '127.0.0.1';
    const dbPort = Number(process.env.TENANT_DB_PORT ?? 5433);

    const tenant = await this.controlDb.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        dbHost,
        dbPort,
        dbName,
        themeColor: industryTemplate?.suggestedThemeColor ?? undefined,
      },
    });

    try {
      // S-14: a new tenant gets its own least-privilege Postgres role (when APP_SECRETS_KEY is configured);
      // migrations still run privileged, then ownership is handed to that role.
      let dbRole: string | null = null;
      if (this.dbAdmin.wantsRole()) {
        const { user, password } = await this.dbAdmin.createDatabaseWithRole(dbHost, dbPort, dbName, input.slug);
        dbRole = user;
        await this.controlDb.tenant.update({
          where: { id: tenant.id },
          data: { dbUser: user, dbPasswordEnc: sealTenantDbPassword(password, dbName) },
        });
        await this.tenantPrisma.refreshCredentials();
      } else {
        await this.dbAdmin.createDatabase(dbHost, dbPort, dbName);
      }
      await this.dbAdmin.applyTenantSchema(dbHost, dbPort, dbName, dbRole);

      const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
      await seedDefaultTenantData(
        tenantDb,
        industryTemplate
          ? {
              roles: industryTemplate.roles as unknown as IndustryTemplateSeed['roles'],
              chartOfAccounts: industryTemplate.chartOfAccounts as unknown as IndustryTemplateSeed['chartOfAccounts'],
            }
          : undefined,
      );
      const ownerRoleId = await getSystemRoleId(tenantDb, 'مدیر سیستم');

      const globalUser = await this.controlDb.globalUser.upsert({
        where: { phone: input.ownerPhone },
        create: { phone: input.ownerPhone, name: input.ownerName },
        update: {},
      });

      await this.controlDb.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          globalUserId: globalUser.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      await tenantDb.user.create({
        data: {
          globalUserId: globalUser.id,
          name: input.ownerName,
          phone: input.ownerPhone,
          status: 'ACTIVE',
          roles: { create: [{ roleId: ownerRoleId }] },
        },
      });

      const defaultModuleCodes = [...(industryTemplate?.defaultModules ?? []), ...(input.extraModuleCodes ?? [])];
      const modulesToInstall = await this.controlDb.moduleDefinition.findMany({
        where: { OR: [{ isCore: true }, { code: { in: defaultModuleCodes } }] },
      });
      await this.controlDb.tenantModule.createMany({
        data: modulesToInstall.map((m) => ({ tenantId: tenant.id, moduleId: m.id })),
        skipDuplicates: true,
      });

      const now = new Date();

      // مسیر ثبت‌نام عمومی: به‌جای انتظار برای تأیید دستی پرداخت، سازمان
      // بلافاصله فعال می‌شود با ۲۴ ساعت استفاده‌ی رایگان — پیش‌فاکتور برای پلن
      // انتخابی صادر می‌شود ولی سررسیدش تا پایان همین بازه است و ورود را
      // مسدود نمی‌کند. پس از ۲۴ ساعت، TrialExpiryCronService (هر ساعت اجرا
      // می‌شود) سازمان‌های استفاده‌نشده را به PENDING_PAYMENT می‌برد (دقیقاً
      // همان گیت موجود در JwtAuthGuard). ادمین می‌تواند از پنل مدیریت این
      // بازه را دستی تمدید کند (AdminTenantsController). تننت‌های
      // ساخته‌شده توسط ادمین همان رفتار قبلی (یک ماه مهلت، بدون فعال‌سازی
      // خودکار روی پلن پولی) را دارند.
      const isFreeTrialSignup = !!input.isPublicSignup;
      const periodEnd = new Date(now);
      if (isFreeTrialSignup) {
        periodEnd.setHours(periodEnd.getHours() + 24);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await this.controlDb.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'TRIAL',
          currentPeriodEnd: periodEnd,
        },
      });

      // پیش‌فاکتورِ همان پلنی که کاربر انتخاب کرده، همیشه صادر می‌شود (چه در
      // مسیر رایگان و چه در مسیر قدیمی) — تفاوت فقط در اینکه آیا سررسیدش
      // ورود را مسدود می‌کند یا نه.
      const requiresPayment = !isFreeTrialSignup && (!!industryTemplate || !!input.isPublicSignup) && plan.priceMonthly > 0;
      if (isFreeTrialSignup ? plan.priceMonthly > 0 : requiresPayment) {
        await this.controlDb.invoice.create({
          data: {
            tenantId: tenant.id,
            amount: plan.priceMonthly,
            status: 'PENDING',
            dueAt: isFreeTrialSignup ? periodEnd : now,
          },
        });
      }

      const activated = await this.controlDb.tenant.update({
        where: { id: tenant.id },
        data: {
          status: requiresPayment ? 'PENDING_PAYMENT' : 'ACTIVE',
          provisionedAt: new Date(),
        },
      });

      await this.controlDb.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          tenantId: tenant.id,
          action: 'tenant.created',
          entityType: 'Tenant',
          entityId: tenant.id,
          metadata: { name: input.name, slug: input.slug, planCode: input.planCode },
        },
      });

      await this.referralSync.onTenantCreated(activated, input.ownerName, input.ownerPhone, input.resellerCode);

      return activated;
    } catch (err) {
      this.logger.error(`provisioning failed for tenant ${tenant.slug}`, err as Error);
      await this.controlDb.errorLog.create({
        data: {
          tenantId: tenant.id,
          service: 'backend-core',
          level: 'FATAL',
          message: `Tenant provisioning failed: ${(err as Error).message}`,
          stackTrace: (err as Error).stack,
        },
      });
      throw err;
    }
  }

  async suspendTenant(tenantId: string, reason: string, actorAdminId: string): Promise<Tenant> {
    const tenant = await this.controlDb.tenant.update({
      where: { id: tenantId },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason },
    });
    await this.tenantPrisma.evict(tenant.dbName);
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actorAdminId,
        tenantId,
        action: 'tenant.suspended',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { reason },
      },
    });
    return tenant;
  }

  async reactivateTenant(tenantId: string, actorAdminId: string): Promise<Tenant> {
    const tenant = await this.controlDb.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE', suspendedAt: null, suspendReason: null },
    });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actorAdminId,
        tenantId,
        action: 'tenant.reactivated',
        entityType: 'Tenant',
        entityId: tenantId,
      },
    });
    return tenant;
  }

  async listTenants() {
    return this.controlDb.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptions: { orderBy: { startedAt: 'desc' }, take: 1, include: { plan: true } },
        _count: { select: { memberships: true, supportTickets: true } },
      },
    });
  }

  /**
   * Extends the tenant's current subscription period by `months` from
   * whichever is later — today or its current expiry (so renewing early
   * adds on top instead of wasting the remaining days) — and issues a PAID
   * invoice for the period. Reactivates a lapsed (PAST_DUE) subscription —
   * and, if the tenant itself had lapsed into PENDING_PAYMENT (e.g. an
   * expired free trial via TrialExpiryCronService), also flips Tenant.status
   * back to ACTIVE so the renewal actually restores login, not just the
   * subscription record. This is the admin's manual "extend the demo" and
   * "reactivate after payment" action — same idea as settleInvoicePaid's
   * shouldActivate check, duplicated here since renewTenant creates its own
   * already-PAID invoice rather than going through that path.
   */
  async renewTenant(tenantId: string, months: number, actorAdminId: string) {
    const [subscription, tenant] = await Promise.all([
      this.controlDb.subscription.findFirst({
        where: { tenantId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
        orderBy: { startedAt: 'desc' },
        include: { plan: true },
      }),
      this.controlDb.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    if (!subscription) throw new NotFoundException('این تننت اشتراک فعالی ندارد');
    const shouldActivateTenant = tenant?.status === 'PENDING_PAYMENT';

    const base = subscription.currentPeriodEnd > new Date() ? subscription.currentPeriodEnd : new Date();
    const newPeriodEnd = new Date(base);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + months);

    const [updated, invoice] = await this.controlDb.$transaction([
      this.controlDb.subscription.update({
        where: { id: subscription.id },
        data: { status: 'ACTIVE', currentPeriodEnd: newPeriodEnd },
      }),
      this.controlDb.invoice.create({
        data: {
          tenantId,
          subscriptionId: subscription.id,
          amount: subscription.plan.priceMonthly * months,
          status: 'PAID',
          dueAt: new Date(),
          paidAt: new Date(),
        },
      }),
      this.controlDb.auditLog.create({
        data: {
          actorType: 'admin_user',
          actorId: actorAdminId,
          tenantId,
          action: 'tenant.renewed',
          entityType: 'Tenant',
          entityId: tenantId,
          metadata: { months, newPeriodEnd },
        },
      }),
      ...(shouldActivateTenant
        ? [this.controlDb.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' as const } })]
        : []),
    ]);

    await this.referralSync.onInvoicePaid(invoice.id, tenantId, invoice.amount);

    return { subscription: updated, invoice };
  }

  /**
   * Permanent, irreversible deletion — drops the tenant's isolated database
   * outright and removes its Control Plane row (cascading to memberships,
   * subscriptions, invoices, module installs, support tickets). Only ever
   * called after the caller has already confirmed this with the operator;
   * there is no soft-delete/undo here by design — use suspendTenant for
   * anything reversible.
   */
  async deleteTenant(tenantId: string, actorAdminId: string): Promise<void> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');

    await this.tenantPrisma.evict(tenant.dbName);
    await this.dbAdmin.dropDatabase(tenant.dbHost, tenant.dbPort, tenant.dbName, tenant.dbUser);

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actorAdminId,
        tenantId: null,
        action: 'tenant.deleted',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { name: tenant.name, slug: tenant.slug },
      },
    });
    await this.controlDb.tenant.delete({ where: { id: tenantId } });
  }

  /** A live snapshot of one tenant's own database — for the admin monitoring view. */
  async getTenantStats(tenantId: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');

    const tenantDb = this.tenantPrisma.forTenant({
      dbHost: tenant.dbHost,
      dbPort: tenant.dbPort,
      dbName: tenant.dbName,
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const [userCount, openTaskCount, lastActivity, recentErrorCount] = await Promise.all([
      tenantDb.user.count({ where: { status: 'ACTIVE' } }),
      tenantDb.task.count({ where: { status: 'OPEN' } }),
      tenantDb.activityLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.controlDb.errorLog.count({ where: { tenantId, createdAt: { gte: sevenDaysAgo } } }),
    ]);

    return {
      userCount,
      openTaskCount,
      lastActivityAt: lastActivity?.createdAt ?? null,
      recentErrorCount,
    };
  }

  private async findModuleOrThrow(code: string) {
    const module = await this.controlDb.moduleDefinition.findUnique({ where: { code } });
    if (!module) throw new NotFoundException('ماژول یافت نشد');
    return module;
  }

  /** Admin-only equivalent of the old tenant self-service install/uninstall. */
  async setTenantModule(
    tenantId: string,
    moduleCode: string,
    status: 'INSTALLED' | 'DISABLED',
    actorAdminId: string,
  ) {
    const module = await this.findModuleOrThrow(moduleCode);
    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      create: { tenantId, moduleId: module.id, status },
      update: { status },
    });
    await this.controlDb.auditLog.create({
      data: {
        actorType: 'admin_user',
        actorId: actorAdminId,
        tenantId,
        action: status === 'INSTALLED' ? 'module.installed' : 'module.uninstalled',
        entityType: 'ModuleDefinition',
        entityId: module.id,
        metadata: { code: moduleCode },
      },
    });
    return tenantModule;
  }

  listTenantModules(tenantId: string) {
    return this.controlDb.moduleDefinition.findMany({
      orderBy: { createdAt: 'asc' },
      include: { tenantModules: { where: { tenantId } } },
    });
  }

  listInvoices(tenantId: string) {
    return this.controlDb.invoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /**
   * Issues a pre-invoice (پیش‌فاکتور) — a PENDING record only, with no
   * effect on the subscription itself. Renewal (which extends the period
   * and records payment) stays a separate, explicit action via renewTenant.
   */
  async createInvoice(
    tenantId: string,
    input: { amount: number; dueAt: Date; subscriptionId?: string; lines?: Array<{ name: string; amount: number }> },
    actorAdminId: string,
  ) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('تننت یافت نشد');

    const [invoice] = await this.controlDb.$transaction([
      this.controlDb.invoice.create({
        data: {
          tenantId,
          subscriptionId: input.subscriptionId,
          amount: input.amount,
          status: 'PENDING',
          dueAt: input.dueAt,
          items: input.lines?.length ? (input.lines.map((l) => ({ moduleCode: 'manual', moduleName: l.name, billingMode: 'MANUAL', amount: l.amount })) as never) : undefined,
        },
      }),
      this.controlDb.auditLog.create({
        data: {
          actorType: 'admin_user',
          actorId: actorAdminId,
          tenantId,
          action: 'invoice.issued',
          entityType: 'Invoice',
          metadata: { amount: input.amount, dueAt: input.dueAt },
        },
      }),
    ]);
    return invoice;
  }

  /** تنظیم دستی اشتراک: روز باقی‌مانده (تاریخ پایان)، وضعیت، مادام‌العمر و پلن — با ثبت در لاگ ممیزی. */
  async updateSubscription(
    tenantId: string,
    input: { currentPeriodEnd?: Date; status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'; lifetime?: boolean; planCode?: string },
    actorAdminId: string,
  ) {
    const subscription = await this.controlDb.subscription.findFirst({ where: { tenantId }, orderBy: { startedAt: 'desc' } });
    if (!subscription) throw new NotFoundException('این تننت اشتراکی ندارد');
    let planId: string | undefined;
    if (input.planCode) {
      const plan = await this.controlDb.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw new NotFoundException('پلن یافت نشد');
      planId = plan.id;
    }
    const lifetime = input.lifetime ?? subscription.lifetime;
    // مادام‌العمر: تاریخ پایان صد سال بعد (نمایشی)؛ کرون‌های انقضا هرگز آن را منقضی نمی‌کنند
    const end = input.currentPeriodEnd ?? (input.lifetime && !subscription.lifetime ? new Date(Date.now() + 100 * 365 * 86_400_000) : undefined);

    const updated = await this.controlDb.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodEnd: end, status: input.status, lifetime: input.lifetime, planId },
    });
    if (input.status === 'ACTIVE' || input.status === 'TRIAL') {
      await this.controlDb.tenant.updateMany({ where: { id: tenantId, status: 'PENDING_PAYMENT' }, data: { status: 'ACTIVE' } });
    }
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: actorAdminId, tenantId, action: 'subscription.updated', entityType: 'Subscription', entityId: subscription.id, metadata: { before: { end: subscription.currentPeriodEnd, status: subscription.status, lifetime: subscription.lifetime }, after: { end, status: input.status, lifetime } } as never },
    });
    return updated;
  }

  /** ویرایش فاکتور توسط ادمین (مبلغ، مهلت، ردیف‌های دستی، وضعیت غیرپرداخت). */
  async updateInvoice(
    tenantId: string,
    invoiceId: string,
    input: { amount?: number; dueAt?: Date; status?: 'PENDING' | 'FAILED'; lines?: Array<{ name: string; amount: number }> },
    actorAdminId: string,
  ) {
    const invoice = await this.controlDb.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    const updated = await this.controlDb.invoice.update({
      where: { id: invoiceId },
      data: {
        amount: input.amount,
        dueAt: input.dueAt,
        status: input.status,
        ...(input.status ? { paidAt: null, paymentRefId: null } : {}),
        ...(input.lines ? { items: input.lines.map((l) => ({ moduleCode: 'manual', moduleName: l.name, billingMode: 'MANUAL', amount: l.amount })) as never } : {}),
      },
    });
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: actorAdminId, tenantId, action: 'invoice.updated', entityType: 'Invoice', entityId: invoiceId, metadata: { before: { amount: invoice.amount, status: invoice.status }, after: input } as never },
    });
    return updated;
  }

  /** بازگرداندن فاکتور «پرداخت‌شده» به «در انتظار» — برای پرداخت‌های غیرواقعی (سندباکس). ماژول/اشتراکی که با آن پرداخت فعال شده به‌طور خودکار برنمی‌گردد. */
  async markInvoiceUnpaid(tenantId: string, invoiceId: string, actorAdminId: string) {
    const invoice = await this.controlDb.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    const updated = await this.controlDb.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PENDING', paidAt: null, paymentRefId: null, zarinpalAuthority: null },
    });
    await this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: actorAdminId, tenantId, action: 'invoice.marked_unpaid', entityType: 'Invoice', entityId: invoiceId, metadata: { previousPaidAt: invoice.paidAt } as never },
    });
    return updated;
  }

  /** حذف فاکتور (مثلاً فاکتورهای قدیمی پرداخت‌شده‌ی غیرواقعی) — با ثبت در لاگ ممیزی. */
  async deleteInvoice(tenantId: string, invoiceId: string, actorAdminId: string) {
    const invoice = await this.controlDb.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    await this.controlDb.$transaction([
      this.controlDb.invoice.delete({ where: { id: invoiceId } }),
      this.controlDb.auditLog.create({
        data: { actorType: 'admin_user', actorId: actorAdminId, tenantId, action: 'invoice.deleted', entityType: 'Invoice', entityId: invoiceId, metadata: { amount: invoice.amount, status: invoice.status, purpose: invoice.purpose } as never },
      }),
    ]);
    return { success: true };
  }

  async markInvoicePaid(
    invoiceId: string,
    actorAdminId: string,
    opts?: { actorType?: string; metadata?: Record<string, unknown> },
  ) {
    return this.settleInvoicePaid(invoiceId, { actorType: opts?.actorType ?? 'admin_user', actorId: actorAdminId, metadata: opts?.metadata });
  }

  /** Same settlement, but for a customer's own Zarinpal payment — no admin actor involved. */
  async markInvoicePaidByGateway(invoiceId: string, refId: number) {
    return this.settleInvoicePaid(invoiceId, { actorType: 'system', actorId: null, metadata: { refId }, paymentRefId: refId });
  }

  private async settleInvoicePaid(
    invoiceId: string,
    actor: { actorType: string; actorId: string | null; metadata?: Record<string, unknown>; paymentRefId?: number },
  ) {
    const invoice = await this.controlDb.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    if (invoice.status === 'PAID') return invoice;

    const tenant = await this.controlDb.tenant.findUnique({ where: { id: invoice.tenantId } });
    const shouldActivate = tenant?.status === 'PENDING_PAYMENT';

    const [updated] = await this.controlDb.$transaction([
      this.controlDb.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: new Date(), paymentRefId: actor.paymentRefId },
      }),
      this.controlDb.auditLog.create({
        data: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          tenantId: invoice.tenantId,
          action: 'invoice.paid',
          entityType: 'Invoice',
          entityId: invoiceId,
          metadata: { amount: invoice.amount, ...actor.metadata },
        },
      }),
      ...(shouldActivate
        ? [this.controlDb.tenant.update({ where: { id: invoice.tenantId }, data: { status: 'ACTIVE' } })]
        : []),
    ]);

    if (invoice.purpose === 'MODULE_PURCHASE' || invoice.purpose === 'MODULE_RENEWAL') {
      await this.activatePurchasedModules(invoice.tenantId, invoiceId, invoice.items);
    }

    if (invoice.purpose === 'SMS_PACKAGE') {
      // شارژ آنی کیف پول پیامکی — فاکتور فقط یک‌بار PAID می‌شود (بالاتر برگشت زودهنگام دارد)، پس دوبار اعتبار نمی‌گیرد
      const credits = (invoice.items as { credits?: number } | null)?.credits ?? 0;
      if (credits > 0) {
        await this.controlDb.tenantSmsWallet.upsert({
          where: { tenantId: invoice.tenantId },
          create: { tenantId: invoice.tenantId, credits },
          update: { credits: { increment: credits } },
        });
      }
    }

    // خرید بسته‌ی پیامکی درآمد اشتراک/ماژول نیست؛ کمیسیون رفرال نمی‌گیرد
    if (invoice.purpose !== 'SMS_PACKAGE') {
      await this.referralSync.onInvoicePaid(invoiceId, invoice.tenantId, invoice.amount);
    }

    return updated;
  }

  /**
   * فقط بعد از پرداخت واقعی این فاکتور — نه در لحظه‌ی افزودن به سبد خرید —
   * هر ماژول موجود در items را نصب/تمدید می‌کند. کاربر باید صفحه را رفرش
   * کند تا وضعیت جدید را ببیند (طبق درخواست، بدون polling زنده).
   */
  private async activatePurchasedModules(tenantId: string, invoiceId: string, itemsJson: unknown) {
    if (!Array.isArray(itemsJson)) return;
    const items = itemsJson as { moduleCode: string; billingMode: 'MONTHLY' | 'YEARLY' | 'LICENSE' }[];
    const modules = await this.controlDb.moduleDefinition.findMany({
      where: { code: { in: items.map((i) => i.moduleCode) } },
    });
    const moduleByCode = new Map(modules.map((m) => [m.code, m]));

    for (const item of items) {
      const module = moduleByCode.get(item.moduleCode);
      if (!module) continue;

      const existing = await this.controlDb.tenantModule.findUnique({
        where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      });
      // Renewal extends from whichever is later — the old period end (still
      // running) or now (already expired) — a fresh purchase always starts from now.
      const base =
        existing?.pendingRenewalInvoiceId === invoiceId && existing.currentPeriodEnd && existing.currentPeriodEnd > new Date()
          ? existing.currentPeriodEnd
          : new Date();
      const currentPeriodEnd = addBillingPeriod(base, item.billingMode);

      await this.controlDb.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
        create: { tenantId, moduleId: module.id, status: 'INSTALLED', billingMode: item.billingMode, currentPeriodEnd },
        update: { status: 'INSTALLED', billingMode: item.billingMode, currentPeriodEnd, pendingRenewalInvoiceId: null },
      });
    }
  }

  async getInvoiceWithContext(invoiceId: string) {
    const invoice = await this.controlDb.invoice.findUnique({
      where: { id: invoiceId },
      include: { tenant: true, subscription: { include: { plan: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    return { invoice, tenant: invoice.tenant, plan: invoice.subscription?.plan ?? null };
  }

  /** The tenant owner's phone number, for SMS notifications — null if no OWNER membership exists. */
  async getOwnerPhone(tenantId: string): Promise<string | null> {
    const membership = await this.controlDb.tenantMembership.findFirst({
      where: { tenantId, role: 'OWNER' },
      include: { globalUser: true },
    });
    return membership?.globalUser.phone ?? null;
  }
}
