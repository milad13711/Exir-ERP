// Seeds the Control Plane with static catalog data: plans, the module
// marketplace catalog, and one super-admin account for the management team.
// Tenant onboarding itself goes through the real POST /admin/tenants API
// (see README "Demo data"), not this script — that way tenant provisioning
// is exercised the same way it will be in production.
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../../generated/control-client/index.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });

async function main() {
  await db.plan.upsert({
    where: { code: 'starter' },
    create: { code: 'starter', name: 'پلن استارتر', priceMonthly: 490000, userLimit: 5 },
    update: {},
  });
  await db.plan.upsert({
    where: { code: 'professional' },
    create: { code: 'professional', name: 'پلن حرفه‌ای', priceMonthly: 1990000, userLimit: 25 },
    update: {},
  });
  await db.plan.upsert({
    where: { code: 'enterprise' },
    create: { code: 'enterprise', name: 'پلن سازمانی', priceMonthly: 4990000, userLimit: 200 },
    update: {},
  });
  // Not sold in the cloud module store — used only by bootstrap-on-premise.ts
  // for the single tenant an on-premise deployment provisions for itself.
  // Entitlement there comes from the license file, not this plan's price.
  await db.plan.upsert({
    where: { code: 'on_premise' },
    create: {
      code: 'on_premise',
      name: 'استقرار اختصاصی (on-premise)',
      priceMonthly: 0,
      userLimit: 100000,
      isPubliclySold: false,
    },
    update: {},
  });

  // فقط «وظایف و یادآوری» هسته است — رایگان، پیش‌فرض فعال، بدون هیچ
  // وابستگی‌ای (کاملاً مستقل). همه‌ی باقی ماژول‌ها نصبی/پولی‌اند و طبق
  // زنجیره‌ی وابستگی واقعی کد به هم پیش‌نیاز می‌شوند: مدیریت ارتباط با
  // مشتری (CrmContact) پایه‌ی فروش و خرید و چک است؛ حسابداری چون هر
  // فاکتور/سفارش/چک مستقیم سند حسابداری می‌زند؛ انبار چون سفارش خرید رسید
  // انبار می‌زند؛ و چک روی همان مشتری/فاکتور فروش سوار می‌شود.
  const modules: Array<{
    code: string;
    name: string;
    description: string;
    category: string;
    priceMonthly: number;
    isCore: boolean;
    version: string;
    dependsOn: string[];
  }> = [
    {
      code: 'tasks',
      name: 'وظایف و یادآوری',
      description: 'مدیریت وظایف تیمی و یادآوری‌ها — مستقل از بقیه‌ی ماژول‌ها.',
      category: 'بهره‌وری',
      priceMonthly: 0,
      isCore: true,
      version: '1.0.0',
      dependsOn: [],
    },
    {
      code: 'crm',
      name: 'مدیریت ارتباط با مشتری',
      description: 'پیگیری سرنخ‌ها، مخاطبین و فرصت‌های فروش در یک قیف یکپارچه.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
    },
    {
      code: 'warehouse',
      name: 'انبارداری و موجودی',
      description: 'کنترل موجودی، رسید و حواله، و هشدار کمبود کالا.',
      category: 'انبار',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
    },
    {
      code: 'accounting',
      name: 'حسابداری مالی',
      description: 'اسناد حسابداری، دفتر کل، خزانه‌داری و گزارش‌های مالیاتی.',
      category: 'مالی',
      priceMonthly: 490000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
    },
    {
      code: 'hr',
      name: 'منابع انسانی و حقوق',
      description: 'پرونده پرسنلی، حضور و غیاب، مرخصی و فیش حقوقی.',
      category: 'منابع انسانی',
      priceMonthly: 390000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
    },
    {
      code: 'sales',
      name: 'فروش و فاکتور',
      description: 'از سفارش فروش تا فاکتور، پیش‌فاکتور، فاکتور تکرارشونده و مرجوعی.',
      category: 'فروش و مشتری',
      priceMonthly: 290000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm', 'accounting'],
    },
    {
      code: 'purchasing',
      name: 'خرید و تأمین‌کننده',
      description: 'سفارش خرید، رسید انبار و مرجوعی خرید.',
      category: 'خرید و تأمین',
      priceMonthly: 290000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm', 'accounting', 'warehouse'],
    },
    {
      code: 'checks',
      name: 'مدیریت چک‌ها',
      description: 'ثبت، پیگیری و پشت‌نویسی چک‌های دریافتی و پرداختی.',
      category: 'مالی',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm', 'sales'],
    },
    {
      code: 'supplier-risk',
      name: 'ریسک‌سنجی تأمین‌کننده',
      description: 'امتیاز سلامت رابطه‌ی خرید با هر تأمین‌کننده — نرخ پرداخت به‌موقع، حجم خرید و چک‌های برگشتی.',
      category: 'خرید و تأمین',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
    },
    {
      code: 'delivery-signature',
      name: 'امضای دیجیتال تحویل کالا',
      description: 'تأیید تحویل فاکتور فروش با امضای دیجیتال یا کد پیامکی تحویل‌گیرنده.',
      category: 'فروش و مشتری',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['sales'],
    },
    {
      code: 'production',
      name: 'مدیریت تولید',
      description: 'فرمولاسیون، دستور تولید، مراحل خط تولید و کسر/افزایش خودکار موجودی مواد اولیه و محصول نهایی.',
      category: 'تولید',
      priceMonthly: 290000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['warehouse'],
    },
    {
      code: 'quality-control',
      name: 'کنترل کیفیت',
      description: 'نمونه‌برداری تصادفی از مراحل تولید یا محصول نهایی، ثبت نتیجه‌ی آزمون در برابر بازه‌ی قابل‌قبول، و اعلان خودکار به مدیریت هنگام رد شدن نمونه.',
      category: 'تولید',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['production'],
    },
  ];
  for (const m of modules) {
    await db.moduleDefinition.upsert({ where: { code: m.code }, create: m, update: m });
  }

  // 'reports' و 'store' هیچ کدی واقعاً پشتشان نیست (هیچ کنترلری بر اساس این
  // moduleCode‌ها گیت نمی‌زند) — کاتالوگ قدیمی/جانمانده‌اند، پاکشان می‌کنیم.
  const stale = await db.moduleDefinition.findMany({ where: { code: { in: ['reports', 'store'] } } });
  for (const m of stale) {
    await db.tenantModule.deleteMany({ where: { moduleId: m.id } });
    await db.moduleDefinition.delete({ where: { id: m.id } });
  }

  // تننت‌های موجود تا امروز بدون هیچ گیت ماژولی به همه‌ی این ماژول‌ها
  // (از جمله crm/warehouse که همین امروز از رایگان/هسته به نصبی/پولی
  // تغییر کردند) دسترسی کامل داشتند — چون enforcement تازه اضافه شده،
  // برایشان به‌صورت خودکار نصب‌شده ثبت می‌شوند تا هیچ‌کس با این تغییر
  // یک‌شبه دسترسی از دست ندهد.
  const grandfatheredCodes = ['crm', 'warehouse', 'sales', 'purchasing', 'checks', 'supplier-risk', 'delivery-signature'];
  const grandfatheredModules = await db.moduleDefinition.findMany({ where: { code: { in: grandfatheredCodes } } });
  const existingTenants = await db.tenant.findMany({ select: { id: true } });
  for (const tenant of existingTenants) {
    for (const m of grandfatheredModules) {
      await db.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: m.id } },
        create: { tenantId: tenant.id, moduleId: m.id, status: 'INSTALLED' },
        update: {},
      });
    }
  }

  // ── قالب صنف: خوراک دام (نمونه‌ی اول از سیستم Industry Template) ─────────
  const FULL_ACCESS = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true };
  const EDITOR_ACCESS = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false };
  const VIEW_ONLY = { canViewAll: true, canViewOwn: true, canCreate: false, canEdit: false, canDelete: false };
  const OWN_CONTRIBUTOR = { canViewAll: false, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false };

  await db.industryTemplate.upsert({
    where: { code: 'livestock-feed' },
    create: {
      code: 'livestock-feed',
      name: 'خوراک دام',
      description: 'تولید کنسانتره و خوراک دام، طیور و آبزیان — از تأمین مواد اولیه تا فرمولاسیون و بسته‌بندی محصول نهایی.',
      roles: [
        {
          name: 'مسئول فرمولاسیون',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'کارشناس کنترل کیفیت',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: VIEW_ONLY, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'سرپرست خط تولید',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: FULL_ACCESS, purchasing: VIEW_ONLY, tasks: OWN_CONTRIBUTOR },
        },
      ],
      chartOfAccounts: [
        { code: '1041', name: 'موجودی مواد اولیه - ذرت', type: 'ASSET' },
        { code: '1042', name: 'موجودی مواد اولیه - کنجاله سویا', type: 'ASSET' },
        { code: '1043', name: 'موجودی مواد اولیه - افزودنی و ویتامینه', type: 'ASSET' },
        { code: '1044', name: 'موجودی کالای در جریان ساخت', type: 'ASSET' },
        { code: '1045', name: 'موجودی محصول نهایی - کنسانتره طیور', type: 'ASSET' },
        { code: '1046', name: 'موجودی محصول نهایی - کنسانتره دام سنگین', type: 'ASSET' },
        { code: '5041', name: 'هزینه انرژی خط تولید', type: 'EXPENSE' },
        { code: '5042', name: 'ضایعات و افت تولید', type: 'EXPENSE' },
        { code: '5043', name: 'هزینه آزمایشگاه و کنترل کیفیت', type: 'EXPENSE' },
      ],
      productCategories: [
        'ذرت',
        'کنجاله سویا',
        'سبوس گندم',
        'افزودنی و ویتامینه',
        'کنسانتره طیور',
        'کنسانتره دام سنگین',
        'کنسانتره آبزیان',
        'بسته‌بندی',
      ],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر تولید', reportsTo: 'مدیرعامل', department: 'تولید' },
        { position: 'سرپرست خط تولید', reportsTo: 'مدیر تولید', department: 'تولید' },
        { position: 'کارگر خط تولید', reportsTo: 'سرپرست خط تولید', department: 'تولید' },
        { position: 'مسئول فرمولاسیون', reportsTo: 'مدیر تولید', department: 'تولید' },
        { position: 'کارشناس کنترل کیفیت', reportsTo: 'مدیر تولید', department: 'کنترل کیفیت' },
        { position: 'انباردار', reportsTo: 'مدیر تولید', department: 'انبار' },
        { position: 'مدیر فروش', reportsTo: 'مدیرعامل', department: 'فروش' },
        { position: 'کارشناس فروش', reportsTo: 'مدیر فروش', department: 'فروش' },
        { position: 'مدیر مالی', reportsTo: 'مدیرعامل', department: 'مالی' },
        { position: 'حسابدار', reportsTo: 'مدیر مالی', department: 'مالی' },
      ],
      suggestedThemeColor: '#15803d',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'production'],
    },
    update: {
      suggestedThemeColor: '#15803d',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'production'],
    },
  });

  // ── قالب‌های صنف دیگر — همه با ماژول‌های موجود، بدون نیاز به ماژول جدید ──
  const industryTemplates: Array<{
    code: string;
    name: string;
    description: string;
    roles: unknown[];
    chartOfAccounts: unknown[];
    productCategories: string[];
    orgChart: unknown[];
    suggestedThemeColor: string;
    defaultModules: string[];
  }> = [
    {
      code: 'retail-store',
      name: 'خرده‌فروشی و فروشگاه',
      description: 'فروشگاه‌های زنجیره‌ای و خرده‌فروشی — از صندوق فروش تا مدیریت موجودی و خرید از تأمین‌کننده.',
      roles: [
        {
          name: 'فروشنده',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { sales: OWN_CONTRIBUTOR, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'صندوقدار',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { sales: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدیر فروشگاه',
          permissionCodes: ['crm.manage', 'warehouse.manage', 'tasks.manage'],
          modulePermissions: {
            sales: FULL_ACCESS,
            warehouse: FULL_ACCESS,
            crm: EDITOR_ACCESS,
            purchasing: VIEW_ONLY,
            tasks: OWN_CONTRIBUTOR,
          },
        },
      ],
      chartOfAccounts: [
        { code: '1051', name: 'موجودی کالای فروشگاه', type: 'ASSET' },
        { code: '1052', name: 'موجودی کالای امانی', type: 'ASSET' },
        { code: '5051', name: 'هزینه اجاره مغازه', type: 'EXPENSE' },
        { code: '5052', name: 'تخفیفات و کسورات فروش', type: 'EXPENSE' },
        { code: '5053', name: 'ضایعات و کسری انبار فروشگاه', type: 'EXPENSE' },
      ],
      productCategories: ['پوشاک', 'کیف و کفش', 'لوازم آرایشی و بهداشتی', 'لوازم خانگی', 'اسباب‌بازی'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر فروشگاه', reportsTo: 'مدیرعامل', department: 'فروش' },
        { position: 'فروشنده', reportsTo: 'مدیر فروشگاه', department: 'فروش' },
        { position: 'صندوقدار', reportsTo: 'مدیر فروشگاه', department: 'فروش' },
        { position: 'انباردار', reportsTo: 'مدیر فروشگاه', department: 'انبار' },
        { position: 'مدیر خرید', reportsTo: 'مدیرعامل', department: 'خرید' },
      ],
      suggestedThemeColor: '#db2777',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'checks'],
    },
    {
      code: 'restaurant-cafe',
      name: 'رستوران و کافی‌شاپ',
      description: 'رستوران، کافی‌شاپ و فست‌فود — مدیریت مواد اولیه آشپزخانه، فروش سالن و ضایعات مواد غذایی.',
      roles: [
        {
          name: 'گارسون',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { sales: OWN_CONTRIBUTOR, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'سرآشپز',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدیر سالن',
          permissionCodes: ['warehouse.manage', 'hr.manage', 'tasks.manage'],
          modulePermissions: { sales: FULL_ACCESS, warehouse: EDITOR_ACCESS, hr: VIEW_ONLY, tasks: OWN_CONTRIBUTOR },
        },
      ],
      chartOfAccounts: [
        { code: '1061', name: 'موجودی مواد اولیه آشپزخانه', type: 'ASSET' },
        { code: '5061', name: 'ضایعات مواد غذایی', type: 'EXPENSE' },
        { code: '5062', name: 'هزینه گاز و انرژی آشپزخانه', type: 'EXPENSE' },
        { code: '5063', name: 'هزینه ظروف یکبار‌مصرف و بسته‌بندی', type: 'EXPENSE' },
      ],
      productCategories: ['پیش‌غذا', 'غذای اصلی', 'دسر', 'نوشیدنی گرم', 'نوشیدنی سرد'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر سالن', reportsTo: 'مدیرعامل', department: 'سالن' },
        { position: 'گارسون', reportsTo: 'مدیر سالن', department: 'سالن' },
        { position: 'سرآشپز', reportsTo: 'مدیرعامل', department: 'آشپزخانه' },
        { position: 'کمک‌آشپز', reportsTo: 'سرآشپز', department: 'آشپزخانه' },
        { position: 'حسابدار', reportsTo: 'مدیرعامل', department: 'مالی' },
      ],
      suggestedThemeColor: '#ea580c',
      defaultModules: ['tasks', 'warehouse', 'accounting', 'sales', 'purchasing', 'hr'],
    },
    {
      code: 'technical-services',
      name: 'خدمات فنی و پیمانکاری',
      description: 'شرکت‌های خدمات فنی، نصب و پیمانکاری — مدیریت پروژه‌محور با پیگیری مطالبات و پیش‌دریافت از کارفرما.',
      roles: [
        {
          name: 'کارشناس فنی',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'ناظر پروژه',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, sales: EDITOR_ACCESS, tasks: FULL_ACCESS },
        },
        {
          name: 'مدیر پروژه‌ها',
          permissionCodes: ['crm.manage', 'accounting.manage', 'hr.manage', 'tasks.manage'],
          modulePermissions: {
            crm: FULL_ACCESS,
            sales: FULL_ACCESS,
            purchasing: EDITOR_ACCESS,
            tasks: FULL_ACCESS,
          },
        },
      ],
      chartOfAccounts: [
        { code: '1071', name: 'مطالبات پروژه‌ای', type: 'ASSET' },
        { code: '2071', name: 'پیش‌دریافت از کارفرما', type: 'LIABILITY' },
        { code: '5071', name: 'هزینه پیمانکاران فرعی', type: 'EXPENSE' },
        { code: '5072', name: 'هزینه تجهیزات و ابزارآلات پروژه', type: 'EXPENSE' },
        { code: '4071', name: 'درآمد خدمات فنی و نصب', type: 'REVENUE' },
      ],
      productCategories: ['خدمات نصب', 'خدمات تعمیر و نگهداری', 'مشاوره فنی', 'بازرسی و کنترل کیفیت'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر پروژه‌ها', reportsTo: 'مدیرعامل', department: 'پروژه‌ها' },
        { position: 'ناظر پروژه', reportsTo: 'مدیر پروژه‌ها', department: 'پروژه‌ها' },
        { position: 'کارشناس فنی', reportsTo: 'ناظر پروژه', department: 'پروژه‌ها' },
        { position: 'مدیر مالی', reportsTo: 'مدیرعامل', department: 'مالی' },
        { position: 'حسابدار', reportsTo: 'مدیر مالی', department: 'مالی' },
      ],
      suggestedThemeColor: '#0891b2',
      defaultModules: ['tasks', 'crm', 'accounting', 'sales', 'purchasing', 'checks'],
    },
    {
      code: 'wholesale-distribution',
      name: 'پخش و توزیع مویرگی',
      description: 'شرکت‌های پخش و توزیع مویرگی — ویزیتوری، انبار مرکزی و پیگیری مطالبات معوق نمایندگی‌ها.',
      roles: [
        {
          name: 'ویزیتور فروش',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, sales: OWN_CONTRIBUTOR, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'انباردار توزیع',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: FULL_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدیر فروش مویرگی',
          permissionCodes: ['crm.manage', 'warehouse.manage', 'tasks.manage'],
          modulePermissions: {
            crm: FULL_ACCESS,
            sales: FULL_ACCESS,
            warehouse: EDITOR_ACCESS,
            purchasing: EDITOR_ACCESS,
            tasks: FULL_ACCESS,
          },
        },
      ],
      chartOfAccounts: [
        { code: '1081', name: 'موجودی کالای در راه', type: 'ASSET' },
        { code: '1082', name: 'مطالبات معوق نمایندگی‌ها', type: 'ASSET' },
        { code: '5081', name: 'هزینه حمل و پخش', type: 'EXPENSE' },
        { code: '5082', name: 'هزینه سوخت ناوگان توزیع', type: 'EXPENSE' },
      ],
      productCategories: ['مواد غذایی بسته‌بندی‌شده', 'محصولات بهداشتی', 'لوازم آرایشی', 'نوشیدنی'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر فروش مویرگی', reportsTo: 'مدیرعامل', department: 'فروش' },
        { position: 'ویزیتور فروش', reportsTo: 'مدیر فروش مویرگی', department: 'فروش' },
        { position: 'مدیر انبار و لجستیک', reportsTo: 'مدیرعامل', department: 'انبار' },
        { position: 'انباردار توزیع', reportsTo: 'مدیر انبار و لجستیک', department: 'انبار' },
        { position: 'راننده پخش', reportsTo: 'انباردار توزیع', department: 'انبار' },
      ],
      suggestedThemeColor: '#7c3aed',
      defaultModules: [
        'tasks',
        'crm',
        'warehouse',
        'accounting',
        'sales',
        'purchasing',
        'checks',
        'supplier-risk',
      ],
    },
    {
      code: 'auto-service',
      name: 'نمایندگی و تعمیرگاه خودرو',
      description: 'نمایندگی فروش و تعمیرگاه خودرو — پذیرش خودرو، مدیریت قطعات یدکی و فروش خودرو.',
      roles: [
        {
          name: 'مکانیک',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { warehouse: VIEW_ONLY, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'پذیرش تعمیرگاه',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, sales: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'کارشناس فروش خودرو',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: FULL_ACCESS, sales: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
      ],
      chartOfAccounts: [
        { code: '1091', name: 'موجودی قطعات یدکی', type: 'ASSET' },
        { code: '5091', name: 'هزینه ضمانت‌نامه و گارانتی', type: 'EXPENSE' },
        { code: '4091', name: 'درآمد خدمات تعمیر و سرویس', type: 'REVENUE' },
      ],
      productCategories: ['قطعات یدکی', 'روغن و مایعات خودرو', 'لوازم جانبی و تزئینی', 'لاستیک و رینگ'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر تعمیرگاه', reportsTo: 'مدیرعامل', department: 'تعمیرگاه' },
        { position: 'مکانیک', reportsTo: 'مدیر تعمیرگاه', department: 'تعمیرگاه' },
        { position: 'پذیرش تعمیرگاه', reportsTo: 'مدیر تعمیرگاه', department: 'تعمیرگاه' },
        { position: 'مدیر فروش خودرو', reportsTo: 'مدیرعامل', department: 'فروش' },
        { position: 'کارشناس فروش خودرو', reportsTo: 'مدیر فروش خودرو', department: 'فروش' },
      ],
      suggestedThemeColor: '#1d4ed8',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'checks'],
    },
  ];

  for (const t of industryTemplates) {
    await db.industryTemplate.upsert({
      where: { code: t.code },
      create: {
        code: t.code,
        name: t.name,
        description: t.description,
        roles: t.roles as object[],
        chartOfAccounts: t.chartOfAccounts as object[],
        productCategories: t.productCategories,
        orgChart: t.orgChart as object[],
        suggestedThemeColor: t.suggestedThemeColor,
        defaultModules: t.defaultModules,
      },
      update: {
        name: t.name,
        description: t.description,
        roles: t.roles as object[],
        chartOfAccounts: t.chartOfAccounts as object[],
        productCategories: t.productCategories,
        orgChart: t.orgChart as object[],
        suggestedThemeColor: t.suggestedThemeColor,
        defaultModules: t.defaultModules,
      },
    });
  }

  const superAdminEmail = 'admin@exir.co';
  const superAdminPassword = 'ExirAdmin123!';
  await db.adminUser.upsert({
    where: { email: superAdminEmail },
    create: {
      name: 'مدیر ارشد اکسیر',
      email: superAdminEmail,
      passwordHash: await bcrypt.hash(superAdminPassword, 10),
      team: 'SUPER_ADMIN',
    },
    update: {},
  });
  await db.adminUser.upsert({
    where: { email: 'support@exir.co' },
    create: {
      name: 'علیرضا کاظمی',
      email: 'support@exir.co',
      passwordHash: await bcrypt.hash('ExirSupport123!', 10),
      team: 'SUPPORT',
    },
    update: {},
  });

  console.log('Seed complete.');
  console.log(`  super admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log('  support staff: support@exir.co / ExirSupport123!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
