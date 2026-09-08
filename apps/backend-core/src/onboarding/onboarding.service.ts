import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

type MissionDef = {
  code: string;
  moduleCode: string; // کدام ماژول باید نصب باشد تا این مأموریت نشان داده شود
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  count: (tenantDb: TenantRequestContext['tenantDb']) => Promise<number>;
};

// ترتیب = اولویت نمایش. فقط مأموریت‌های مربوط به ماژول‌های واقعاً نصب‌شده‌ی
// همین تننت نشان داده می‌شوند (فیلتر در getStatus). «وظایف» چون هسته است
// همیشه در لیست می‌ماند.
const MISSIONS: MissionDef[] = [
  {
    code: 'crm-contact',
    moduleCode: 'crm',
    title: 'اولین مخاطب را ثبت کنید',
    description: 'یک سرنخ یا مشتری واقعی اضافه کنید تا قیف فروش شما شکل بگیرد.',
    ctaLabel: 'رفتن به مشتریان',
    href: '/crm',
    count: (db) => db.crmContact.count(),
  },
  {
    code: 'warehouse-product',
    moduleCode: 'warehouse',
    title: 'اولین کالا را تعریف کنید',
    description: 'کالا یا خدمتی که می‌فروشید را در انبار ثبت کنید.',
    ctaLabel: 'رفتن به انبار',
    href: '/warehouse',
    count: (db) => db.product.count(),
  },
  {
    code: 'sales-invoice',
    moduleCode: 'sales',
    title: 'اولین فاکتور فروش را بسازید',
    description: 'یک فاکتور نمونه یا واقعی برای مشتری‌تان صادر کنید.',
    ctaLabel: 'رفتن به فروش',
    href: '/sales',
    count: (db) => db.salesInvoice.count(),
  },
  {
    code: 'purchasing-order',
    moduleCode: 'purchasing',
    title: 'اولین سفارش خرید را ثبت کنید',
    description: 'خرید از یک تأمین‌کننده را ثبت کنید تا موجودی انبار به‌روز شود.',
    ctaLabel: 'رفتن به خرید',
    href: '/purchasing',
    count: (db) => db.purchaseOrder.count(),
  },
  {
    code: 'tasks-task',
    moduleCode: 'tasks',
    title: 'اولین وظیفه را اضافه کنید',
    description: 'یک کار برای خودتان یا یکی از همکاران ثبت کنید.',
    ctaLabel: 'رفتن به وظایف',
    href: '/tasks',
    count: (db) => db.task.count(),
  },
  {
    code: 'accounting-journal',
    moduleCode: 'accounting',
    title: 'اولین سند حسابداری را ببینید',
    description: 'با هر فاکتور یا پرداخت، سند حسابداری خودکار ساخته می‌شود — یک نمونه را باز کنید.',
    ctaLabel: 'رفتن به حسابداری',
    href: '/accounting',
    count: (db) => db.journalEntry.count(),
  },
  {
    code: 'checks-check',
    moduleCode: 'checks',
    title: 'اولین چک را ثبت کنید',
    description: 'یک چک دریافتی یا پرداختی با تاریخ سررسید ثبت کنید.',
    ctaLabel: 'رفتن به چک‌ها',
    href: '/checks',
    count: (db) => db.check.count(),
  },
  {
    code: 'booking-appointment',
    moduleCode: 'booking',
    title: 'اولین نوبت را ثبت کنید',
    description: 'یک نوبت نمونه برای یکی از خدمات‌تان بسازید.',
    ctaLabel: 'رفتن به رزرو نوبت',
    href: '/booking',
    count: (db) => db.appointment.count(),
  },
  {
    code: 'contracts-contract',
    moduleCode: 'contracts',
    title: 'اولین قرارداد را بسازید',
    description: 'یک قرارداد فروش یا خرید نمونه ایجاد کنید.',
    ctaLabel: 'رفتن به قرارداد',
    href: '/contracts',
    count: (db) => db.contract.count(),
  },
  {
    code: 'projects-project',
    moduleCode: 'projects',
    title: 'اولین پروژه را بسازید',
    description: 'یک پروژه با بودجه و بازه‌ی زمانی تعریف کنید.',
    ctaLabel: 'رفتن به پروژه',
    href: '/projects',
    count: (db) => db.project.count(),
  },
  {
    code: 'production-order',
    moduleCode: 'production',
    title: 'اولین دستور تولید را ثبت کنید',
    description: 'یک دستور تولید نمونه برای محصولات‌تان بسازید.',
    ctaLabel: 'رفتن به تولید',
    href: '/production',
    count: (db) => db.productionOrder.count(),
  },
  {
    code: 'hr-employee',
    moduleCode: 'hr',
    title: 'اولین پرسنل را ثبت کنید',
    description: 'پرونده‌ی یکی از اعضای تیم‌تان را بسازید.',
    ctaLabel: 'رفتن به منابع انسانی',
    href: '/hr',
    count: (db) => db.employee.count(),
  },
  {
    code: 'fleet-shipment',
    moduleCode: 'fleet',
    title: 'اولین بار را ثبت کنید',
    description: 'یک بار برای ارسال با ناوگان حمل‌ونقل ثبت کنید.',
    ctaLabel: 'رفتن به ناوگان',
    href: '/fleet',
    count: (db) => db.shipment.count(),
  },
  {
    code: 'online-store-listing',
    moduleCode: 'online-store',
    title: 'اولین کالا را در فروشگاه عمومی عرضه کنید',
    description: 'یکی از کالاهای انبار را برای نمایش در فروشگاه آنلاین فعال کنید.',
    ctaLabel: 'رفتن به فروشگاه آنلاین',
    href: '/online-store',
    count: (db) => db.product.count({ where: { isPubliclyListed: true } }),
  },
  {
    code: 'marketing-campaign',
    moduleCode: 'marketing',
    title: 'اولین کمپین را بسازید',
    description: 'یک کمپین پیامکی یا محتوای اینستاگرام برای مخاطبین‌تان بسازید.',
    ctaLabel: 'رفتن به بازاریابی',
    href: '/marketing',
    count: (db) => db.marketingCampaign.count(),
  },
  {
    code: 'automation-rule',
    moduleCode: 'automation',
    title: 'اولین قانون اتوماسیون را بسازید',
    description: 'یک اقدام خودکار (اعلان، پیامک یا وظیفه) برای یک رویداد تعریف کنید.',
    ctaLabel: 'رفتن به اتوماسیون',
    href: '/automation',
    count: (db) => db.automationRule.count(),
  },
  {
    code: 'quality-control-sample',
    moduleCode: 'quality-control',
    title: 'اولین نمونه‌ی کنترل کیفیت را ثبت کنید',
    description: 'یک نمونه‌برداری از خط تولید یا محصول نهایی ثبت کنید.',
    ctaLabel: 'رفتن به کنترل کیفیت',
    href: '/quality-control',
    count: (db) => db.qualitySample.count(),
  },
];

