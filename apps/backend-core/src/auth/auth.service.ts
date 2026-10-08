import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import type { OtpPurpose, Tenant } from '../../generated/control-client/index.js';
import type { TenantJwtPayload, TenantSelectionTicketPayload, TenantTotpChallengePayload } from './jwt-payload.type.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { maskPhone } from '../security/mask.js';
import { TenantTwoFactorService } from './tenant-two-factor.service.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TENANT_SELECTION_TOKEN_TTL_SECONDS = 15 * 60;

/** کد OTP با CSPRNG (قبلاً Math.random که قابل پیش‌بینی است). طول: ۴ رقم (سازگار با کلاینت‌ها) یا LOGIN_OTP_DIGITS=6 فقط برای ورود. */
export function generateOtpCode(digits = 4): string {
  const lo = 10 ** (digits - 1);
  return String(randomInt(lo, lo * 10));
}

/** طول کد ورود (LOGIN). پیش‌فرض ۴ تا فرانت‌اندهای فعلی نشکنند؛ ۶ با LOGIN_OTP_DIGITS=6 (ورودی DTO هر دو را می‌پذیرد). */
export function loginOtpDigits(): 4 | 6 {
  return process.env.LOGIN_OTP_DIGITS === '6' ? 6 : 4;
}

// سقف‌های OTP (قابل‌تنظیم با env). شمارش در DB است، پس با ری‌استارت/چندنمونه‌ای ریست نمی‌شود.
const OTP_COOLDOWN_MS = 30_000; // حداقل فاصله‌ی دو ارسال برای یک شماره و یک هدف
const OTP_PER_PHONE_15M = 5;
const OTP_PER_PHONE_24H = 15;
const LOGIN_FAILED_GUESSES_1H = 10;
const LOGIN_FAILED_GUESSES_24H = 20;
const GLOBAL_CACHE_MS = 60_000;

