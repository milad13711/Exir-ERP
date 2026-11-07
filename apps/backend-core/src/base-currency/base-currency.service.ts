import { createHash, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '../../generated/tenant-client/index.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { BackupDrService } from '../backup-dr/backup-dr.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import {
  BASE_CURRENCY_KEY,
  BASE_CURRENCY_MODULE,
  invalidateBaseCurrency,
  loadBaseCurrency,
  serializeBaseCurrency,
  type BaseCurrencyState,
} from './base-unit.js';
import {
  ConversionAbort,
  buildPreview,
  runConversion,
  type Issue,
  type RawDb,
  type RunReport,
  type SettingsIo,
} from './conversion-engine.js';
import type { JsonSettingSpec } from './money-columns.js';
import { BASE_CURRENCY_PRESETS, RateParseError, defaultRate, invert, parseRate, presetOf, rationalToString, reduce, scaleValue, type Rational, type RoundingMode } from './rational.js';
import { writeLock } from './write-lock.js';
import type { ExecuteBaseCurrencyDto, PreviewBaseCurrencyDto, ReverseBaseCurrencyDto } from './dto/base-currency.dto.js';

export const CURRENCY_MODULE_CODE = 'currency-exchange';
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_15M = 3;
const HEARTBEAT_MS = 10_000;
const STALE_MS = 2 * 60_000;
const drainMs = () => Number(process.env.BASE_CURRENCY_DRAIN_MS) || 30_000;

export type ResolvedPlan = {
  from: BaseCurrencyState;
  toCode: string;
  toLabel: string;
  rate: Rational;
  mode: RoundingMode;
  /** tomanPerUnit جدید */
  toState: BaseCurrencyState;
  phrase: string;
};

type Progress = { done: number; total: number; label: string; updatedAt: number };

/** ارقام فارسی/عربی و ي/ك عربی و فاصله‌ی اضافی را یکدست می‌کند تا عبارت تأیید با تایپ فارسی بخورد. */
export function normalizePhrase(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function confirmPhraseFor(toLabel: string): string {
  return `تغییر ارز پایه به ${toLabel}`;
}
/** هش طرح: از، به، ضریب، حالت گرد‌کردن، نوع (و عملیاتِ مبدأ در بازگشت) — کد پیامکی به همین هش بسته می‌شود. */
export function planHashOf(kind: 'CONVERT' | 'REVERSE', plan: Pick<ResolvedPlan, 'from' | 'toCode' | 'rate' | 'mode'>, reverseOfId?: string): string {
  return createHash('sha256')
    .update([kind, plan.from.code, plan.toCode, plan.rate.num.toString(), plan.rate.den.toString(), plan.mode, reverseOfId ?? ''].join('|'))
    .digest('hex');
}

export const REVERSE_PHRASE = 'بازگشت تغییر ارز پایه';

@Injectable()
export class BaseCurrencyService implements OnModuleInit {
  private readonly logger = new Logger('BaseCurrency');
  private readonly progress = new Map<string, Progress>();
  private readonly active = new Set<string>();

  constructor(
    private readonly controlDb: ControlPrismaService,
    @Optional() private readonly backup?: BackupDrService,
    @Optional() private readonly sms?: ExirSmsService,
    @Optional() private readonly tenantPrisma?: TenantPrismaService,
  ) {}

  onModuleInit(): void {
    // پس از بوت، عملیات رهاشده‌ی قبلی (کرش) را فوراً FAILED علامت می‌زند (ضربان‌شان قدیمی است)
    void this.sweepStale();
  }

  /** هر چند دقیقه: عملیات RUNNING با ضربان قطع‌شده در همه‌ی تننت‌ها را آزاد می‌کند (کرش پروسه/چندپروسه‌ای). */
  @Cron('*/2 * * * *')
  async sweepStale(): Promise<void> {
    if (!this.tenantPrisma) return;
    try {
      const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, dbHost: true, dbPort: true, dbName: true } });
      for (const t of tenants) {
        try {
          await this.recoverStale(this.tenantPrisma.forTenant(t));
        } catch {
          // تننتِ مهاجرت‌نشده یا ناقابل‌دسترس — نادیده
        }
      }
    } catch (e) {
      this.logger.warn(`stale sweep failed: ${(e as Error).message}`);
    }
  }

  // ── اجازه‌ها ────────────────────────────────────────────────────────────────
  private assertOwnerHuman(ctx: TenantRequestContext): void {
    if (ctx.auth.type === 'api_key') throw new ForbiddenException('این عملیات فقط با نشست کاربر واقعی ممکن است، نه کلید API');
    if (ctx.auth.role !== 'OWNER') throw new ForbiddenException('فقط مالک محیط کاری می‌تواند ارز پایه را تغییر دهد');
  }

  private async currentUser(ctx: TenantRequestContext): Promise<{ id: string; phone: string; name: string }> {
    const user = await ctx.tenantDb.user.findUnique({ where: { globalUserId: ctx.auth.sub }, select: { id: true, phone: true, name: true } });
    if (!user) throw new NotFoundException('کاربر در این محیط کاری یافت نشد');
    return user;
  }

  // ── وضعیت ───────────────────────────────────────────────────────────────────
  async getState(ctx: TenantRequestContext) {
    await this.recoverStale(ctx.tenantDb);
    const current = await loadBaseCurrency(ctx.tenantDb, { fresh: true });
    const [running, last] = await Promise.all([
      ctx.tenantDb.baseCurrencyConversion.findFirst({ where: { status: 'RUNNING' } }),
      ctx.tenantDb.baseCurrencyConversion.findFirst({ where: { status: 'DONE' }, orderBy: { finishedAt: 'desc' } }),
    ]);
    const canReverse = !!last && last.kind === 'CONVERT' && !last.reversedById && !running;
    return {
      current: { code: current.code, label: current.label, changedAt: current.changedAt, conversionId: current.conversionId },
      presets: BASE_CURRENCY_PRESETS.map((p) => ({ code: p.code, label: p.label })),
      running: running ? this.summary(running) : null,
      lastConversion: last ? this.summary(last) : null,
      canReverse,
      backupRequired: !this.skipBackup(),
    };
  }

  private summary(c: {
    id: string; kind: string; status: string; fromCode: string; toCode: string; fromLabel: string; toLabel: string; rateNum: string; rateDen: string;
    roundingMode: string; startedAt: Date; finishedAt: Date | null; executedByName: string | null; errorMessage: string | null; reversedById: string | null; reverseOfId: string | null;
    backupFile: string | null;
  }) {
    const p = this.progress.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      fromCode: c.fromCode,
      toCode: c.toCode,
      fromLabel: c.fromLabel,
      toLabel: c.toLabel,
      rate: rationalToString({ num: BigInt(c.rateNum), den: BigInt(c.rateDen) }),
      roundingMode: c.roundingMode,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      executedByName: c.executedByName,
      errorMessage: c.errorMessage,
      reversedById: c.reversedById,
      reverseOfId: c.reverseOfId,
      backupFile: c.backupFile,
      progress: p ? { done: p.done, total: p.total, label: p.label } : null,
    };
  }

  async history(ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.baseCurrencyConversion.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => this.summary(r));
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const row = await ctx.tenantDb.baseCurrencyConversion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('عملیات یافت نشد');
    return { ...this.summary(row), report: row.report };
  }

  // ── برنامه‌ی تبدیل ──────────────────────────────────────────────────────────
  resolvePlan(from: BaseCurrencyState, dto: Pick<PreviewBaseCurrencyDto, 'toCode' | 'toLabel' | 'rate' | 'roundingMode'>): ResolvedPlan {
    const toCode = dto.toCode;
    if (toCode === from.code) throw new BadRequestException('ارز مقصد با ارز پایه‌ی فعلی یکی است');
    const preset = presetOf(toCode);
    const toLabel = (preset?.label ?? dto.toLabel?.trim()) || '';
    if (!toLabel) throw new BadRequestException('برای ارز غیر از ریال/تومان، عنوان نمایشی لازم است');
    const mandatory = defaultRate(from.code, toCode);
    let rate: Rational;
    try {
      if (mandatory) {
        // ریال⇄تومان: نرخ ثابت ۱۰ است؛ نرخ دیگر یعنی اشتباه کاربر
        if (dto.rate && !sameRational(parseRate(dto.rate), mandatory)) {
          throw new BadRequestException('نرخ تبدیل ریال و تومان ثابت و برابر ۱۰ است');
        }
        rate = mandatory;
      } else {
        if (!dto.rate) throw new BadRequestException('برای این جفت‌ارز، نرخ تبدیل را وارد کنید (واحد جدید به‌ازای هر ۱ واحد ارز فعلی)');
        rate = parseRate(dto.rate);
      }
    } catch (e) {
      if (e instanceof RateParseError) throw new BadRequestException(e.message);
      throw e;
    }
    const mode: RoundingMode = dto.roundingMode ?? 'STRICT';
    // tomanPerUnit جدید = tomanPerUnit قدیم ÷ نرخ
    const tpu = preset?.tomanPerUnit ?? reduce({ num: from.tomanPerUnit.num * rate.den, den: from.tomanPerUnit.den * rate.num });
    const toState: BaseCurrencyState = { code: toCode, label: toLabel, tomanPerUnit: tpu, changedAt: null, conversionId: null };
    return { from, toCode, toLabel, rate, mode, toState, phrase: confirmPhraseFor(toLabel) };
  }

  async preview(ctx: TenantRequestContext, dto: PreviewBaseCurrencyDto) {
    this.assertOwnerHuman(ctx);
    await this.recoverStale(ctx.tenantDb);
    const from = await loadBaseCurrency(ctx.tenantDb, { fresh: true });
    const plan = this.resolvePlan(from, dto);
    const report = await buildPreview(ctx.tenantDb as unknown as RawDb, plan.rate, plan.mode);
    return {
      from: { code: from.code, label: from.label },
      to: { code: plan.toCode, label: plan.toLabel },
      rate: rationalToString(plan.rate),
      roundingMode: plan.mode,
      confirmPhrase: plan.phrase,
      backupRequired: !this.skipBackup(),
      canExecute: report.blocking.length === 0,
      ...report,
    };
  }

  // ── طرح‌ها ─────────────────────────────────────────────────────────────────
  async planForConvert(ctx: TenantRequestContext, dto: PreviewBaseCurrencyDto): Promise<ResolvedPlan> {
    const from = await loadBaseCurrency(ctx.tenantDb, { fresh: true });
    return this.resolvePlan(from, dto);
  }

  async planForReverse(ctx: TenantRequestContext, id: string, roundingMode?: RoundingMode): Promise<{ plan: ResolvedPlan; orig: { id: string } }> {
    const orig = await ctx.tenantDb.baseCurrencyConversion.findUnique({ where: { id } });
    if (!orig || orig.status !== 'DONE' || orig.kind !== 'CONVERT') throw new NotFoundException('عملیات قابل بازگشت یافت نشد');
    if (orig.reversedById) throw new ConflictException('این عملیات قبلاً بازگردانده شده است');
    const later = await ctx.tenantDb.baseCurrencyConversion.findFirst({ where: { status: 'DONE', finishedAt: { gt: orig.finishedAt ?? orig.startedAt } } });
    if (later) throw new ConflictException('فقط آخرین تغییر ارز پایه قابل بازگشت است');
    const from = await loadBaseCurrency(ctx.tenantDb, { fresh: true });
    if (from.code !== orig.toCode) throw new ConflictException('ارز پایه‌ی فعلی با خروجی آن عملیات نمی‌خواند');

    const rate = invert({ num: BigInt(orig.rateNum), den: BigInt(orig.rateDen) });
    const preset = presetOf(orig.fromCode);
    const origTpu = preset?.tomanPerUnit ?? reduce({ num: from.tomanPerUnit.num * rate.den, den: from.tomanPerUnit.den * rate.num });
    const plan: ResolvedPlan = {
      from,
      toCode: orig.fromCode,
      toLabel: orig.fromLabel,
      rate,
      mode: roundingMode ?? 'STRICT',
      toState: { code: orig.fromCode, label: orig.fromLabel, tomanPerUnit: origTpu, changedAt: null, conversionId: null },
      phrase: REVERSE_PHRASE,
    };
    return { plan, orig: { id: orig.id } };
  }

  // ── تأیید دومرحله‌ای (پیامک) — بسته به «طرح» ─────────────────────────────────
  async requestConfirmation(
    ctx: TenantRequestContext,
    input: { reverseOfId?: string; dto?: PreviewBaseCurrencyDto; roundingMode?: RoundingMode },
  ): Promise<{ expiresInSeconds: number; devCode?: string }> {
    this.assertOwnerHuman(ctx);
    const plan = input.reverseOfId
      ? (await this.planForReverse(ctx, input.reverseOfId, input.roundingMode)).plan
      : await this.planForConvert(ctx, input.dto ?? ({} as PreviewBaseCurrencyDto));
    const hash = planHashOf(input.reverseOfId ? 'REVERSE' : 'CONVERT', plan, input.reverseOfId);

    const user = await this.currentUser(ctx);
    const recent = await ctx.tenantDb.baseCurrencyConfirmation.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
    if (recent >= OTP_PER_15M) throw new HttpException('تعداد درخواست کد زیاد است؛ چند دقیقه دیگر تلاش کنید', 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // کدهای قبلیِ مصرف‌نشده باطل می‌شوند تا همیشه فقط «آخرین» کد معتبر باشد
    await ctx.tenantDb.baseCurrencyConfirmation.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    await ctx.tenantDb.baseCurrencyConfirmation.create({
      data: { userId: user.id, codeHash: await bcrypt.hash(code, 10), planHash: hash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    const devEcho = process.env.OTP_DEV_ECHO === 'true';
    let sent = false;
    if (this.sms?.isConfigured()) {
      const r = await this.sms.sendSms(user.phone, `کد تأیید ${input.reverseOfId ? 'بازگشت ' : ''}تغییر ارز پایه به ${plan.toLabel} در اکسیر ERP: ${code}\nاین کد را به هیچ‌کس ندهید.`);
      sent = r.success;
    }
    if (!sent && !devEcho) throw new HttpException('ارسال پیامک تأیید ممکن نیست؛ بعداً دوباره تلاش کنید', 503);
    return { expiresInSeconds: OTP_TTL_MS / 1000, ...(devEcho && !sent && !this.sms?.isConfigured() ? { devCode: code } : {}) };
  }

  /**
   * بررسی کد (بدون مصرف). شمارش تلاش اتمیک است: `attempts < max` در همان UPDATE چک می‌شود، پس درخواست‌های موازی
   * نمی‌توانند سقف ۵ تلاش را دور بزنند. کد به طرح بسته است (planHash).
   */
  private async checkConfirmation(ctx: TenantRequestContext, code: string, expectedPlanHash: string): Promise<string> {
    const user = await this.currentUser(ctx);
    const row = await ctx.tenantDb.baseCurrencyConfirmation.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new BadRequestException('کد تأیید منقضی شده یا درخواست نشده است؛ دوباره کد بگیرید');
    const bumped = await ctx.tenantDb.baseCurrencyConfirmation.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count !== 1) throw new BadRequestException('تعداد تلاش‌های مجاز تمام شد؛ کد جدید بگیرید');
    const normalized = code.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    if (!(await bcrypt.compare(normalized, row.codeHash))) throw new UnauthorizedException('کد تأیید نادرست است');
    if (row.planHash !== expectedPlanHash) throw new BadRequestException('این کد برای همین عملیات صادر نشده است؛ برای تنظیمات فعلی دوباره کد بگیرید');
    return row.id;
  }

  /** مصرف اتمیک؛ دو درخواست هم‌زمان با یک کد نمی‌توانند هر دو موفق شوند. */
  private async consumeConfirmation(ctx: TenantRequestContext, rowId: string): Promise<void> {
    const res = await ctx.tenantDb.baseCurrencyConfirmation.updateMany({ where: { id: rowId, consumedAt: null }, data: { consumedAt: new Date() } });
    if (res.count !== 1) throw new BadRequestException('این کد قبلاً استفاده شده است');
  }

  // ── اجرا ────────────────────────────────────────────────────────────────────
  private skipBackup(): boolean {
    return process.env.BASE_CURRENCY_SKIP_BACKUP === 'true' && process.env.NODE_ENV !== 'production';
  }

  async execute(ctx: TenantRequestContext, dto: ExecuteBaseCurrencyDto, opts: { awaitRun?: boolean } = {}) {
    this.assertOwnerHuman(ctx);
    const existing = await ctx.tenantDb.baseCurrencyConversion.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return { ...this.summary(existing), replayed: true };

    await this.recoverStale(ctx.tenantDb);
    const plan = await this.planForConvert(ctx, dto);
    return this.start(ctx, { kind: 'CONVERT', plan, idempotencyKey: dto.idempotencyKey, confirmPhrase: dto.confirmPhrase, otp: dto.otp, awaitRun: opts.awaitRun });
  }

  async reverse(ctx: TenantRequestContext, id: string, dto: ReverseBaseCurrencyDto, opts: { awaitRun?: boolean } = {}) {
    this.assertOwnerHuman(ctx);
    const existing = await ctx.tenantDb.baseCurrencyConversion.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) return { ...this.summary(existing), replayed: true };

    await this.recoverStale(ctx.tenantDb);
    const { plan, orig } = await this.planForReverse(ctx, id, dto.roundingMode);
    return this.start(ctx, { kind: 'REVERSE', plan, idempotencyKey: dto.idempotencyKey, confirmPhrase: dto.confirmPhrase, otp: dto.otp, reverseOfId: orig.id, awaitRun: opts.awaitRun });
  }

  private startBeat(db: TenantPrismaClient, convId: string): () => void {
    const beat = setInterval(() => {
      void db.baseCurrencyConversion.update({ where: { id: convId }, data: { heartbeatAt: new Date() } }).catch(() => {});
    }, HEARTBEAT_MS);
    beat.unref?.();
    return () => clearInterval(beat);
  }

  private async failEarly(db: TenantPrismaClient, tenantId: string, convId: string, stopBeat: () => void, message: string): Promise<void> {
    stopBeat();
    this.active.delete(convId);
    writeLock.release(tenantId);
    invalidateBaseCurrency(db);
    await db.baseCurrencyConversion
      .update({ where: { id: convId }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message.slice(0, 2000) } })
      .catch((err) => this.logger.error(`could not mark ${convId} failed: ${(err as Error).message}`));
  }

  /**
   * ترتیب امن: (۱) پیش‌بررسی و عبارت/کد (بدون مصرف) → (۲) ردیف RUNNING = قفل، پیش از هر کار سنگین، تا تلاش مجدد با همان
   * idempotencyKey ردیف را پیدا کند و پشتیبان دوباره نگیرد → (۳) تخلیه‌ی درخواست‌های در جریان → (۴) پشتیبان →
   * (۵) فقط پس از موفقیت پشتیبان، مصرف کد → (۶) اجرای تراکنش. شکست پیش از (۵) کد را معتبر نگه می‌دارد.
   */
  private async start(
    ctx: TenantRequestContext,
    a: { kind: 'CONVERT' | 'REVERSE'; plan: ResolvedPlan; idempotencyKey: string; confirmPhrase: string; otp: string; reverseOfId?: string; awaitRun?: boolean },
  ) {
    const db = ctx.tenantDb;
    const { plan } = a;

    if (writeLock.isLocked(ctx.tenantId) || (await db.baseCurrencyConversion.count({ where: { status: 'RUNNING' } })) > 0) {
      throw new ConflictException('یک عملیات تغییر ارز پایه در حال اجراست؛ هم‌زمان فقط یکی مجاز است');
    }

    // ۱) پیش‌نمایش دوباره‌ی همین لحظه — اگر مانعی هست، قبل از هر چیز رد می‌شود
    const report = await buildPreview(db as unknown as RawDb, plan.rate, plan.mode);
    if (report.blocking.length) {
      throw new HttpException({ message: 'تبدیل با این تنظیمات ممکن نیست', blocking: report.blocking }, 422);
    }
    if (normalizePhrase(a.confirmPhrase) !== normalizePhrase(plan.phrase)) {
      throw new BadRequestException(`برای تأیید باید دقیقاً این عبارت را تایپ کنید: «${plan.phrase}»`);
    }
    const confirmationId = await this.checkConfirmation(ctx, a.otp, planHashOf(a.kind, plan, a.reverseOfId));
    const user = await this.currentUser(ctx);

    // ۲) ردیف RUNNING = قفل (ایندکس یکتای جزئی از اجرای هم‌زمان جلوگیری می‌کند)
    let conv;
    try {
      conv = await db.baseCurrencyConversion.create({
        data: {
          kind: a.kind,
          status: 'RUNNING',
          fromCode: plan.from.code,
          toCode: plan.toCode,
          fromLabel: plan.from.label,
          toLabel: plan.toLabel,
          rateNum: plan.rate.num.toString(),
          rateDen: plan.rate.den.toString(),
          roundingMode: plan.mode,
          reverseOfId: a.reverseOfId ?? null,
          idempotencyKey: a.idempotencyKey,
          executedByUserId: user.id,
          executedByName: user.name,
          heartbeatAt: new Date(),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const replay = await db.baseCurrencyConversion.findUnique({ where: { idempotencyKey: a.idempotencyKey } });
        if (replay) return { ...this.summary(replay), replayed: true };
        throw new ConflictException('یک عملیات تغییر ارز پایه در حال اجراست؛ هم‌زمان فقط یکی مجاز است');
      }
      throw e;
    }
    writeLock.acquire(ctx.tenantId, conv.id, ctx.tenantSlug);
    this.active.add(conv.id);
    const stopBeat = this.startBeat(db, conv.id);

    // ۳) تخلیه‌ی درخواست‌های مالیِ در جریان همین تننت (حداکثر DRAIN_MS)
    const drained = await writeLock.drain(ctx.tenantId, ctx.tenantSlug, drainMs());
    if (!drained) {
      await this.failEarly(db, ctx.tenantId, conv.id, stopBeat, 'درخواست‌های مالیِ در جریان به‌موقع تمام نشدند؛ عملیات شروع نشد و هیچ تغییری اعمال نشد. دوباره تلاش کنید.');
      throw new HttpException('درخواست‌های مالیِ در جریان به‌موقع تمام نشدند؛ چند دقیقه دیگر دوباره تلاش کنید', 409);
    }

    // ۴) پشتیبان
    let backupInfo: { file: string; size: string; sha256: string } | null = null;
    try {
      backupInfo = await this.takeBackup(ctx);
    } catch (e) {
      await this.failEarly(db, ctx.tenantId, conv.id, stopBeat, (e as Error).message);
      throw e;
    }

    // ۵) مصرف کد — فقط پس از موفقیت پشتیبان
    try {
      await this.consumeConfirmation(ctx, confirmationId);
    } catch (e) {
      await this.failEarly(db, ctx.tenantId, conv.id, stopBeat, (e as Error).message);
      throw e;
    }
    // هر شکستی بین مصرف کد و شروع اجرا باید قفل/ضربان را آزاد و ردیف را FAILED کند (وگرنه تننت تا recoverStale قفل می‌ماند)
    try {
      await db.baseCurrencyConversion.update({
        where: { id: conv.id },
        data: { backupFile: backupInfo?.file ?? null, backupSize: backupInfo?.size ?? null, backupSha256: backupInfo?.sha256 ?? null, backupAt: backupInfo ? new Date() : null },
      });

      // ۶) اجرا
      const runPromise = this.run(ctx.tenantId, db, conv.id, plan, a.reverseOfId, stopBeat);
      if (a.awaitRun) await runPromise;
      else void runPromise;
    } catch (e) {
      await this.failEarly(db, ctx.tenantId, conv.id, stopBeat, (e as Error).message);
      throw e;
    }
    const fresh = await db.baseCurrencyConversion.findUnique({ where: { id: conv.id } });
    return { ...this.summary(fresh ?? conv), replayed: false };
  }

  private async takeBackup(ctx: TenantRequestContext): Promise<{ file: string; size: string; sha256: string } | null> {
    if (this.skipBackup()) return null;
    if (!this.backup) throw new HttpException('سرویس پشتیبان‌گیری در دسترس نیست؛ تبدیل بدون پشتیبان مجاز نیست', 503);
    if (this.backup.isRunning()) throw new ConflictException('پشتیبان‌گیری یا آزمون بازیابی دیگری در حال اجراست؛ چند دقیقه بعد دوباره تلاش کنید');
    try {
      const r = await this.backup.backupTenantForOperation(ctx.tenantSlug, 'preconv');
      return { file: r.file, size: String(r.size), sha256: r.sha256 };
    } catch (e) {
      this.logger.error(`pre-conversion backup failed for ${ctx.tenantSlug}: ${(e as Error).message}`);
      throw new HttpException('پشتیبان‌گیری پیش از تبدیل ناموفق بود؛ هیچ تغییری اعمال نشد (کد تأیید همچنان معتبر است)', 502);
    }
  }

  /** اجرای واقعی در یک تراکنش. هرگز throw نمی‌کند: نتیجه روی رکورد عملیات ثبت می‌شود. */
  async run(tenantId: string, db: TenantPrismaClient, convId: string, plan: ResolvedPlan, reverseOfId?: string, stopBeat?: () => void): Promise<void> {
    const stop = stopBeat ?? this.startBeat(db, convId);
    try {
      await db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT pg_try_advisory_xact_lock(hashtext('exir-base-currency')) AS ok`);
          if (!lock?.ok) throw new ConversionAbort('عملیات دیگری روی همین دیتابیس در حال اجراست');

          const row = await tx.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: BASE_CURRENCY_MODULE, key: BASE_CURRENCY_KEY } } });
          const currentCode = (row?.value as { code?: string } | null)?.code ?? 'IRT';
          if (currentCode !== plan.from.code) {
            throw new ConversionAbort('ارز پایه از زمان شروع عملیات تغییر کرده است؛ عملیات لغو شد');
          }

          const report = await runConversion(
            tx as unknown as RawDb,
            {
              conversionId: convId,
              rate: plan.rate,
              mode: plan.mode,
              fromCode: plan.from.code,
              toCode: plan.toCode,
              restoreFromConversionId: reverseOfId,
              onProgress: (done, total, label) => this.progress.set(convId, { done, total, label, updatedAt: Date.now() }),
            },
            this.settingsIo(tx as unknown as TenantPrismaClient),
          );

          const now = new Date();
          const newState = serializeBaseCurrency({ ...plan.toState, changedAt: now.toISOString(), conversionId: convId });
          await tx.moduleSetting.upsert({
            where: { moduleCode_key: { moduleCode: BASE_CURRENCY_MODULE, key: BASE_CURRENCY_KEY } },
            create: { moduleCode: BASE_CURRENCY_MODULE, key: BASE_CURRENCY_KEY, value: newState },
            update: { value: newState },
          });
          await tx.baseCurrencyConversion.update({
            where: { id: convId },
            data: { status: 'DONE', finishedAt: now, errorMessage: null, report: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue },
          });
          if (reverseOfId) await tx.baseCurrencyConversion.update({ where: { id: reverseOfId }, data: { reversedById: convId } });
        },
        { timeout: 30 * 60_000, maxWait: 30_000 },
      );
      this.logger.log(`base currency conversion ${convId} DONE (${plan.from.code} → ${plan.toCode})`);
    } catch (e) {
      const message = e instanceof ConversionAbort ? `${e.message}${e.issues.length ? ` — ${e.issues.map((i: Issue) => i.message).join('؛ ')}` : ''}` : (e as Error).message;
      this.logger.error(`base currency conversion ${convId} FAILED (rolled back): ${message}`);
      await db.baseCurrencyConversion
        .update({ where: { id: convId }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message.slice(0, 2000) } })
        .catch((err) => this.logger.error(`could not mark ${convId} failed: ${(err as Error).message}`));
    } finally {
      stop();
      this.active.delete(convId);
      writeLock.release(tenantId);
      invalidateBaseCurrency(db);
    }
  }

  /** عملیات RUNNING که ضربانش قطع شده (کرش پروسه) — تراکنش خودبه‌خود رول‌بک شده، پس FAILED علامت می‌خورد و دوباره قابل اجراست. */
  async recoverStale(db: TenantPrismaClient): Promise<number> {
    const stale = await db.baseCurrencyConversion.findMany({ where: { status: 'RUNNING' } });
    let n = 0;
    for (const c of stale) {
      if (this.active.has(c.id)) continue;
      const beat = c.heartbeatAt ?? c.startedAt;
      if (Date.now() - beat.getTime() < STALE_MS) continue;
      await db.baseCurrencyConversion.update({
        where: { id: c.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'عملیات نیمه‌کاره متوقف شد (قطع پروسه). تراکنش برگردانده شده و داده‌ها دست‌نخورده‌اند؛ می‌توانید دوباره اجرا کنید.' },
      });
      n += 1;
    }
    return n;
  }

  // ── تنظیمات عددی ModuleSetting ────────────────────────────────────────────
  private settingsIo(tx: TenantPrismaClient): SettingsIo {
    return {
      convert: async (specs: JsonSettingSpec[], rate, mode) => {
        const out: RunReport['settings'] = [];
        const scaleNumber = (v: unknown): number | null => {
          if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return null;
          if (!Number.isInteger(v)) throw new ConversionAbort('مقدار تنظیمات مبلغی عدد صحیح نیست', [{ code: 'SETTING', message: String(v) }]);
          try {
            const r = scaleValue(BigInt(v), rate, mode);
            if (r.result > BigInt(Number.MAX_SAFE_INTEGER)) throw new ConversionAbort('مقدار تنظیمات پس از تبدیل بیش از حد بزرگ است');
            return Number(r.result);
          } catch (e) {
            if (e instanceof ConversionAbort) throw e;
            throw new ConversionAbort('مقدار یک تنظیم مبلغی دقیق تبدیل نمی‌شود', [{ code: 'SETTING_INEXACT', message: String(v) }]);
          }
        };
        for (const spec of specs) {
          const row = await tx.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: spec.moduleCode, key: spec.key } } });
          if (!row) continue;
          if (spec.kind === 'number') {
            const next = scaleNumber(row.value);
            if (next === null) continue;
            await tx.moduleSetting.update({ where: { id: row.id }, data: { value: next } });
            out.push({ moduleCode: spec.moduleCode, key: spec.key, before: row.value, after: next });
          } else if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
            const obj = { ...(row.value as Record<string, unknown>) };
            let changed = false;
            for (const f of spec.fields) {
              const next = scaleNumber(obj[f]);
              if (next !== null) {
                obj[f] = next;
                changed = true;
              }
            }
            if (changed) {
              await tx.moduleSetting.update({ where: { id: row.id }, data: { value: obj as Prisma.InputJsonValue } });
              out.push({ moduleCode: spec.moduleCode, key: spec.key, before: row.value, after: obj });
            }
          }
        }
        return out;
      },
    };
  }
}

function sameRational(a: Rational, b: Rational): boolean {
  return a.num * b.den === b.num * a.den;
}

