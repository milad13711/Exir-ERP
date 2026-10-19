import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { IntegrityService } from './integrity.service.js';
import {
  LicenseCryptoError,
  evaluateToken,
  fingerprintDigest,
  fingerprintMatches,
  loadPublicKeyringFromEnv,
  randomNonce,
  responseSigningString,
  sha256Hex,
  verifyActivationToken,
  verifySignedPayload,
  verifyString,
  type ActivationTokenPayload,
  type CrlDocument,
  type PublicKeyring,
  type TokenEvaluation,
} from './license-crypto.js';
import { computeFingerprintComponents, derivedInstallationId } from './host-fingerprint.js';
import { InstallStateStore, newInstallState, type InstallState } from './license-state.js';
import type { LicensePayload } from './license-token.js';

const LEGACY_GRACE_DAYS = 7;
const DEFAULT_CHECKIN_MS = 60 * 60 * 1000;
const RESPONSE_WINDOW_S = 300;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type LicenseStatus =
  | { mode: 'cloud' }
  | {
      mode: 'on_premise';
      state: 'valid' | 'grace';
      payload: { licenseId: string; orgName: string; modules: string[]; seats: number; expiresAt: string | null; edition: string | null; updatesUntil: string | null };
      /** روز تا انقضا/پایان مهلت؛ null = دائمی و بدون تاریخ */
      daysLeft: number | null;
      warningLevel: 0 | 1 | 2 | 3;
      reasonCode: string;
      perpetual: boolean;
      installationId: string;
      integrity: string;
      clockRollback: boolean;
      /** 'legacy_v1' = توکن منسوخ v1 */
      deprecated?: 'legacy_v1';
    }
  | { mode: 'on_premise'; state: 'invalid' | 'expired'; reason: string; reasonCode: string; installationId?: string };

const REASONS: Record<string, string> = {
  not_configured: 'کد لایسنس یا کلید عمومی تنظیم نشده است',
  needs_activation: 'این نصب هنوز فعال‌سازی نشده است — اتصال اینترنت لازم است یا توکن آفلاین را از پشتیبانی بگیرید',
  license_expired: 'لایسنس منقضی شده و مهلت اضافه نیز به پایان رسیده است',
  offline_expired: 'مدت زیادی به سرور لایسنس متصل نشده‌اید و مهلت اضافه به پایان رسیده است',
  not_yet_valid: 'تاریخ سیستم با تاریخ لایسنس هم‌خوانی ندارد — ساعت سرور را بررسی کنید',
  clock_rollback: 'ساعت سیستم به‌طور غیرعادی به عقب برگشته است — برای ادامه یک‌بار باید به سرور لایسنس متصل شوید',
  installation_mismatch: 'این توکن برای نصب دیگری صادر شده است',
  fingerprint_mismatch: 'این نصب روی میزبان دیگری منتقل/کپی شده است — فعال‌سازی دوباره لازم است',
  updates_expired: 'حق به‌روزرسانی این لایسنس پیش از تاریخ انتشار این نسخه تمام شده است',
  revoked: 'لایسنس ابطال شده است',
  license_revoked: 'لایسنس ابطال شده است',
  license_suspended: 'لایسنس موقتاً معلق شده است',
  license_not_found: 'کلید لایسنس در سرور لایسنس یافت نشد',
  activation_limit_reached: 'سقف تعداد نصب‌های مجاز این لایسنس پر شده است',
  integrity: 'یکپارچگی نرم‌افزار تأیید نشد (کد دستکاری شده است)',
  invalid_token: 'توکن لایسنس نامعتبر است',
};

