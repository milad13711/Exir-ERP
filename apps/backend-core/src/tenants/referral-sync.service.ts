import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ReferralCommissionService } from '../referral-marketing/referral-commission.service.js';
import type { Tenant } from '../../generated/control-client/index.js';

/**
 * پل هم‌گام‌سازی بین رویدادهای کنترل‌پلین (ساخت تننت، پرداخت فاکتور) و
 * تننت رجیستری رفرال — همان تننتی که کد رفرال نمایندگان درونش زندگی
 * می‌کند. ماژول رفرال/نمایندگی خودش عمومی و برای هر تننتی قابل نصب است؛
 * این سرویس فقط استفاده‌ی خاص خودِ exir ERP از همان ماژول را پیاده می‌کند:
 * وقتی یک تننت جدید exirerp ساخته/پرداخت می‌شود، به‌عنوان یک «مشتری
 * معرفی‌شده» (ReferralConversion) در تننت رجیستری پلتفرم (پیش‌فرض «eta»،
 * با RESELLER_REGISTRY_TENANT_SLUG قابل تغییر) ثبت می‌شود — دقیقاً همان
 * مکانیزمی که یک تننت معمولی برای مشتریان واقعی خودش استفاده می‌کند.
 */
@Injectable()
export class ReferralSyncService {
  private readonly logger = new Logger('ReferralSyncService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly commissionService: ReferralCommissionService,
  ) {}

  private get registrySlug(): string {
    return process.env.RESELLER_REGISTRY_TENANT_SLUG ?? 'eta';
  }

  private async getRegistryTenantDb() {
    const registryTenant = await this.controlDb.tenant.findUnique({ where: { slug: this.registrySlug } });
    if (!registryTenant) return null;
    return this.tenantPrisma.forTenant({
      dbHost: registryTenant.dbHost,
      dbPort: registryTenant.dbPort,
      dbName: registryTenant.dbName,
    });
  }

  /**
   * بعد از ساخت موفق یک تننت جدید — چه از طریق نماینده و چه مستقیم — مالک
   * آن به‌عنوان مخاطب مشتری در تننت رجیستری ثبت می‌شود؛ اگر با کد رفرال
   * معتبری آمده باشد، یک ReferralConversion هم برای نماینده‌ی مربوطه ساخته می‌شود.
   */
  async onTenantCreated(tenant: Tenant, ownerName: string, ownerPhone: string, resellerCode?: string): Promise<void> {
    try {
      const registryDb = await this.getRegistryTenantDb();
      if (!registryDb) return; // dev/test env بدون تننت رجیستری — بی‌خطر رد می‌شود

      const contact = await this.upsertCustomerContact(registryDb, ownerName, ownerPhone, tenant.name);

      if (!resellerCode) return;
      const reseller = await registryDb.resellerProfile.findUnique({ where: { referralCode: resellerCode } });
      if (!reseller) return;

      await registryDb.referralConversion.create({
        data: { resellerProfileId: reseller.id, contactId: contact.id, controlTenantId: tenant.id },
      });
    } catch (err) {
      this.logger.error(`referral sync (tenant created) failed for tenant ${tenant.slug}`, err as Error);
    }
  }

  /**
   * بعد از تسویه‌ی واقعی یک فاکتور — پرداخت را در حسابداری تننت رجیستری
   * (به‌عنوان درآمد فروش پلن/ماژول) ثبت می‌کند، و اگر تننت پرداخت‌کننده از
   * طریق یک نماینده معرفی شده بود، کمیسیون او را همان‌طور که برای هر
   * مشتری معرفی‌شده‌ی دیگری بسته می‌شود، می‌بندد (ReferralCommissionService).
   */
  async onInvoicePaid(invoiceId: string, tenantId: string, amount: number): Promise<void> {
    try {
      const registryDb = await this.getRegistryTenantDb();
      if (!registryDb) return;

      const [tenant, membership] = await Promise.all([
        this.controlDb.tenant.findUnique({ where: { id: tenantId } }),
        this.controlDb.tenantMembership.findFirst({ where: { tenantId, role: 'OWNER' }, include: { globalUser: true } }),
      ]);
      if (!tenant) return;
      const ownerName = membership?.globalUser.name ?? tenant.name;
      const ownerPhone = membership?.globalUser.phone ?? '';

      const contact = await this.upsertCustomerContact(registryDb, ownerName, ownerPhone, tenant.name);
      await registryDb.partyTransaction.create({
        data: {
          partyId: contact.id,
          type: 'RECEIPT',
          amount,
          accountCode: '1020',
          note: `دریافت وجه فاکتور تننت «${tenant.name}»`,
        },
      });

      const conversion = await registryDb.referralConversion.findUnique({ where: { controlTenantId: tenantId } });
      if (!conversion) return;

      const description = `کمیسیون معرفی — تننت «${tenant.name}» (فاکتور ${invoiceId})`;
      await this.commissionService.bookCommission(registryDb, conversion.id, amount, description);
    } catch (err) {
      this.logger.error(`referral sync (invoice paid) failed for invoice ${invoiceId}`, err as Error);
    }
  }

  private async upsertCustomerContact(
    registryDb: NonNullable<Awaited<ReturnType<typeof this.getRegistryTenantDb>>>,
    name: string,
    phone: string,
    company: string,
  ) {
    if (phone) {
      const existing = await registryDb.crmContact.findFirst({ where: { phone, isSupplier: false } });
      if (existing) return existing;
    }
    return registryDb.crmContact.create({
      data: { name, company, phone: phone || undefined, isCustomer: true, isSupplier: false, source: 'ثبت‌نام در exirerp.ir' },
    });
  }
}