export type TenantCard = {
  slug: string;
  name: string;
  logoUrl: string | null;
  /** «مشتری از این تاریخ» — همان لحظه‌ی ایجاد ردیف تننت در کنترل‌پلین؛ مبنای واحدی که برخلاف Subscription.startedAt هیچ‌وقت با تمدید/تغییر پلن عوض نمی‌شود. */
  startDate: Date;
  /** پایان دوره‌ی فعلی — از Subscription (تننت‌های SaaS) یا License (تننت‌های on-premise اختصاصی)؛ اگر هیچ‌کدام نبود null. */
  expiresAt: Date | null;
  /** تعداد اعلانات خواندنشده‌ی همین کاربر در همین کسب‌وکار — تنها معیار موجود برای «صادرشده ولی اقدامی روش نشده». */
  pendingNotifications: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly sms: ExirSmsService,
    private readonly events: SecurityEventsService,
    private readonly epoch: SessionEpochService,
    private readonly twoFactor: TenantTwoFactorService,
  ) {}

  private globalOtpCount: { value: number; at: number } | null = null;
  private readonly totpFailures = new Map<string, { n: number; resetAt: number }>();

  private tooMany(message: string): HttpException {
    return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * ضد SMS-pumping و brute-force: سقف ارسال به‌ازای شماره (همه‌ی هدف‌ها) + فاصله‌ی حداقلی + سقف سراسری روزانه.
   * همه‌ی فلوهای OTP (ورود و صفحات عمومی) از همین requestOtp می‌گذرند، پس یک نقطه‌ی کنترل دارند.
   */
  private async enforceOtpRequestLimits(phone: string, purpose: OtpPurpose): Promise<void> {
    const now = Date.now();
    const rows = await this.controlDb.otpCode.findMany({
      where: { phone, createdAt: { gte: new Date(now - 24 * 3600_000) } },
      select: { createdAt: true, purpose: true },
      orderBy: { createdAt: 'desc' },
      take: OTP_PER_PHONE_24H + 1,
    });
    const last = rows.find((r) => r.purpose === purpose);
    if (last && now - last.createdAt.getTime() < OTP_COOLDOWN_MS) {
      throw this.tooMany('کد تأیید به‌تازگی ارسال شده است؛ چند ثانیه بعد دوباره درخواست دهید');
    }
    const in15 = rows.filter((r) => now - r.createdAt.getTime() < 15 * 60_000).length;
    if (in15 >= OTP_PER_PHONE_15M || rows.length >= OTP_PER_PHONE_24H) {
      this.events.record({ type: 'OTP_LOCKED', severity: 'WARNING', message: 'OTP request cap per phone', context: { phone: maskPhone(phone), purpose }, dedupeKey: phone });
      throw this.tooMany('تعداد درخواست کد برای این شماره زیاد است؛ بعداً دوباره تلاش کنید');
    }
    const cap = Number(process.env.OTP_GLOBAL_DAILY_CAP) || 20_000;
    if (!this.globalOtpCount || now - this.globalOtpCount.at > GLOBAL_CACHE_MS) {
      this.globalOtpCount = { value: await this.controlDb.otpCode.count({ where: { createdAt: { gte: new Date(now - 24 * 3600_000) } } }), at: now };
    }
    if (this.globalOtpCount.value >= cap) {
      this.events.record({ type: 'OTP_CAP_REACHED', severity: 'FATAL', message: `global OTP daily cap (${cap}) reached — possible SMS pumping`, dedupeKey: 'global' });
      throw this.tooMany('سرویس ارسال کد موقتاً محدود شده است؛ بعداً تلاش کنید');
    }
    this.globalOtpCount.value += 1;
  }

  async requestOtp(
    phone: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<{ expiresInSeconds: number; codeLength: number; devCode?: string }> {
    await this.enforceOtpRequestLimits(phone, purpose);
    const digits = purpose === 'LOGIN' ? loginOtpDigits() : 4;
    const code = generateOtpCode(digits);
    const codeHash = await bcrypt.hash(code, 10);

    await this.controlDb.otpCode.create({
      data: {
        phone,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    const devEcho = process.env.OTP_DEV_ECHO === 'true';
    let smsSent = false;

    if (this.sms.isConfigured()) {
      const purposeText: Record<OtpPurpose, string> = {
        LOGIN: 'کد ورود شما',
        TENANT_INVITE: 'کد ورود شما',
        SIGNUP: 'کد تأیید ثبت‌نام شما',
        BOOKING: 'کد تأیید رزرو نوبت شما',
        TRACKING: 'کد تأیید پیگیری پروژه‌ی شما',
        CONTRACT_SIGN: 'کد تأیید امضای قرارداد شما',
        LAB_REVIEW: 'کد ورود شما به پورتال آزمایشگاه جیره',
        RATION_RESULT: 'کد تأیید مشاهده‌ی نتیجه‌ی آزمایش جیره',
        STORE_ORDER: 'کد تأیید سفارش فروشگاه شما',
        CONFIDENTIAL_ARCHIVE: 'کد دسترسی به بایگانی',
      };
      const message = `${purposeText[purpose]} در اکسیر ERP: ${code}`;
      const result = await this.sms.sendSms(phone, message);
      smsSent = result.success;
      if (!result.success) {
        await this.controlDb.errorLog.create({
          data: {
            service: 'backend-core',
            level: 'ERROR',
            message: `ارسال پیامک کد ورود ناموفق بود: ${result.error}`,
            context: { phone: maskPhone(phone) },
          },
        });
      }
    }

    // devCode is only ever returned when the real SMS wasn't sent (either
    // exirsms.ir isn't configured, or the request to it failed) — never
    // alongside a successful send, even with OTP_DEV_ECHO=true, so a real
    // deployment's logs/responses don't casually leak a code SMS already
    // delivered to the user's phone.
    // امنیتی: ریختن کد در پاسخ فقط وقتی پنل پیامک اصلاً پیکربندی نشده (dev/on-premise بدون پیامک). اگر پنل
    // پیکربندی است ولی ارسال شکست خورد (قطعی سرویس)، کد هرگز به درخواست‌کننده برنمی‌گردد — وگرنه هر کسی با زدن
    // «ارسال کد» روی شماره‌ی دیگری و منتظر قطعی ماندن، حساب او را تصاحب می‌کرد.
    return {
      expiresInSeconds: OTP_TTL_MS / 1000,
      codeLength: digits,
      ...(devEcho && !smsSent && !this.sms.isConfigured() ? { devCode: code } : {}),
    };
  }

  /**
   * Validates + consumes a LOGIN OTP for a phone, independent of which
   * tenant the login is ultimately for — a phone can belong to several
   * tenants (this box hosts public self-signup, so the same person can
   * have created more than one workspace), and the OTP itself has nothing
   * to do with which one they're logging into.
   */
  private async consumeLoginOtp(phone: string, code: string): Promise<void> {
    await this.assertLoginNotLocked(phone);
    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      this.events.record({ type: 'LOGIN_FAILED', severity: 'WARNING', message: 'wrong login OTP', context: { phone: maskPhone(phone) }, dedupeKey: phone });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * قفل جمعی حدس‌های غلط ورود به‌ازای شماره (جمع attempts همه‌ی کدهای LOGIN اخیر)؛ حدس‌زدن کد ۴ رقمی با درخواست
   * کد جدید پشت‌سرهم دیگر ممکن نیست. حداکثر ۱۰ حدس در ساعت و ۲۰ حدس در روز برای هر شماره.
   */
  private async assertLoginNotLocked(phone: string): Promise<void> {
    const now = Date.now();
    const [h, d] = await Promise.all([
      this.controlDb.otpCode.aggregate({ _sum: { attempts: true }, where: { phone, purpose: 'LOGIN', createdAt: { gte: new Date(now - 3600_000) } } }),
      this.controlDb.otpCode.aggregate({ _sum: { attempts: true }, where: { phone, purpose: 'LOGIN', createdAt: { gte: new Date(now - 24 * 3600_000) } } }),
    ]);
    if ((h._sum.attempts ?? 0) >= LOGIN_FAILED_GUESSES_1H || (d._sum.attempts ?? 0) >= LOGIN_FAILED_GUESSES_24H) {
      this.events.record({ type: 'OTP_LOCKED', severity: 'ERROR', message: 'login locked: too many wrong OTP guesses', context: { phone: maskPhone(phone) }, dedupeKey: phone });
      throw this.tooMany('تلاش‌های ناموفق زیاد بود؛ ورود این شماره موقتاً قفل است. بعداً دوباره تلاش کنید.');
    }
  }

  /**
   * لوگو و تعداد اعلانات خواندنشده نیاز به اتصال به دیتابیس همان تننت
   * دارند (بانک جدا برای هر تننت) — یک الگوی جدید در مسیر لاگین، هرچند
   * پیش‌تر فقط در کرون‌جاب‌های پس‌زمینه (مثل funnel-churn-cron) روی همه‌ی
   * تننت‌ها تکرار می‌شد. تعداد کاندیدها همیشه کوچک است (تننت‌های همین یک
   * شماره موبایل)، پس همه‌ی این کوئری‌ها موازی اجرا می‌شوند. اگر دیتابیس
   * یک تننت به هر دلیلی در دسترس نبود، کارت آن با مقادیر خالی نشان داده
   * می‌شود — یک تننت مشکل‌دار نباید کل صفحه‌ی انتخاب کسب‌وکار را خراب کند.
   */
  private async buildTenantCard(tenant: Tenant, globalUserId: string): Promise<TenantCard> {
    const [subscription, license, tenantDbInfo] = await Promise.all([
      this.controlDb.subscription.findFirst({
        where: { tenantId: tenant.id, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
        orderBy: { currentPeriodEnd: 'desc' },
        select: { currentPeriodEnd: true },
      }),
      this.controlDb.license.findFirst({
        where: { tenantId: tenant.id, status: 'ACTIVE' },
        orderBy: { expiresAt: 'desc' },
        select: { expiresAt: true },
      }),
      this.fetchTenantLogoAndPendingCount(tenant, globalUserId),
    ]);

    return {
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenantDbInfo.logoUrl,
      startDate: tenant.createdAt,
      expiresAt: license?.expiresAt ?? subscription?.currentPeriodEnd ?? null,
      pendingNotifications: tenantDbInfo.pendingCount,
    };
  }

  private async fetchTenantLogoAndPendingCount(
    tenant: Tenant,
    globalUserId: string,
  ): Promise<{ logoUrl: string | null; pendingCount: number }> {
    try {
      const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
      const [logoSetting, localUser] = await Promise.all([
        tenantDb.moduleSetting.findFirst({ where: { moduleCode: 'general', key: 'logoUrl' }, select: { value: true } }),
        tenantDb.user.findFirst({ where: { globalUserId }, select: { id: true } }),
      ]);
      const pendingCount = localUser
        ? await tenantDb.notification.count({ where: { userId: localUser.id, readAt: null } })
        : 0;
      return { logoUrl: (logoSetting?.value as string | undefined) ?? null, pendingCount };
    } catch {
      return { logoUrl: null, pendingCount: 0 };
    }
  }

  async verifyOtp(
    phone: string,
    code: string,
    tenantSlug?: string,
  ): Promise<
    | {
        accessToken: string;
        user: { name: string | null; phone: string };
        tenant: { name: string; slug: string };
        role: string;
        billingLocked?: boolean;
        outstandingInvoiceId?: string | null;
      }
    | { requiresTenantSelection: true; verificationToken: string; tenants: TenantCard[] }
    | { requiresTotp: true; totpToken: string }
  > {
    await this.consumeLoginOtp(phone, code);

    if (tenantSlug) {
      return this.resolveTenantLogin(phone, tenantSlug);
    }

    const globalUser = await this.controlDb.globalUser.findUnique({ where: { phone } });
    if (!globalUser) {
      throw new NotFoundException('این شماره در هیچ محیط کاری عضو نیست');
    }

    // یک تننت PENDING_PAYMENT هم باید اجازه‌ی ورود بدهد — فقط بعد از ورود در
    // پنل قفل و فاکتور معلق نشانش داده می‌شود (resolveTenantLogin/JwtAuthGuard)،
    // نه اینکه اصلاً انکار شود و به مشتری وانمود کند حسابش پاک شده.
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: {
        globalUserId: globalUser.id,
        status: { in: ['ACTIVE', 'INVITED'] },
        tenant: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      },
      include: { tenant: true },
    });

    if (memberships.length === 0) {
      throw new NotFoundException('این شماره در هیچ محیط کاری فعال عضو نیست');
    }
    if (memberships.length === 1) {
      return this.resolveTenantLogin(phone, memberships[0].tenant.slug);
    }

    const ticketPayload: TenantSelectionTicketPayload = { type: 'tenant_selection_ticket', phone };
    const verificationToken = await this.jwt.signAsync(ticketPayload, { expiresIn: TENANT_SELECTION_TOKEN_TTL_SECONDS });
    const tenants = await Promise.all(memberships.map((m) => this.buildTenantCard(m.tenant, globalUser.id)));
    return { requiresTenantSelection: true, verificationToken, tenants };
  }

  /** گام دوم ورود وقتی verify/select-tenant مقدار requiresTotp برگردانده است. */
  async completeTotpLogin(totpToken: string, code: string, ip?: string) {
    let payload: TenantTotpChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<TenantTotpChallengePayload>(totpToken, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('مهلت تأیید دومرحله‌ای تمام شد، دوباره وارد شوید');
    }
    if (payload.type !== 'tenant_totp_challenge') throw new UnauthorizedException('درخواست نامعتبر است');
    const user = await this.controlDb.globalUser.findUnique({ where: { phone: payload.phone } });
    if (!user || !user.totpEnabledAt) throw new UnauthorizedException('درخواست نامعتبر است');
    const now = Date.now();
    const f = this.totpFailures.get(user.id);
    if (f && f.resetAt > now && f.n >= 8) throw this.tooMany('تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره تلاش کنید');
    if (!(await this.twoFactor.checkCode(user.id, code, ip))) {
      this.totpFailures.set(user.id, { n: (f && f.resetAt > now ? f.n : 0) + 1, resetAt: f && f.resetAt > now ? f.resetAt : now + 15 * 60_000 });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    this.totpFailures.delete(user.id);
    return this.resolveTenantLogin(payload.phone, payload.tenantSlug, true);
  }

  /** برای گام دوم انتخاب محیط کاری — کد OTP دوباره لازم نیست، چون همین الان مصرف شده است. */
  async selectTenant(verificationToken: string, tenantSlug: string) {
    let payload: TenantSelectionTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TenantSelectionTicketPayload>(verificationToken);
    } catch {
      throw new UnauthorizedException('نشست انتخاب محیط کاری منقضی شده است، دوباره کد را درخواست دهید');
    }
    if (payload.type !== 'tenant_selection_ticket') {
      throw new UnauthorizedException('نشست انتخاب محیط کاری نامعتبر است');
    }
    return this.resolveTenantLogin(payload.phone, tenantSlug);
  }

  /** برای سوییچ محیط کاری از داخل خود پنل (هدر) — کاربر از قبل با JWT وارد شده است. */
  async listMyTenants(globalUserId: string): Promise<{ slug: string; name: string }[]> {
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { globalUserId, status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } } },
      include: { tenant: true },
    });
    return memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name }));
  }

  /** سوییچ به یک محیط کاری دیگر که کاربر از قبل عضو فعال آن است — بدون نیاز به کد تأیید مجدد. */
  async switchTenant(globalUserId: string, tenantSlug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || (tenant.status !== 'ACTIVE' && tenant.status !== 'PENDING_PAYMENT')) {
      throw new NotFoundException('این محیط کاری یافت نشد یا فعال نیست');
    }

    const membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException('شما عضو فعال این محیط کاری نیستید');
    }

    const globalUser = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    const payload: TenantJwtPayload = {
      type: 'tenant_user',
      sub: globalUser.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      tv: await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion),
    };
    const accessToken = await this.jwt.signAsync(payload);

    let billingLocked: boolean | undefined;
    let outstandingInvoiceId: string | null = null;
    if (tenant.status === 'PENDING_PAYMENT') {
      billingLocked = true;
      const invoice = await this.controlDb.invoice.findFirst({
        where: { tenantId: tenant.id, status: 'PENDING' },
        orderBy: { issuedAt: 'desc' },
      });
      outstandingInvoiceId = invoice?.id ?? null;
    }

    return {
      accessToken,
      user: { name: globalUser.name, phone: globalUser.phone },
      tenant: { name: tenant.name, slug: tenant.slug },
      role: membership.role,
      ...(billingLocked ? { billingLocked, outstandingInvoiceId } : {}),
    };
  }

  private async resolveTenantLogin(phone: string, tenantSlug: string, mfaDone = false) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: tenantSlug } });
    // یک تننت PENDING_PAYMENT (تریال تمام‌شده) هم اجازه‌ی ورود می‌گیرد — فقط
    // با یک نشست قفل‌شده که JwtAuthGuard آن را به دیدن/پرداخت فاکتور محدود
    // می‌کند؛ هرگز نباید به مشتری وانمود کند حسابش پاک یا پیدا نشده است.
    if (!tenant || (tenant.status !== 'ACTIVE' && tenant.status !== 'PENDING_PAYMENT')) {
      throw new NotFoundException('این محیط کاری یافت نشد یا فعال نیست');
    }

    const globalUser = await this.controlDb.globalUser.findUnique({ where: { phone } });
    if (!globalUser) {
      throw new NotFoundException('این شماره در هیچ محیط کاری عضو نیست');
    }

    let membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId: globalUser.id } },
    });
    if (!membership) {
      throw new UnauthorizedException('این شماره عضو این محیط کاری نیست');
    }
    if (membership.status === 'DISABLED') {
      throw new UnauthorizedException('دسترسی شما به این محیط کاری غیرفعال شده است');
    }
    if (!mfaDone && globalUser.totpEnabledAt) {
      // 2FA اختیاری (TOTP) فعال است: OTP پیامکی کافی نیست؛ گام دوم لازم است.
      const challenge: TenantTotpChallengePayload = { type: 'tenant_totp_challenge', phone, tenantSlug };
      const totpToken = await this.jwt.signAsync(challenge, { expiresIn: 5 * 60 });
      return { requiresTotp: true as const, totpToken };
    }
    if (membership.status === 'INVITED') {
      membership = await this.controlDb.tenantMembership.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
      const tenantDb = this.tenantPrisma.forTenant({
        dbHost: tenant.dbHost,
        dbPort: tenant.dbPort,
        dbName: tenant.dbName,
      });
      await tenantDb.user.updateMany({
        where: { globalUserId: globalUser.id },
        data: { status: 'ACTIVE' },
      });
    }

    await this.controlDb.globalUser.update({
      where: { id: globalUser.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: TenantJwtPayload = {
      type: 'tenant_user',
      sub: globalUser.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      tv: await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion),
    };
    const accessToken = await this.jwt.signAsync(payload);

    let billingLocked: boolean | undefined;
    let outstandingInvoiceId: string | null = null;
    if (tenant.status === 'PENDING_PAYMENT') {
      billingLocked = true;
      const invoice = await this.controlDb.invoice.findFirst({
        where: { tenantId: tenant.id, status: 'PENDING' },
        orderBy: { issuedAt: 'desc' },
      });
      outstandingInvoiceId = invoice?.id ?? null;
    }

    return {
      accessToken,
      user: { name: globalUser.name, phone: globalUser.phone },
      tenant: { name: tenant.name, slug: tenant.slug },
      role: membership.role,
      ...(billingLocked ? { billingLocked, outstandingInvoiceId } : {}),
    };
  }
}