/**
 * مصرف‌کننده‌ی لایسنس در استقرار on-premise (و no-op در ابری).
 *
 * جریان: LICENSE_KEY = کلید LIC-... → فعال‌سازی آنلاین، دریافت توکن امضاشده‌ی Ed25519 مقید به installationId + اثرانگشت میزبان،
 * تمدید خودکار با check-in دوره‌ای؛ یا LICENSE_KEY/LICENSE_TOKEN = توکن آفلاین امضاشده. توکن‌های قدیمی v1 هم پشتیبانی می‌شوند.
 * آفلاین‌محور: قطع اینترنت قفل فوری نمی‌کند؛ هشدار پلکانی و مهلت (graceDays) و بعد قفل سخت. ساعت برگشته هیچ مزیتی نمی‌دهد.
 * حکم‌های امضاشده‌ی «ابطال/تعلیق» فوراً اعمال می‌شود.
 */
@Injectable()
export class LicenseRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LicenseRuntimeService');
  private status: LicenseStatus = { mode: 'cloud' };
  private ring: PublicKeyring = new Map();
  private store: InstallStateStore | null = null;
  private state: InstallState = newInstallState();
  private persistable = true;
  private offlineEnvToken: string | null = null;
  private legacyPayload: ActivationTokenPayload | null = null;
  private timers: NodeJS.Timeout[] = [];
  private lastPersist = 0;
  private cronsStopped = false;
  private readyPromise: Promise<void> = Promise.resolve();
  private lastRollback = false;
  private warnedInsecure = false;
  private warnedLegacy = false;
  private warnedNoBuildDate = false;

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly integrity: IntegrityService,
    @Optional() private readonly scheduler?: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (process.env.DEPLOYMENT_MODE !== 'ON_PREMISE') {
      this.status = { mode: 'cloud' };
      return;
    }
    this.init();
    void this.warnIfMultiTenant();
    const url = this.serverUrl();
    if (url && this.onlineKey()) {
      this.readyPromise = this.sync().catch(() => undefined);
      const every = Math.max(60_000, Number(process.env.LICENSE_CHECKIN_INTERVAL_MS) || DEFAULT_CHECKIN_MS);
      this.timers.push(setInterval(() => void this.sync(), every + Math.floor(Math.random() * 30_000)));
    }
    this.timers.push(setInterval(() => this.refresh(), 60_000));
    this.timers.forEach((t) => t.unref());
  }

  /** علامت اشتباه‌تنظیم: استقرار ابری چندتننتی که به‌اشتباه ON_PREMISE است (ماژول‌ها فقط طبق توکن مجازند). */
  private async warnIfMultiTenant(): Promise<void> {
    try {
      const n = await this.controlDb.tenant.count({ where: { status: 'ACTIVE' } });
      if (n > 1) {
        this.logger.error(`!!! DEPLOYMENT_MODE=ON_PREMISE ولی ${n} تننت فعال وجود دارد؛ این یک استقرار ابری چندتننتی است؟ اگر بله DEPLOYMENT_MODE=CLOUD بگذارید وگرنه ماژول‌های خارج از توکن لایسنس رد می‌شوند !!!`);
      }
    } catch {
      /* ignore */
    }
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearInterval);
  }

  /** بوت‌استرپ on-premise منتظر اولین تلاش فعال‌سازی می‌ماند (حداکثر ۲۰ ثانیه). */
  async ready(): Promise<void> {
    await Promise.race([this.readyPromise, new Promise<void>((r) => setTimeout(r, 20_000).unref())]);
    this.refresh();
  }

  // ── راه‌اندازی ───────────────────────────────────────────────────────

  private serverUrl(): string | null {
    const u = process.env.LICENSE_SERVER_URL || process.env.CONTROL_PLANE_CHECKIN_URL;
    if (!u) return null;
    if (/^http:\/\//i.test(u)) {
      if (process.env.LICENSE_ALLOW_INSECURE !== 'true') {
        if (!this.warnedInsecure) this.logger.error('LICENSE_SERVER_URL از http:// استفاده می‌کند و رد شد — از https:// استفاده کنید (فقط برای تست: LICENSE_ALLOW_INSECURE=true)');
        this.warnedInsecure = true;
        return null;
      }
      if (!this.warnedInsecure) this.logger.error('!!! LICENSE_ALLOW_INSECURE=true: ارتباط لایسنس بدون TLS است — فقط برای تست/شبکه‌ی بسته !!!');
      this.warnedInsecure = true;
    }
    return u.replace(/\/+$/, '');
  }

  private onlineKey(): string | null {
    const k = process.env.LICENSE_KEY?.trim();
    if (k?.startsWith('LIC-')) return k;
    const fromToken = this.bestOfflineToken();
    return fromToken?.licenseKey?.startsWith('LIC-') ? fromToken.licenseKey : null;
  }

  private stateDir(): string {
    if (process.env.LICENSE_STATE_DIR) return process.env.LICENSE_STATE_DIR;
    return existsSync('/app/data') ? '/app/data/license' : path.resolve(process.cwd(), 'data', 'license');
  }

  private init(): void {
    this.ring = loadPublicKeyringFromEnv();
    this.store = new InstallStateStore(this.stateDir());
    const loaded = this.store.load();
    if (loaded && 'state' in loaded) {
      this.state = loaded.state;
    } else {
      if (loaded && 'tampered' in loaded) this.logger.error('license state file failed its integrity check — treated as a NEW installation');
      this.state = newInstallState();
      this.persistable = this.store.save(this.state);
      if (!this.persistable) {
        this.state.installationId = derivedInstallationId(computeFingerprintComponents());
        this.logger.warn('license state dir is not writable — using a host-derived installation id; mount a persistent volume at /app/data');
      }
    }

    const raw = process.env.LICENSE_KEY?.trim();
    if (raw && !raw.startsWith('LIC-')) this.offlineEnvToken = raw;
    if (process.env.LICENSE_TOKEN?.trim()) this.offlineEnvToken = process.env.LICENSE_TOKEN.trim();
    this.refresh();
  }

  // ── انتخاب و ارزیابی توکن ────────────────────────────────────────────

  /** معتبرترین توکن آفلاین (v2 یا v1 legacy) از env. */
  private bestOfflineToken(): ActivationTokenPayload | null {
    if (!this.offlineEnvToken || this.ring.size === 0) return null;
    try {
      const raw = verifySignedPayload<{ kid?: string; v?: number }>(this.offlineEnvToken, this.ring);
      if (raw.v === 2) return verifyActivationToken(this.offlineEnvToken, this.ring);
      const l = raw as unknown as LicensePayload;
      if (!l.licenseId || !Array.isArray(l.modules)) return null;
      // توکن v1 منسوخ است (بدون اتصال به نصب/اثرانگشت): با LICENSE_ALLOW_LEGACY_V1=false رد می‌شود. حذف برنامه‌ریزی‌شده: 2027-03-31 (docs/licensing/README.md §۱۱)
      if (process.env.LICENSE_ALLOW_LEGACY_V1 === 'false') {
        this.logger.error('توکن v1 پذیرفته نمی‌شود (LICENSE_ALLOW_LEGACY_V1=false) — توکن v2 بگیرید');
        return null;
      }
      if (!this.warnedLegacy) this.logger.warn('DEPRECATED: توکن لایسنس v1 تا 2027-03-31 پشتیبانی می‌شود؛ برای توکن v2 با پشتیبانی تماس بگیرید');
      this.warnedLegacy = true;
      // v1: به قالب v2 تبدیل می‌شود (بدون گره به نصب/اثرانگشت؛ مهلت ۷ روزه‌ی قدیمی)
      return (this.legacyPayload = {
        v: 2, kid: '', jti: l.licenseId, licenseId: l.licenseId, licenseKey: '', orgName: l.orgName, product: 'exir-erp', edition: null,
        installationId: this.state.installationId, fp: null, modules: l.modules, maxUsers: l.seats,
        issuedAt: l.issuedAt, notBefore: l.issuedAt, expiresAt: l.expiresAt, updatesUntil: null, graceDays: LEGACY_GRACE_DAYS,
        tokenExpiresAt: l.expiresAt, nonce: null, serverTime: l.issuedAt, integrityPolicy: 'WARN', crlVersion: 0,
      });
    } catch {
      return null;
    }
  }

  private bestPayload(): ActivationTokenPayload | null {
    let stored: ActivationTokenPayload | null = null;
    if (this.state.token) {
      try {
        stored = verifyActivationToken(this.state.token, this.ring);
      } catch {
        stored = null;
      }
    }
    const offline = this.bestOfflineToken();
    if (stored && offline) return new Date(offline.issuedAt) > new Date(stored.issuedAt) ? offline : stored;
    return stored ?? offline;
  }

  private currentCrl(): Pick<CrlDocument, 'revoked' | 'revokedKids'> | null {
    if (!this.state.crl) return null;
    try {
      return verifySignedPayload<CrlDocument>(this.state.crl, this.ring);
    } catch {
      return null;
    }
  }

  /** وضعیت را از روی توکن و زمان فعلی دوباره محاسبه می‌کند (ارزان؛ هر دقیقه و پس از هر تغییر). */
  refresh(now: Date = new Date()): void {
    try {
      this.refreshUnsafe(now);
    } catch (err) {
      // هرگز کرش‌لوپ: خطای غیرمنتظره = قفل امن با دلیل، نه سقوط پروسه
      this.logger.error(`license refresh failed: ${(err as Error).message}`);
      this.status = { mode: 'on_premise', state: 'invalid', reason: REASONS.invalid_token, reasonCode: 'invalid_token', installationId: this.state.installationId };
    }
  }

  private refreshUnsafe(now: Date): void {
    if (process.env.DEPLOYMENT_MODE !== 'ON_PREMISE') return;
    const installationId = this.state.installationId;
    const lock = (code: string, state: 'invalid' | 'expired' = 'invalid'): void => {
      this.status = { mode: 'on_premise', state, reason: REASONS[code] ?? code, reasonCode: code, installationId };
      this.syncCrons();
    };

    if (this.ring.size === 0 || (!process.env.LICENSE_KEY && !this.state.token)) return lock('not_configured');
    const payload = this.bestPayload();
    if (!payload) {
      if (this.state.verdict) return lock(this.state.verdict.code);
      return lock(this.onlineKey() || process.env.LICENSE_KEY?.startsWith('LIC-') ? 'needs_activation' : 'invalid_token');
    }
    if (this.state.verdict) return lock(this.state.verdict.code);

    const isLegacy = payload === this.legacyPayload;
    const current = computeFingerprintComponents();
    let currentFp: string | null | undefined;
    if (!isLegacy && payload.fp) {
      const stored = this.state.activationFp;
      const ok = !!stored && fingerprintDigest(stored) === payload.fp && fingerprintMatches(stored, current);
      currentFp = ok ? payload.fp : 'x';
    }
    const lastSeen = [this.state.lastSeen, payload.serverTime].filter(Boolean).map((v) => new Date(v as string)).reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    // فقط تاریخ ساخت امضاشده‌ی مانیفست معتبر است (env قابل دست‌کاری مشتری است)
    const buildIso = this.integrity.getResult().builtAt;
    if (payload.product !== (process.env.LICENSE_PRODUCT ?? 'exir-erp')) return lock('invalid_token');
    if (payload.updatesUntil && !buildIso) {
      if (!this.warnedNoBuildDate) this.logger.warn('تاریخ ساخت امضاشده نامعلوم است (مانیفست یکپارچگی نیست) — قاعده‌ی updatesUntil قابل بررسی نیست');
      this.warnedNoBuildDate = true;
      if (payload.integrityPolicy === 'LOCK' && process.env.NODE_ENV === 'production') return lock('integrity');
    }
    const ev: TokenEvaluation = evaluateToken(payload, {
      now,
      lastSeen,
      installationId: isLegacy ? undefined : installationId,
      currentFp,
      buildDate: buildIso ? new Date(buildIso) : null,
      crl: this.currentCrl(),
    });
    this.lastRollback = ev.clockRollback;

    // سیاست یکپارچگی را فقط توکن امضاشده تعیین می‌کند (نه env مشتری)
    if (payload.integrityPolicy === 'LOCK' && this.integrity.isTampered()) return lock('integrity');

    // زمان مؤثر را ماندگار کن (حداکثر هر ۵ دقیقه)
    if (ev.effectiveNow.getTime() > (this.state.lastSeen ? new Date(this.state.lastSeen).getTime() : 0) && now.getTime() - this.lastPersist > 300_000) {
      this.state.lastSeen = ev.effectiveNow.toISOString();
      this.lastPersist = now.getTime();
      this.persist();
    }

    if (ev.state === 'locked') return lock(ev.reason, ev.reason === 'license_expired' || ev.reason === 'offline_expired' ? 'expired' : 'invalid');

    this.status = {
      mode: 'on_premise',
      state: ev.state,
      payload: {
        licenseId: payload.licenseId,
        orgName: payload.orgName,
        modules: payload.modules,
        seats: payload.maxUsers,
        expiresAt: payload.expiresAt,
        edition: payload.edition,
        updatesUntil: payload.updatesUntil,
      },
      daysLeft: ev.daysLeft,
      warningLevel: ev.warningLevel,
      reasonCode: ev.reason,
      perpetual: !payload.expiresAt,
      installationId,
      integrity: this.integrity.getResult().status,
      clockRollback: ev.clockRollback,
      ...(isLegacy ? { deprecated: 'legacy_v1' as const } : {}),
    };
    if (ev.state === 'grace') this.logger.warn(`license in grace (${ev.reason}), ${ev.daysLeft} day(s) left`);
    this.syncCrons();
  }

  /** نقطه‌ی کنترل مرکزی: با قفل شدن، همه‌ی cronهای ثبت‌شده متوقف و با رفع قفل دوباره شروع می‌شوند (وصله‌ی تک‌به‌تک cron‌ها بی‌اثر است). */
  private syncCrons(): void {
    if (!this.scheduler) return;
    const blocked = this.isBlocked();
    if (blocked === this.cronsStopped) return;
    try {
      for (const job of this.scheduler.getCronJobs().values()) {
        if (blocked) job.stop();
        else job.start();
      }
      this.cronsStopped = blocked;
      this.logger.warn(blocked ? 'license locked — scheduled jobs stopped' : 'license OK — scheduled jobs resumed');
    } catch (err) {
      this.logger.debug(`cron toggle skipped: ${(err as Error).message}`);
    }
  }

  private persist(): void {
    if (this.persistable && this.store) this.persistable = this.store.save(this.state);
  }

  // ── همگام‌سازی با سرور لایسنس ────────────────────────────────────────

  private async telemetry() {
    let users: number | undefined;
    try {
      users = await this.controlDb.tenantMembership.count();
    } catch {
      users = undefined;
    }
    const i = this.integrity.getResult();
    const p = this.bestPayload();
    return {
      appVersion: process.env.APP_VERSION ?? i.version ?? 'unknown',
      runtimeState: this.status.mode === 'on_premise' ? this.status.state : 'cloud',
      users,
      modules: p?.modules.length,
      clockRollback: this.lastRollback,
      tamper: { status: i.status, modified: i.modified.length, added: i.added.length, missing: i.missing.length },
    };
  }

  private async call(action: 'activate' | 'checkin', key: string, fp: string[]) {
    const url = this.serverUrl();
    if (!url) return null;
    const nonce = randomNonce();
    const identifier = this.state.installationId;
    const res = await fetch(`${url}/api/license-api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key, identifier, fingerprint: fp, nonce, ...(action === 'checkin' ? { telemetry: await this.telemetry() } : {}) }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    // سقف اندازه‌ی پاسخ (۶۴KB): سرور جعلی/مسموم نمی‌تواند حافظه را پر کند
    const declared = Number(res.headers?.get?.('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) throw new Error('response too large');
    const raw = await res.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new Error('response too large');
    const body = JSON.parse(raw) as Record<string, unknown>;
    // پاسخ فقط با امضای معتبر + پنجره‌ی زمانی + nonce و هویت همخوان پذیرفته می‌شود (ضد MITM/replay).
    const pub = this.ring.get(String(body.kid));
    const ts = Number(body.timestamp);
    if (
      !pub ||
      body.nonce !== nonce ||
      body.license_key !== key ||
      body.identifier !== identifier ||
      !Number.isFinite(ts) ||
      Math.abs(Date.now() / 1000 - ts) > RESPONSE_WINDOW_S ||
      !verifyString(
        responseSigningString({ success: body.success === true, code: String(body.code), license_key: key, identifier, timestamp: ts, nonce, kid: String(body.kid), crlHash: typeof body.crl === 'string' ? sha256Hex(body.crl) : '' }),
        String(body.signature),
        pub,
      )
    ) {
      this.logger.warn('license server response rejected (signature/nonce/window)');
      return null;
    }
    return { body, nonce };
  }

  async sync(): Promise<void> {
    const key = this.onlineKey();
    if (!key || !this.serverUrl() || this.ring.size === 0) return;
    try {
      let fp = computeFingerprintComponents();
      let haveToken = !!this.state.token && !!this.safeVerifyStored();
      let r = await this.call(haveToken ? 'checkin' : 'activate', key, fp);
      if (!r) return;
      let code = String(r.body.code);

      if (code === 'not_activated' || code === 'fingerprint_mismatch') {
        if (code === 'fingerprint_mismatch') {
          // نصب منتقل/کپی شده: شناسه‌ی جدید → فعال‌سازی تازه (ظرفیت مصرف می‌شود)
          this.logger.warn('fingerprint mismatch — re-activating as a new installation');
          this.state.installationId = `i-${randomNonce(16)}`;
          this.state.token = null;
          this.state.activationFp = null;
          fp = computeFingerprintComponents();
        }
        haveToken = false;
        r = await this.call('activate', key, fp);
        if (!r) return;
        code = String(r.body.code);
      }

      if (['valid', 'activated', 'already_activated'].includes(code) && typeof r.body.token === 'string') {
        const t = verifyActivationToken(r.body.token, this.ring);
        if (t.nonce !== r.nonce || t.installationId !== this.state.installationId) throw new LicenseCryptoError('token mismatch', 'bad_payload');
        this.state.token = r.body.token;
        this.state.tokenSavedAt = new Date().toISOString();
        this.state.verdict = null;
        if (!this.state.activationFp) this.state.activationFp = fp;
        const lastSeen = this.state.lastSeen ? new Date(this.state.lastSeen) : null;
        const serverTime = new Date(t.serverTime);
        if (!lastSeen || serverTime > lastSeen) this.state.lastSeen = t.serverTime;
        if (typeof r.body.crl === 'string') this.acceptCrl(r.body.crl);
        this.persist();
        void this.syncTenantModules(t.modules);
      } else if (['license_revoked', 'license_suspended', 'license_expired', 'license_not_found', 'activation_limit_reached'].includes(code)) {
        this.state.verdict = { code, at: new Date().toISOString() };
        this.persist();
        this.logger.error(`license server verdict: ${code}`);
      } else {
        this.logger.debug(`license sync: server answered ${code}`);
      }
      this.refresh();
    } catch (err) {
      // بدون اتصال/سرور در دسترس نیست: آخرین وضعیت محلی حفظ می‌شود؛ هرگز به‌خاطر قطع اینترنت قفل فوری نمی‌شود.
      this.logger.debug(`license sync skipped: ${(err as Error).message}`);
    }
    await this.legacyCheckIn();
  }

  /** ماژول‌های تازه‌لایسنس‌شده را برای تننت محلی نصب می‌کند (ردیف موجود/غیرفعال‌شده توسط مشتری دست نمی‌خورد). حذف مجوز را ModuleGuard اعمال می‌کند. */
  private async syncTenantModules(modules: string[]): Promise<void> {
    try {
      const tenant = await this.controlDb.tenant.findFirst({ select: { id: true } });
      if (!tenant) return;
      const defs = await this.controlDb.moduleDefinition.findMany({ where: { code: { in: modules } }, select: { id: true } });
      if (defs.length) {
        await this.controlDb.tenantModule.createMany({
          data: defs.map((m) => ({ tenantId: tenant.id, moduleId: m.id, status: 'INSTALLED' as const })),
          skipDuplicates: true,
        });
      }
    } catch (err) {
      this.logger.debug(`tenant module sync skipped: ${(err as Error).message}`);
    }
  }

  /** CRL فقط وقتی ذخیره می‌شود که امضا/شکل معتبر و نسخه‌اش کمتر از نسخه‌ی ذخیره‌شده نباشد (ضد rollback و سم‌پاشی). */
  private acceptCrl(token: string): void {
    try {
      const doc = verifySignedPayload<CrlDocument>(token, this.ring);
      const okShape =
        doc.v === 1 &&
        typeof doc.version === 'number' &&
        Array.isArray(doc.revoked) && doc.revoked.every((x) => typeof x === 'string') &&
        Array.isArray(doc.revokedKids) && doc.revokedKids.every((x) => typeof x === 'string') &&
        !!doc.kid && this.ring.has(doc.kid);
      if (!okShape) throw new Error('bad shape');
      const cur = this.currentCrl() as CrlDocument | null;
      if (cur && typeof cur.version === 'number' && doc.version < cur.version) throw new Error('older version');
      this.state.crl = token;
    } catch (err) {
      this.logger.warn(`CRL rejected: ${(err as Error).message}`);
    }
  }

  private safeVerifyStored(): ActivationTokenPayload | null {
    try {
      return this.state.token ? verifyActivationToken(this.state.token, this.ring) : null;
    } catch {
      return null;
    }
  }

  /** توکن‌های قدیمی v1 فقط با ‎/api/licenses/check-in‎ ابطال زودهنگام را تشخیص می‌دهند. */
  private async legacyCheckIn(): Promise<void> {
    const raw = this.offlineEnvToken;
    const url = this.serverUrl();
    if (!raw || !url || this.legacyPayload === null || this.bestPayload() !== this.legacyPayload) return;
    try {
      const res = await fetch(`${url}/api/licenses/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: raw }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { valid: boolean };
      if (!body.valid) {
        this.state.verdict = { code: 'license_revoked', at: new Date().toISOString() };
        this.persist();
        this.refresh();
      }
    } catch {
      /* آفلاین */
    }
  }

  // ── API برای بقیه‌ی سیستم ────────────────────────────────────────────

  getStatus(): LicenseStatus {
    return this.status;
  }

  isBlocked(): boolean {
    return this.status.mode === 'on_premise' && (this.status.state === 'invalid' || this.status.state === 'expired');
  }

  getInstallationId(): string | null {
    return this.status.mode === 'on_premise' ? this.state.installationId : null;
  }

  /** مجوز ماژول (سمت سرور): ابری همیشه true (ModuleGuard/TenantModule کنترل می‌کند). '*' = همه. */
  moduleAllowed(code: string): boolean {
    if (this.status.mode === 'cloud') return true;
    if (this.status.state === 'valid' || this.status.state === 'grace') {
      return this.status.payload.modules.includes(code) || this.status.payload.modules.includes('*');
    }
    return false;
  }

  licensedModules(): string[] | null {
    return this.status.mode === 'on_premise' && (this.status.state === 'valid' || this.status.state === 'grace') ? this.status.payload.modules : null;
  }

  licensedOrgName(): string | null {
    return this.status.mode === 'on_premise' && (this.status.state === 'valid' || this.status.state === 'grace') ? this.status.payload.orgName : null;
  }

  /** سقف کاربر لایسنس؛ مثلاً هنگام دعوت کاربر جدید. */
  assertUserCapacity(currentUsers: number): void {
    const st = this.status;
    if (st.mode !== 'on_premise' || (st.state !== 'valid' && st.state !== 'grace')) return;
    const max = st.payload.seats;
    if (max > 0 && currentUsers >= max) {
      throw new ForbiddenException(`سقف کاربران مجاز لایسنس (${max} کاربر) تکمیل است — برای افزایش با پشتیبانی تماس بگیرید.`);
    }
  }
}
