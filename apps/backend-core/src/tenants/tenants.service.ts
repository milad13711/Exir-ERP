import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { seedDefaultTenantData, getSystemRoleId, type IndustryTemplateSeed } from './default-tenant-data.seed.js';
import type { Tenant } from '../../generated/control-client/index.js';

export type CreateTenantInput = {
  name: string;
  slug: string;
  ownerPhone: string;
  ownerName: string;
  planCode: string;
  industryTemplateCode?: string;
};

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,48}$/;

@Injectable()
export class TenantsService {
  private readonly logger = new Logger('TenantsService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly dbAdmin: TenantDbAdminService,
  ) {}

  /**
   * Full tenant onboarding, run synchronously end-to-end: allocate a
   * dedicated Postgres database, migrate it to the current tenant schema,
   * seed default roles, create the owner's membership, and start their
   * subscription. Any failure after the Tenant row is created leaves it in
   * PENDING_PROVISION for the management team to retry or investigate —
   * it never silently leaves a half-built tenant marked ACTIVE.
   */
  async createTenant(input: CreateTenantInput, actorAdminId: string): Promise<Tenant> {
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
      await this.dbAdmin.createDatabase(dbHost, dbPort, dbName);
      await this.dbAdmin.applyTenantSchema(dbHost, dbPort, dbName);

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

      const defaultModuleCodes = industryTemplate?.defaultModules ?? [];
      const modulesToInstall = await this.controlDb.moduleDefinition.findMany({
        where: { OR: [{ isCore: true }, { code: { in: defaultModuleCodes } }] },
      });
      await this.controlDb.tenantModule.createMany({
        data: modulesToInstall.map((m) => ({ tenantId: tenant.id, moduleId: m.id })),
        skipDuplicates: true,
      });

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await this.controlDb.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'TRIAL',
          currentPeriodEnd: periodEnd,
        },
      });

      // Picking an industry template means this is a real business signing
      // up, not an internal/test tenant — it must pay for its plan before
      // it can log in. The tenant DB is still fully provisioned either way;
      // only `status` gates access (see JwtAuthGuard), and markInvoicePaid
      // flips it to ACTIVE once the invoice below is settled.
      const requiresPayment = !!industryTemplate && plan.priceMonthly > 0;
      if (requiresPayment) {
        await this.controlDb.invoice.create({
          data: {
            tenantId: tenant.id,
            amount: plan.priceMonthly,
            status: 'PENDING',
            dueAt: now,
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
          actorType: 'admin_user',
          actorId: actorAdminId,
          tenantId: tenant.id,
          action: 'tenant.created',
          entityType: 'Tenant',
          entityId: tenant.id,
          metadata: { name: input.name, slug: input.slug, planCode: input.planCode },
        },
      });

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
   * invoice for the period. Reactivates a lapsed (PAST_DUE) subscription.
   */
  async renewTenant(tenantId: string, months: number, actorAdminId: string) {
    const subscription = await this.controlDb.subscription.findFirst({
      where: { tenantId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { startedAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('این تننت اشتراک فعالی ندارد');

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
    ]);

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
    await this.dbAdmin.dropDatabase(tenant.dbHost, tenant.dbPort, tenant.dbName);

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
    input: { amount: number; dueAt: Date; subscriptionId?: string },
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

  async markInvoicePaid(invoiceId: string, actorAdminId: string) {
    return this.settleInvoicePaid(invoiceId, { actorType: 'admin_user', actorId: actorAdminId });
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
    return updated;
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
