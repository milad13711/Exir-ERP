import { Injectable, Logger } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import type { Tenant } from '../../generated/control-client/index.js';

const COMMISSION_EXPENSE_ACCOUNT_CODE = '5040';
const PAYABLE_ACCOUNT_CODE = '2010';

/**
 * پل هم‌گام‌سازی بین رویدادهای کنترل‌پلین (ساخت تننت، پرداخت فاکتور) و
 * تننت رجیستری رفرال — همان تننتی که کد رفرال نمایندگان درونش زندگی
 * می‌کند. این ویژگی مخصوص فروش خودِ exir ERP است (نه یک قابلیت عمومی
 * چندتننتی)، پس همیشه یک تننت واحد (پیش‌فرض «eta»، با
 * RESELLER_REGISTRY_TENANT_SLUG قابل تغییر) میزبان این داده است.
 */
@Injectable()
export class ReferralSyncService {
  private readonly logger = new Logger('ReferralSyncService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
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
   * معتبری آمده باشد، یک ReferredTenant هم برای نماینده‌ی مربوطه ساخته می‌شود.
   */
  async onTenantCreated(tenant: Tenant, ownerName: string, ownerPhone: string, resellerCode?: string): Promise<void> {
    try {
      const registryDb = await this.getRegistryTenantDb();
      if (!registryDb) return; // dev/test env بدون تننت رجیستری — بی‌خطر رد می‌شود

      await this.upsertCustomerContact(registryDb, ownerName, ownerPhone);

      if (!resellerCode) return;
      const reseller = await registryDb.resellerProfile.findUnique({ where: { referralCode: resellerCode } });
      if (!reseller) return;

      await registryDb.referredTenant.create({
        data: {
          resellerProfileId: reseller.id,
          controlTenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
        },
      });
    } catch (err) {
      this.logger.error(`referral sync (tenant created) failed for tenant ${tenant.slug}`, err as Error);
    }
  }

  /**
   * بعد از تسویه‌ی واقعی یک فاکتور — پرداخت را در حسابداری تننت رجیستری
   * (به‌عنوان درآمد فروش پلن/ماژول) ثبت می‌کند، و اگر تننت پرداخت‌کننده از
   * طریق یک نماینده معرفی شده بود، کمیسیون او را به‌صورت یک سفارش خرید
   * واقعی (بدهی خدماتی) می‌بندد.
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

      const contact = await this.upsertCustomerContact(registryDb, ownerName, ownerPhone);
      await registryDb.partyTransaction.create({
        data: {
          partyId: contact.id,
          type: 'RECEIPT',
          amount,
          accountCode: '1020',
          note: `دریافت وجه فاکتور تننت «${tenant.name}»`,
        },
      });

      const referredTenant = await registryDb.referredTenant.findUnique({ where: { controlTenantId: tenantId } });
      if (!referredTenant) return;

      const paidInvoiceCount = await this.controlDb.invoice.count({ where: { tenantId, status: 'PAID' } });
      const isFirstPayment = paidInvoiceCount <= 1;

      await this.bookCommission(registryDb, referredTenant, amount, isFirstPayment, invoiceId, tenant.name);
    } catch (err) {
      this.logger.error(`referral sync (invoice paid) failed for invoice ${invoiceId}`, err as Error);
    }
  }

  private async upsertCustomerContact(registryDb: NonNullable<Awaited<ReturnType<typeof this.getRegistryTenantDb>>>, name: string, phone: string) {
    if (phone) {
      const existing = await registryDb.crmContact.findFirst({ where: { phone, isSupplier: false } });
      if (existing) return existing;
    }
    return registryDb.crmContact.create({
      data: { name, phone: phone || undefined, isCustomer: true, isSupplier: false, source: 'ثبت‌نام در exirerp.ir' },
    });
  }

  private async bookCommission(
    registryDb: NonNullable<Awaited<ReturnType<typeof this.getRegistryTenantDb>>>,
    referredTenant: { id: string; resellerProfileId: string },
    invoiceAmount: number,
    isFirstPayment: boolean,
    invoiceId: string,
    payingTenantName: string,
  ): Promise<void> {
    const reseller = await registryDb.resellerProfile.findUniqueOrThrow({ where: { id: referredTenant.resellerProfileId } });
    const percent = isFirstPayment ? reseller.commissionFirstPaymentPercent : reseller.commissionRenewalPercent;
    const amount = Math.round((invoiceAmount * percent) / 100);
    if (amount <= 0) return;

    await ensureDefaultChartOfAccounts(registryDb);
    await this.ensureCommissionExpenseAccount(registryDb);
    const [expenseAccount, payableAccount] = await Promise.all([
      registryDb.account.findUniqueOrThrow({ where: { code: COMMISSION_EXPENSE_ACCOUNT_CODE } }),
      registryDb.account.findUniqueOrThrow({ where: { code: PAYABLE_ACCOUNT_CODE } }),
    ]);

    const kind = isFirstPayment ? 'FIRST_PAYMENT' : 'RENEWAL';
    const description = `کمیسیون ${isFirstPayment ? 'پرداخت اول' : 'تمدید'} — تننت «${payingTenantName}» (فاکتور ${invoiceId})`;

    const order = await registryDb.purchaseOrder.create({
      data: {
        supplierId: reseller.contactId,
        status: 'RECEIVED',
        receivedAt: new Date(),
        subtotal: amount,
        total: amount,
        notes: description,
        lines: { create: [{ description, quantity: 1, unitCost: amount, lineTotal: amount }] },
      },
    });

    const entry = await registryDb.journalEntry.create({
      data: {
        date: new Date(),
        description,
        status: 'POSTED',
        postedAt: new Date(),
        lines: {
          create: [
            { accountId: expenseAccount.id, debit: BigInt(amount), credit: BigInt(0) },
            { accountId: payableAccount.id, debit: BigInt(0), credit: BigInt(amount) },
          ],
        },
      },
    });

    await registryDb.purchaseOrder.update({ where: { id: order.id }, data: { journalEntryId: entry.id } });
    await registryDb.referralCommission.create({
      data: { referredTenantId: referredTenant.id, kind, purchaseOrderId: order.id, amount },
    });
  }

  /** ensureDefaultChartOfAccounts فقط برای تننت‌های بدون هیچ حسابی seed می‌کند — این یک ردیف را برای تننت‌هایی که از قبل حساب دارند (مثل eta) هم اضافه می‌کند، مطابق الگوی ensureDefaultWarehouse. */
  private async ensureCommissionExpenseAccount(
    registryDb: NonNullable<Awaited<ReturnType<typeof this.getRegistryTenantDb>>>,
  ): Promise<void> {
    const existing = await registryDb.account.findUnique({ where: { code: COMMISSION_EXPENSE_ACCOUNT_CODE } });
    if (existing) return;
    try {
      await registryDb.account.create({
        data: { code: COMMISSION_EXPENSE_ACCOUNT_CODE, name: 'هزینه کمیسیون فروش/نمایندگی', type: 'EXPENSE', isSystem: true },
      });
    } catch (err) {
      const isUniqueConstraintViolation =
        typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
      if (!isUniqueConstraintViolation) throw err;
    }
  }
}