const MAX_MISSIONS_SHOWN = 6;

@Injectable()
export class OnboardingService {
  constructor(private readonly controlDb: ControlPrismaService) {}

  private async getActiveModuleCodes(ctx: TenantRequestContext): Promise<Set<string>> {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany({ select: { id: true, code: true, isCore: true } }),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m.status]));
    const active = new Set<string>();
    for (const m of catalog) {
      const status = installedByModuleId.get(m.id) ?? null;
      const isActive = status === 'INSTALLED' || status === 'TRIAL' || (status === null && m.isCore);
      if (isActive) active.add(m.code);
    }
    return active;
  }

  async getStatus(ctx: TenantRequestContext) {
    const setting = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: 'onboarding', key: 'state' } },
    });
    const dismissed = !!(setting?.value as { dismissed?: boolean } | undefined)?.dismissed;
    if (dismissed) return { dismissed: true, missions: [] };

    const activeModules = await this.getActiveModuleCodes(ctx);
    const relevant = MISSIONS.filter((m) => activeModules.has(m.moduleCode)).slice(0, MAX_MISSIONS_SHOWN);

    const missions = await Promise.all(
      relevant.map(async (m) => ({
        code: m.code,
        title: m.title,
        description: m.description,
        ctaLabel: m.ctaLabel,
        href: m.href,
        completed: (await m.count(ctx.tenantDb)) > 0,
      })),
    );

    return { dismissed: false, missions };
  }

  async dismiss(ctx: TenantRequestContext): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: 'onboarding', key: 'state' } },
      create: { moduleCode: 'onboarding', key: 'state', value: { dismissed: true } },
      update: { value: { dismissed: true } },
    });
  }
}
