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
    features: string[];
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
      features: ['ارجاع وظیفه به هر عضو تیم', 'یادآوری خودکار سررسید', 'اتصال وظیفه به رکورد هر ماژول دیگر'],
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
      features: ['قیف فروش کانبان', 'سابقه‌ی کامل تماس و فعالیت هر مخاطب', 'امتیاز اعتباری خودکار مشتری'],
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
      features: ['موجودی لحظه‌ای چند انباره', 'هشدار خودکار نقطه سفارش مجدد', 'ورود و خروج دسته‌ای با اکسل'],
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
      features: ['دفتر کل و تراز آزمایشی استاندارد', 'ثبت خودکار اسناد از سایر ماژول‌ها', 'گزارش‌های مالیاتی آماده‌ی ارسال'],
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
      features: ['محاسبه‌ی خودکار حقوق و بیمه', 'گردش تأیید مرخصی', 'نمودار سازمانی زنده'],
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
      features: ['پیش‌فاکتور با لینک تأیید آنلاین برای مشتری', 'فاکتور تکرارشونده‌ی خودکار', 'اتصال مستقیم به انبار و حسابداری'],
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
      features: ['گردش تأیید سفارش خرید', 'ثبت خودکار بهای تمام‌شده', 'مدیریت تأمین‌کنندگان'],
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
      features: ['یادآوری سررسید چک', 'هشدار فوری برگشت خوردن چک', 'پشت‌نویسی و انتقال چک'],
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
      features: ['امتیاز ریسک خودکار هر تأمین‌کننده', 'روند تحویل و کیفیت در طول زمان', 'هشدار پیش از تکرار مشکل'],
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
      features: ['امضای دیجیتال روی صفحه‌ی تحویل', 'تأیید با کد پیامکی گیرنده', 'رسید تحویل قابل استناد'],
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
      features: ['فرمولاسیون و دستور تولید', 'مراحل خط تولید قابل پیگیری', 'کسر خودکار مواد اولیه از انبار'],
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
      features: ['نمونه‌برداری تصادفی از خط تولید', 'ثبت نتیجه در برابر بازه‌ی قابل‌قبول', 'اعلان فوری رد شدن نمونه به مدیریت'],
    },
    {
      code: 'api-access',
      name: 'دسترسی API',
      description: 'ساخت کلید API برای اتصال سیستم‌های خارجی به اکسیر — پیش‌نیاز ماژول‌های وب‌هوک و MCP.',
      category: 'یکپارچه‌سازی',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['کلید API با دسترسی محدودشدنی', 'مستندات کامل نقاط اتصال', 'پایه‌ی اتصال وب‌هوک و MCP'],
    },
    {
      code: 'webhooks',
      name: 'وب‌هوک',
      description: 'اطلاع‌رسانی خودکار به سیستم‌های بیرونی هنگام وقوع رویدادهای مهم (فاکتور جدید، مخاطب جدید و ...).',
      category: 'یکپارچه‌سازی',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['api-access'],
      features: ['اشتراک روی رویدادهای دلخواه', 'تحویل با تلاش مجدد خودکار', 'گزارش کامل ارسال‌ها'],
    },
    {
      code: 'mcp',
      name: 'اتصال دستیار هوشمند (MCP)',
      description: 'اتصال یک ایجنت هوش مصنوعی (مثل دستیار صوتی) به اکسیر برای ثبت، ویرایش، مشاهده و حذف اطلاعات — با تأیید کاربر برای هر تغییر.',
      category: 'یکپارچه‌سازی',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['api-access'],
      features: ['اتصال دستیار صوتی/چت هوش مصنوعی', 'صف تأیید انسانی پیش از هر تغییر', 'دسترسی در همه‌ی ماژول‌های اصلی'],
    },
    {
      code: 'currency-exchange',
      name: 'نرخ ارز و تبدیل لحظه‌ای',
      description: 'تعریف ارزهای خارجی برای قیمت‌گذاری کالا، و به‌روزرسانی خودکار نرخ آن‌ها از بازار آزاد. بدون این ماژول، سیستم فقط با تومان کار می‌کند.',
      category: 'عمومی',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['نرخ لحظه‌ای ارزهای خارجی', 'قیمت‌گذاری کالا به هر ارز', 'به‌روزرسانی خودکار بدون دخالت دستی'],
    },
    {
      code: 'offline-sync',
      name: 'ثبت آفلاین و همگام‌سازی خودکار',
      description: 'بدون اتصال اینترنت هم می‌توانید کار کنید — ثبت‌ها موقتاً روی همان دستگاه ذخیره می‌شوند و به‌محض وصل‌شدن دوباره، خودکار ارسال می‌شوند.',
      category: 'عمومی',
      priceMonthly: 90000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['ثبت کامل بدون نیاز به اینترنت', 'همگام‌سازی خودکار پس از اتصال مجدد', 'بدون از‌دست‌رفتن هیچ رکوردی'],
    },
    {
      code: 'voip',
      name: 'اتصال تلفن سازمانی (VoIP)',
      description: 'تماس ورودی به داخلی هر کارمند به‌صورت پاپ‌آپ روی پنل او نمایش داده می‌شود (با شناسایی خودکار مخاطب)، به‌همراه امکان تماس مستقیم با مشتری از داخل ERP.',
      category: 'عمومی',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['پاپ‌آپ تماس ورودی با شناسایی مخاطب', 'تماس مستقیم با مشتری از داخل ERP', 'ثبت یادداشت و وظیفه حین تماس'],
    },
    {
      code: 'automation',
      name: 'اتوماسیون',
      description: 'برای هر رویداد آماده در ماژول‌های نصب‌شده (پایان یک مرحله‌ی تولید، پرداخت فاکتور، تأیید مرخصی و...) یک یا چند اقدام خودکار تعریف کنید: اعلان داخل پنل، پیامک، یا ایجاد وظیفه.',
      category: 'عمومی',
      priceMonthly: 150000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['ده‌ها تریگر آماده از تمام ماژول‌ها', 'اقدام خودکار: اعلان، پیامک یا وظیفه', 'فعال‌سازی دستی یا خودکار'],
    },
    {
      code: 'qr-code',
      name: 'کد QR',
      description: 'برای هر لینک دلخواه (داخل یا خارج از اکسیر) یک کد QR اختصاصی بسازید — با اسکن، مخاطب مستقیم وارد همان صفحه می‌شود؛ مقصد بعداً بدون چاپ دوباره‌ی برچسب قابل تغییر است و تعداد اسکن هم ثبت می‌شود.',
      category: 'عمومی',
      priceMonthly: 60000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['QR اختصاصی برای هر لینک', 'تغییر مقصد بدون چاپ دوباره', 'شمارش تعداد اسکن', 'دانلود تصویر برای چاپ'],
    },
    {
      code: 'recruitment',
      name: 'استخدام و جذب نیرو',
      description: 'کل چرخه‌ی جذب نیرو — آگهی، رزومه‌ها، زمان‌بندی مصاحبه در تقویم، امتیازدهی، تأیید کارشناس و مدیریت با اطلاع‌رسانی پیامکی، شرایط همکاری قابل تأیید آنلاین و پرینت PDF با مهر و امضا، و اتصال مستقیم به ماژول منابع انسانی.',
      category: 'منابع انسانی',
      priceMonthly: 290000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm', 'hr'],
      features: [
        'آگهی استخدام با ظرفیت و نوع همکاری',
        'زمان‌بندی مصاحبه در تقویم با بافر زمانی',
        'تأیید دومرحله‌ای (کارشناس + مدیریت) با پیامک خودکار',
        'شرایط همکاری آنلاین + پرینت PDF با مهر و امضا',
        'اتصال مستقیم به آرشیو قرارداد و دسترسی کاربری در HR',
      ],
    },
    {
      code: 'reports',
      name: 'گزارش‌ها',
      description: 'ثبت گزارش سازمانی با شماره‌ی پیاپی، ارجاع به یک یا چند نفر با اعلان درون‌برنامه‌ای، پیامکی و رونوشت ایمیل، پاراف کارشناسی، دسته‌بندی، آرشیو و تبدیل به دانش سازمانی.',
      category: 'عمومی',
      priceMonthly: 120000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: [
        'شماره‌ی پیاپی خودکار برای هر گزارش',
        'ارجاع به یک یا چند نفر با اعلان پیامکی، درون‌برنامه‌ای و رونوشت ایمیل',
        'پاراف کارشناسی روی هر ارجاع',
        'دسته‌بندی، آرشیو و ویرایش/ارسال مجدد',
        'تبدیل گزارش به دانش سازمانی برای مراجعه‌ی بعدی',
      ],
    },
    {
      code: 'booking',
      name: 'رزرو نوبت',
      description: 'رزرو نوبت دریافت خدمات — تعریف انواع خدمت، تخصیص کارشناس، و جلوگیری خودکار از رزرو همزمان دو نوبت برای یک کارشناس.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: ['تعریف انواع خدمت با مدت‌زمان و قیمت', 'جلوگیری خودکار از تداخل نوبت‌ها', 'گردش تأیید، انجام و لغو نوبت'],
    },
    {
      code: 'contracts',
      name: 'مدیریت قرارداد',
      description: 'قراردادهای فروش و خرید با مشتریان و تأمین‌کنندگان — از پیش‌نویس تا امضا، یادآوری خودکار پیش از پایان، تمدید و فسخ.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
      features: ['یادآوری خودکار پیش از پایان قرارداد', 'گردش امضا، تمدید و فسخ', 'اتصال به مخاطبین CRM'],
    },
    {
      code: 'projects',
      name: 'مدیریت پروژه',
      description: 'ظرف پروژه با بودجه، بازه‌ی زمانی و مدیر مشخص — وظایف و پیشرفت از همان ماژول وظایف موجود، بدون سیستم موازی.',
      category: 'بهره‌وری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['tasks'],
      features: ['پیشرفت خودکار بر اساس وظایف تکمیل‌شده', 'هشدار خودکار عقب‌افتادن از موعد', 'گردش شروع، توقف، اتمام و لغو'],
    },
    {
      code: 'mentoring',
      name: 'منتورینگ، مشاوره و کوچینگ',
      description: 'مدیریت همکاری مشاوران، مربیان و کوچ‌ها با مشتریان — جلسات، تعرفه، اهداف و پیشرفت، نظرسنجی و گزارش طول عمر مشتری.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
      features: ['ثبت جلسه دستی یا از نوبت‌دهی', 'یادآوری خودکار پیامکی جلسه', 'ردیابی اهداف کمی و کیفی مشتری', 'گزارش طول عمر و درآمد هر مشتری'],
    },
    {
      code: 'events',
      name: 'رویداد و بلیط‌فروشی',
      description: 'صفحه‌ی عمومی معرفی و فروش بلیط رویداد با پرداخت آنلاین، صدور بلیط QR و ثبت حضور با اسکن گوشی.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
      features: ['فروش بلیط آنلاین با درگاه پرداخت', 'صدور خودکار بلیط با QR و پیامک', 'ثبت حضور با اسکن گوشی', 'اتصال به فاکتور فروش و مخاطبین'],
    },
    {
      code: 'forms',
      name: 'فرم‌ساز — نظرسنجی و آزمون آنلاین',
      description: 'ساخت نظرسنجی، آزمون آنلاین، پرسش‌نامه یا فرم ثبت‌نام با لینک عمومی قابل اشتراک در واتس‌اپ/اینستاگرام یا embed در سایت — پاسخ‌ها مستقیم توی ERP می‌نشیند.',
      category: 'فروش و مشتری',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
      features: ['نظرسنجی، آزمون با نمره‌دهی، پرسش‌نامه یا فرم ثبت‌نام', 'لینک عمومی + قابل embed در سایت', 'اتصال خودکار پاسخ‌دهنده به مخاطب CRM', 'گزارش آمار پاسخ‌ها'],
    },
    {
      code: 'warranty',
      name: 'گارانتی',
      description: 'صدور خودکار کد گارانتی یکتا برای هر واحد کالای مشمول گارانتی هنگام تسویه‌ی فاکتور، فعال‌سازی و استعلام توسط مشتری با فرم عمومی، و چاپ لیبل QR.',
      category: 'فروش و مشتری',
      priceMonthly: 150000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm', 'sales'],
      features: ['صدور خودکار کد گارانتی از فاکتور تسویه‌شده', 'فعال‌سازی و استعلام عمومی با کد', 'چاپ لیبل QR و گزارش عملکرد فعال‌سازی', 'وارد کردن گارانتی‌های قدیمی از سیستم قبلی'],
    },
    {
      code: 'after-sales-service',
      name: 'خدمات پس از فروش',
      description: 'ثبت و پیگیری درخواست خدمات پس از فروش برای گارانتی‌های فعال — پیامک وضعیت به مشتری، اطلاع‌رسانی به مسئول، و گزارش رضایت مشتری.',
      category: 'فروش و مشتری',
      priceMonthly: 120000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['warranty'],
      features: ['ثبت درخواست خدمات پس از فروش با لینک عمومی گارانتی', 'پیگیری وضعیت با الگوهای پیامکی آماده', 'اطلاع‌رسانی به مسئول انتخابی', 'گزارش رضایت مشتری و میانگین زمان رفع'],
    },
    {
      code: 'fleet',
      name: 'ناوگان حمل و نقل',
      description: 'پروفایل راننده‌ها، ثبت بار (دستی/از حواله انبار/از فاکتور فروش)، تطبیق و ارسال پیامکی خودکار پیشنهاد بار به‌ترتیب اولویت، پذیرش از طریق لینک عمومی، و نظرسنجی رضایت پس از تحویل.',
      category: 'عملیات',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: [],
      features: [
        'پروفایل کامل راننده — ظرفیت، محدوده‌ی سرویس‌دهی، ساعات در دسترس، امتیاز اعتبار',
        'تطبیق و رتبه‌بندی خودکار راننده‌های مناسب برای هر بار',
        'ارسال پیامکی پیشنهاد بار به‌ترتیب اولویت با فاصله‌ی ۵ دقیقه و پذیرش از طریق لینک عمومی',
        'آرشیو اسناد بار (بارنامه، قبض باسکول، برگ قرنطینه) و تاریخچه‌ی کامل بارهای ارسالی',
        'نظرسنجی رضایت مشتری پس از تحویل بار',
      ],
    },
    {
      code: 'online-store',
      name: 'فروشگاه آنلاین',
      description: 'نمای عمومی فروشگاه برای معرفی و فروش کالا به مشتری نهایی — بدون نیاز به ورود، سازگار با اینستاگرام — همراه با ثبت سفارش، رزرو خودکار موجودی، و داشبورد تحلیلی بازدید/سبد رهاشده/محبوب‌ترین کالاها.',
      category: 'فروش',
      priceMonthly: 250000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['warehouse', 'crm'],
      features: [
        'نمای عمومی فروشگاه، ساده و حرفه‌ای، بدون نیاز به ورود مشتری',
        'ثبت سفارش (بدون درگاه پرداخت آنلاین) و پیگیری وضعیت ارسال',
        'رزرو خودکار موجودی هنگام ثبت سفارش تا فروش بیش از ظرفیت انبار رخ ندهد',
        'داشبورد تحلیلی: بازدیدها، سبدهای خرید رهاشده، محبوب‌ترین کالاها',
        'اتصال به تاریخچه‌ی خرید مخاطب در CRM',
        'فید محصول سازگار با Meta Commerce Manager برای فروش از طریق اینستاگرام',
      ],
    },
    {
      code: 'marketing',
      name: 'بازاریابی و کمپین',
      description: 'ثبت، اجرا و مقایسه‌ی کمپین‌های بازاریابی — انتخاب مخاطب با فیلترهای پویا (مشتریان همیشگی، در آستانه‌ی ریزش، سرنخ‌های ناآشنا، موعد خرید مجدد، خریداران محصول خاص)، ارسال پیامک گروهی، و تولید تصویر پست/استوری اینستاگرام از روی قالب ثابت.',
      category: 'فروش',
      priceMonthly: 190000,
      isCore: false,
      version: '1.0.0',
      dependsOn: ['crm'],
      features: [
        'فیلتر پویای مخاطب: بر اساس مرحله‌ی قیف، فاصله‌ی آخرین خرید، منبع سرنخ، و محصول خریداری‌شده',
        'ارسال پیامک گروهی به مخاطبین فیلترشده',
        'تولید تصویر پست/استوری اینستاگرام از روی قالب ثابت با متن قابل تغییر',
        'مقایسه‌ی عملکرد کمپین‌ها بر اساس سفارش/درآمد نسبت‌داده‌شده در ۷ روز پس از ارسال',
        'کانال‌های بله و واتساپ در فهرست کمپین موجودند و به‌زودی به ارسال واقعی متصل می‌شوند',
      ],
    },
  ];
  for (const m of modules) {
    await db.moduleDefinition.upsert({ where: { code: m.code }, create: m, update: m });
  }

  // 'store' هیچ کدی واقعاً پشتش نیست (هیچ کنترلری بر اساس این moduleCode
  // گیت نمی‌زند) — کاتالوگ قدیمی/جانمانده است، پاکش می‌کنیم. ('reports' از
  // این لیست حذف شد چون حالا ماژول واقعی با کنترلر خودش پشتش هست.)
  const stale = await db.moduleDefinition.findMany({ where: { code: { in: ['store'] } } });
  for (const m of stale) {
    await db.tenantModule.deleteMany({ where: { moduleId: m.id } });
    await db.moduleDefinition.delete({ where: { id: m.id } });
  }

  // تننت‌های موجود تا امروز بدون هیچ گیت ماژولی به همه‌ی این ماژول‌ها
  // (از جمله crm/warehouse که همین امروز از رایگان/هسته به نصبی/پولی
  // تغییر کردند) دسترسی کامل داشتند — چون enforcement تازه اضافه شده،
  // برایشان به‌صورت خودکار نصب‌شده ثبت می‌شوند تا هیچ‌کس با این تغییر
  // یک‌شبه دسترسی از دست ندهد.
  const grandfatheredCodes = ['crm', 'warehouse', 'sales', 'purchasing', 'checks', 'supplier-risk', 'delivery-signature', 'api-access', 'webhooks', 'mcp'];
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
      businessCategory: 'PRODUCTION',
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
      businessCategory: 'PRODUCTION',
      suggestedThemeColor: '#15803d',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'production'],
    },
  });

  // ── قالب‌های صنف دیگر — همه با ماژول‌های موجود، بدون نیاز به ماژول جدید ──
  const industryTemplates: Array<{
    code: string;
    name: string;
    description: string;
    businessCategory: 'SERVICES' | 'TRADE' | 'PRODUCTION';
    roles: unknown[];
    chartOfAccounts: unknown[];
    productCategories: string[];
    orgChart: unknown[];
    suggestedThemeColor: string;
    defaultModules: string[];
  }> = [
    {
      code: 'retail-store',
      businessCategory: 'TRADE',
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
      businessCategory: 'SERVICES',
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
      businessCategory: 'SERVICES',
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
      businessCategory: 'TRADE',
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
      businessCategory: 'SERVICES',
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
    {
      code: 'business-consulting',
      businessCategory: 'SERVICES',
      name: 'مشاوره کسب‌وکار',
      description:
        'شرکت‌ها و افراد مشاور مدیریت، مالی، منابع انسانی و بهبود فرایند — کار پروژه‌محور با مشتریان متعدد، قرارداد مشاوره و جلسات برنامه‌ریزی‌شده.',
      roles: [
        {
          name: 'مشاور',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: OWN_CONTRIBUTOR, crm: VIEW_ONLY },
        },
        {
          name: 'مشاور ارشد',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, tasks: FULL_ACCESS },
        },
        {
          name: 'مدیر پروژه‌های مشاوره',
          permissionCodes: ['crm.manage', 'accounting.manage', 'tasks.manage'],
          modulePermissions: { crm: FULL_ACCESS, accounting: EDITOR_ACCESS, tasks: FULL_ACCESS },
        },
      ],
      chartOfAccounts: [
        { code: '1101', name: 'مطالبات پروژه‌های مشاوره', type: 'ASSET' },
        { code: '2101', name: 'پیش‌دریافت از مشتری', type: 'LIABILITY' },
        { code: '4101', name: 'درآمد خدمات مشاوره', type: 'REVENUE' },
        { code: '5101', name: 'هزینه مشاوران همکار (فریلنسر)', type: 'EXPENSE' },
        { code: '5102', name: 'هزینه سفر و مأموریت مشاوره', type: 'EXPENSE' },
      ],
      productCategories: ['مشاوره مدیریت', 'مشاوره مالی و حسابداری', 'مشاوره منابع انسانی', 'مشاوره فرایند و بهبود سازمانی'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر پروژه‌های مشاوره', reportsTo: 'مدیرعامل', department: 'مشاوره' },
        { position: 'مشاور ارشد', reportsTo: 'مدیر پروژه‌های مشاوره', department: 'مشاوره' },
        { position: 'مشاور', reportsTo: 'مشاور ارشد', department: 'مشاوره' },
        { position: 'مدیر ارتباط با مشتری', reportsTo: 'مدیرعامل', department: 'فروش' },
      ],
      suggestedThemeColor: '#b45309',
      defaultModules: ['tasks', 'crm', 'accounting', 'projects', 'contracts', 'booking'],
    },
    {
      code: 'manufacturing',
      businessCategory: 'PRODUCTION',
      name: 'تولیدی و کارخانه عمومی',
      description:
        'کارخانه‌ها و واحدهای تولیدی عمومی (غیر از خوراک دام) — از تأمین مواد اولیه و خط تولید تا کنترل کیفیت و انبار محصول نهایی.',
      roles: [
        {
          name: 'کارگر خط تولید',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'سرپرست تولید',
          permissionCodes: ['warehouse.manage', 'tasks.manage'],
          modulePermissions: { warehouse: EDITOR_ACCESS, tasks: FULL_ACCESS },
        },
        {
          name: 'مدیر کنترل کیفیت',
          permissionCodes: ['warehouse.manage'],
          modulePermissions: { warehouse: VIEW_ONLY, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدیر کارخانه',
          permissionCodes: ['warehouse.manage', 'accounting.manage', 'tasks.manage'],
          modulePermissions: { warehouse: FULL_ACCESS, accounting: EDITOR_ACCESS, purchasing: FULL_ACCESS, tasks: FULL_ACCESS },
        },
      ],
      chartOfAccounts: [
        { code: '1141', name: 'موجودی مواد اولیه', type: 'ASSET' },
        { code: '1142', name: 'موجودی کالای در جریان ساخت', type: 'ASSET' },
        { code: '1143', name: 'موجودی محصول نهایی', type: 'ASSET' },
        { code: '5141', name: 'هزینه دستمزد مستقیم تولید', type: 'EXPENSE' },
        { code: '5142', name: 'هزینه سربار کارخانه', type: 'EXPENSE' },
        { code: '5143', name: 'ضایعات و افت تولید', type: 'EXPENSE' },
        { code: '5144', name: 'هزینه نگهداری و تعمیرات ماشین‌آلات', type: 'EXPENSE' },
      ],
      productCategories: ['مواد اولیه', 'قطعات و اجزا', 'کالای در جریان ساخت', 'محصول نهایی', 'ضایعات قابل‌فروش'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر کارخانه', reportsTo: 'مدیرعامل', department: 'تولید' },
        { position: 'سرپرست تولید', reportsTo: 'مدیر کارخانه', department: 'تولید' },
        { position: 'کارگر خط تولید', reportsTo: 'سرپرست تولید', department: 'تولید' },
        { position: 'مدیر کنترل کیفیت', reportsTo: 'مدیر کارخانه', department: 'کنترل کیفیت' },
        { position: 'انباردار', reportsTo: 'مدیر کارخانه', department: 'انبار' },
        { position: 'مدیر فروش', reportsTo: 'مدیرعامل', department: 'فروش' },
        { position: 'مدیر مالی', reportsTo: 'مدیرعامل', department: 'مالی' },
      ],
      suggestedThemeColor: '#475569',
      defaultModules: ['tasks', 'crm', 'warehouse', 'accounting', 'sales', 'purchasing', 'production', 'quality-control'],
    },
    {
      code: 'construction',
      businessCategory: 'PRODUCTION',
      name: 'ساخت‌وساز و پیمانکاری عمرانی',
      description:
        'شرکت‌های پیمانکاری ساختمانی و عمرانی — مدیریت پروژه‌های اجرایی، مصالح ساختمانی، قراردادهای پیمانکاری فرعی و صورت‌وضعیت.',
      roles: [
        {
          name: 'سرپرست کارگاه',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: FULL_ACCESS, warehouse: OWN_CONTRIBUTOR },
        },
        {
          name: 'مهندس ناظر',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: OWN_CONTRIBUTOR, crm: VIEW_ONLY },
        },
        {
          name: 'مدیر پروژه',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, warehouse: EDITOR_ACCESS, tasks: FULL_ACCESS },
        },
        {
          name: 'مدیر مالی پیمانکاری',
          permissionCodes: ['accounting.manage'],
          modulePermissions: { accounting: FULL_ACCESS, tasks: VIEW_ONLY },
        },
      ],
      chartOfAccounts: [
        { code: '1151', name: 'مطالبات صورت‌وضعیت پروژه‌ها', type: 'ASSET' },
        { code: '1152', name: 'موجودی مصالح ساختمانی در انبار کارگاه', type: 'ASSET' },
        { code: '1153', name: 'پیش‌پرداخت به پیمانکاران فرعی', type: 'ASSET' },
        { code: '1154', name: 'سپرده حسن انجام کار نزد کارفرما', type: 'ASSET' },
        { code: '2151', name: 'پیش‌دریافت از کارفرما', type: 'LIABILITY' },
        { code: '2152', name: 'بدهی به پیمانکاران فرعی', type: 'LIABILITY' },
        { code: '5151', name: 'هزینه دستمزد اکیپ اجرایی', type: 'EXPENSE' },
        { code: '5152', name: 'هزینه اجاره ماشین‌آلات و تجهیزات', type: 'EXPENSE' },
      ],
      productCategories: ['مصالح ساختمانی', 'میلگرد و فولاد', 'تأسیسات برق و مکانیک', 'ابزارآلات و تجهیزات کارگاهی'],
      orgChart: [
        { position: 'مدیرعامل', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر پروژه', reportsTo: 'مدیرعامل', department: 'اجرا' },
        { position: 'مهندس ناظر', reportsTo: 'مدیر پروژه', department: 'اجرا' },
        { position: 'سرپرست کارگاه', reportsTo: 'مدیر پروژه', department: 'اجرا' },
        { position: 'اکیپ اجرایی', reportsTo: 'سرپرست کارگاه', department: 'اجرا' },
        { position: 'مدیر مالی پیمانکاری', reportsTo: 'مدیرعامل', department: 'مالی' },
        { position: 'انباردار کارگاه', reportsTo: 'سرپرست کارگاه', department: 'انبار' },
      ],
      suggestedThemeColor: '#ca8a04',
      defaultModules: ['tasks', 'crm', 'accounting', 'projects', 'contracts', 'purchasing', 'warehouse', 'checks'],
    },
    {
      code: 'medical-clinic',
      businessCategory: 'SERVICES',
      name: 'کلینیک و مطب پزشکی',
      description:
        'مطب‌ها، کلینیک‌های تخصصی و مراکز درمانی — نوبت‌دهی بیماران، پرونده و پیگیری مراجعین، و مدیریت داروخانه/تجهیزات مصرفی.',
      roles: [
        {
          name: 'منشی پذیرش',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { crm: OWN_CONTRIBUTOR, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'پزشک / پرستار',
          permissionCodes: ['crm.manage', 'tasks.manage'],
          modulePermissions: { crm: EDITOR_ACCESS, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدیر کلینیک',
          permissionCodes: ['crm.manage', 'accounting.manage', 'warehouse.manage', 'tasks.manage'],
          modulePermissions: { crm: FULL_ACCESS, accounting: EDITOR_ACCESS, warehouse: FULL_ACCESS, tasks: FULL_ACCESS },
        },
      ],
      chartOfAccounts: [
        { code: '1161', name: 'مطالبات از بیمه‌های تکمیلی', type: 'ASSET' },
        { code: '1162', name: 'موجودی دارو و تجهیزات مصرفی', type: 'ASSET' },
        { code: '4161', name: 'درآمد ویزیت و معاینه', type: 'REVENUE' },
        { code: '4162', name: 'درآمد خدمات تشخیصی و آزمایشگاهی', type: 'REVENUE' },
        { code: '5161', name: 'حق‌الزحمه پزشکان همکار', type: 'EXPENSE' },
        { code: '5162', name: 'هزینه دارو و تجهیزات مصرفی', type: 'EXPENSE' },
      ],
      productCategories: ['دارو', 'تجهیزات مصرفی', 'لوازم آزمایشگاهی', 'تجهیزات پزشکی'],
      orgChart: [
        { position: 'مدیر کلینیک', reportsTo: null, department: 'مدیریت' },
        { position: 'پزشک / پرستار', reportsTo: 'مدیر کلینیک', department: 'درمان' },
        { position: 'منشی پذیرش', reportsTo: 'مدیر کلینیک', department: 'پذیرش' },
        { position: 'مسئول داروخانه/انبار', reportsTo: 'مدیر کلینیک', department: 'انبار' },
        { position: 'مسئول مالی', reportsTo: 'مدیر کلینیک', department: 'مالی' },
      ],
      suggestedThemeColor: '#0d9488',
      defaultModules: ['tasks', 'crm', 'booking', 'accounting', 'warehouse'],
    },
    {
      code: 'education-institute',
      businessCategory: 'SERVICES',
      name: 'آموزشگاه و موسسه آموزشی',
      description:
        'آموزشگاه‌های آزاد، موسسات کنکور و زبان، و مراکز آموزشی خصوصی — ثبت‌نام و پیگیری هنرجو، برنامه‌ریزی کلاس، شهریه و قرارداد مدرسین.',
      roles: [
        {
          name: 'مسئول ثبت‌نام',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { crm: OWN_CONTRIBUTOR, tasks: OWN_CONTRIBUTOR },
        },
        {
          name: 'مدرس',
          permissionCodes: ['tasks.manage'],
          modulePermissions: { tasks: OWN_CONTRIBUTOR, crm: VIEW_ONLY },
        },
        {
          name: 'مدیر آموزشگاه',
          permissionCodes: ['crm.manage', 'accounting.manage', 'tasks.manage'],
          modulePermissions: { crm: FULL_ACCESS, accounting: FULL_ACCESS, tasks: FULL_ACCESS },
        },
      ],
      chartOfAccounts: [
        { code: '1171', name: 'مطالبات شهریه هنرجویان', type: 'ASSET' },
        { code: '2171', name: 'پیش‌دریافت شهریه دوره‌های آینده', type: 'LIABILITY' },
        { code: '4171', name: 'درآمد شهریه دوره‌های آموزشی', type: 'REVENUE' },
        { code: '5171', name: 'حق‌التدریس مدرسین', type: 'EXPENSE' },
        { code: '5172', name: 'هزینه اجاره فضای آموزشی', type: 'EXPENSE' },
      ],
      productCategories: ['دوره مقدماتی', 'دوره متوسط', 'دوره پیشرفته', 'کلاس خصوصی'],
      orgChart: [
        { position: 'مدیر آموزشگاه', reportsTo: null, department: 'مدیریت' },
        { position: 'مدیر آموزشی', reportsTo: 'مدیر آموزشگاه', department: 'آموزش' },
        { position: 'مدرس', reportsTo: 'مدیر آموزشی', department: 'آموزش' },
        { position: 'مسئول ثبت‌نام', reportsTo: 'مدیر آموزشگاه', department: 'پذیرش' },
        { position: 'مسئول مالی', reportsTo: 'مدیر آموزشگاه', department: 'مالی' },
      ],
      suggestedThemeColor: '#7c3aed',
      defaultModules: ['tasks', 'crm', 'booking', 'accounting', 'contracts'],
    },
  ];

  for (const t of industryTemplates) {
    await db.industryTemplate.upsert({
      where: { code: t.code },
      create: {
        code: t.code,
        name: t.name,
        description: t.description,
        businessCategory: t.businessCategory,
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
        businessCategory: t.businessCategory,
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
