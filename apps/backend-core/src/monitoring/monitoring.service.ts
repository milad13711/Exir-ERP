import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { BackupDrService } from '../backup-dr/backup-dr.service.js';
import { writeJsonAtomic } from '../backup-dr/backup-state.js';
import {
  applyResult,
  classifyDbLatency,
  classifyDisk,
  classifyErrorRate,
  classifyTls,
  classifyUrlStatus,
  emptyMonitorState,
  pushHistory,
  recordSent,
  resolveAlertPhone,
  sanitizeAlertText,
  shouldSend,
  type CheckResult,
  type MonitorState,
  type Notify,
} from './monitoring-logic.js';
import { HOST_RE, diskFreePct, httpStatus, tlsDaysLeft } from './monitoring-probes.js';

type CheckSpec = { key: string; label: string; failuresBeforeAlert: number; run: () => Promise<CheckResult> };

const HOST_HEARTBEAT_STALE_MIN = 30;

/**
 * پایش سلامت برنامه + کانال هشدار SMS به مالک پلتفرم.
 * وضعیت در فایل `_monitor.json` کنار `_status.json` بکاپ نگه‌داری می‌شود (بدون migration).
 * هشدارهای میزبان (host-watch) از طریق همین `notify` عبور می‌کنند تا dedupe و سقف روزانه یکسان باشد.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger('Monitoring');
  private running = false;
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly controlDb: ControlPrismaService,
    @Optional() private readonly sms?: ExirSmsService,
    @Optional() private readonly backups?: BackupDrService,
  ) {}

  // ── پیکربندی (lazy، برای تست و تغییر env) ──────────────────────────────
  protected get statePath(): string {
    return join(process.env.BACKUP_DIR ?? '/app/backups', '_monitor.json');
  }
  protected now(): Date {
    return new Date();
  }
  protected get maxSmsPerDay(): number {
    const n = Number(process.env.MONITOR_MAX_SMS_PER_DAY);
    return Number.isFinite(n) && n > 0 ? n : 12;
  }
  protected urls(): string[] {
    const raw = process.env.MONITOR_URLS || [process.env.WEB_PANEL_PUBLIC_URL, process.env.ADMIN_PANEL_PUBLIC_URL].filter(Boolean).join(',');
    return raw
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter((u) => /^https?:\/\/[^\s/]+/i.test(u));
  }
  protected tlsHosts(): string[] {
    const raw = process.env.MONITOR_TLS_HOSTS;
    const list = raw
      ? raw.split(',').map((s) => s.trim())
      : this.urls()
          .filter((u) => u.startsWith('https://'))
          .map((u) => new URL(u).hostname);
    return [...new Set(list.filter((h) => HOST_RE.test(h)))];
  }
  protected phone(): string | null {
    return resolveAlertPhone();
  }

  // ── وضعیت پایدار ───────────────────────────────────────────────────────
  async readState(): Promise<MonitorState> {
    try {
      const s = JSON.parse(await readFile(this.statePath, 'utf8')) as MonitorState;
      return s && s.version === 1 ? { ...emptyMonitorState(), ...s } : emptyMonitorState();
    } catch {
      return emptyMonitorState();
    }
  }
  private async patch<T>(fn: (s: MonitorState) => T): Promise<T> {
    const run = this.lock.then(async () => {
      const s = await this.readState();
      const out = fn(s);
      await writeJsonAtomic(this.statePath, s).catch((e) => this.logger.error(`monitor state write failed: ${e instanceof Error ? e.message : e}`));
      return out;
    });
    this.lock = run.then(() => {}, () => {});
    return run;
  }

  // ── چک‌ها ──────────────────────────────────────────────────────────────
  buildChecks(): CheckSpec[] {
    const specs: CheckSpec[] = [];
    for (const url of this.urls()) {
      specs.push({
        key: `url:${url}`,
        label: `پاسخ‌گویی ${url}`,
        failuresBeforeAlert: 2,
        run: async () => {
          const r = await httpStatus(url);
          const level = classifyUrlStatus(r.status);
          return { level, detail: r.status === null ? `بدون پاسخ (${r.error ?? 'timeout'})` : `HTTP ${r.status} در ${r.ms}ms`, metric: r.ms };
        },
      });
    }
    for (const host of this.tlsHosts()) {
      specs.push({
        key: `tls:${host}`,
        label: `گواهی TLS ${host}`,
        failuresBeforeAlert: 1,
        run: async () => {
          try {
            const days = await tlsDaysLeft(host);
            return { level: classifyTls(days), detail: `${days} روز تا انقضا`, metric: days };
          } catch (e) {
            // اتصال ناموفق را url-check پوشش می‌دهد؛ اینجا فقط «نامشخص» تا هشدار تکراری نشود
            return { level: 'unknown', detail: `بررسی ممکن نشد: ${e instanceof Error ? e.message : e}` };
          }
        },
      });
    }
    const diskCheck = (key: string, label: string, path: () => string): CheckSpec => ({
      key,
      label,
      failuresBeforeAlert: 1,
      run: async () => {
        try {
          const d = await diskFreePct(path());
          return { level: classifyDisk(d.freePct), detail: `${d.freePct.toFixed(1)}٪ آزاد`, metric: Math.round(d.freePct * 10) / 10 };
        } catch (e) {
          return { level: 'unknown', detail: `خواندن دیسک ممکن نشد: ${e instanceof Error ? e.message : e}` };
        }
      },
    });
    specs.push(diskCheck('disk:backups', 'دیسک بکاپ‌ها', () => process.env.BACKUP_DIR ?? '/app/backups'));
    specs.push(diskCheck('disk:app', 'دیسک برنامه', () => process.env.MONITOR_APP_DISK_PATH || '/app'));
    specs.push({
      key: 'db',
      label: 'دیتابیس کنترل',
      failuresBeforeAlert: 2,
      run: async () => {
        const t0 = Date.now();
        try {
          await this.controlDb.$queryRawUnsafe('SELECT 1');
          const ms = Date.now() - t0;
          return { level: classifyDbLatency(ms), detail: `پاسخ در ${ms}ms`, metric: ms };
        } catch (e) {
          return { level: 'crit', detail: `اتصال ناموفق: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
        }
      },
    });
    specs.push({
      key: 'errors',
      label: 'نرخ خطاهای برنامه',
      failuresBeforeAlert: 1,
      run: async () => {
        const now = this.now().getTime();
        // خطاهای خودِ پایش/بکاپ در شمارش نیستند (جلوگیری از حلقه‌ی بازخورد)
        const where = { level: { in: ['ERROR', 'FATAL'] as any }, service: { notIn: ['monitor', 'backup'] } };
        const [recent, day] = await Promise.all([
          this.controlDb.errorLog.count({ where: { ...where, createdAt: { gte: new Date(now - 10 * 60_000) } } }),
          this.controlDb.errorLog.count({ where: { ...where, createdAt: { gte: new Date(now - 24 * 3_600_000) } } }),
        ]);
        return { level: classifyErrorRate(recent, day), detail: `${recent} خطا در ۱۰ دقیقه‌ی اخیر (${day} در ۲۴ ساعت)`, metric: recent };
      },
    });
    specs.push({
      key: 'sms-wallet',
      label: 'اعتبار پنل پیامک',
      failuresBeforeAlert: 1,
      run: async () => this.walletCheck(),
    });
    specs.push({
      key: 'host-watch',
      label: 'ضربان host-watch (میزبان)',
      failuresBeforeAlert: 1,
      run: async () => {
        const s = await this.readState();
        if (!s.hostHeartbeatAt) return { level: 'unknown', detail: 'host-watch هنوز نصب/فعال نشده' };
        const age = Math.floor((this.now().getTime() - Date.parse(s.hostHeartbeatAt)) / 60_000);
        return age > HOST_HEARTBEAT_STALE_MIN
          ? { level: 'warn', detail: `${age} دقیقه است ضربان نیامده — host-watch متوقف شده؟`, metric: age }
          : { level: 'ok', detail: `آخرین ضربان ${age} دقیقه پیش`, metric: age };
      },
    });
    return specs;
  }

  private async walletCheck(): Promise<CheckResult> {
    const key = process.env.EXIR_SMS_API_KEY;
    if (!key || !this.sms) return { level: 'unknown', detail: 'پنل پیامک پیکربندی نشده' };
    const state = await this.readState();
    // API اعتبار را حداکثر ساعتی یک‌بار صدا می‌زنیم؛ بین اجراها آخرین نتیجه حفظ می‌شود
    const prev = state.checks['sms-wallet'];
    if (state.lastWalletCheckAt && prev && this.now().getTime() - Date.parse(state.lastWalletCheckAt) < 3_600_000) {
      return { level: prev.level, detail: prev.detail, metric: prev.metric };
    }
    const r = await this.sms.getCredit(key);
    await this.patch((s) => void (s.lastWalletCheckAt = this.now().toISOString()));
    if (!r.success) return { level: 'unknown', detail: `استعلام اعتبار ممکن نشد: ${r.error}` };
    const min = Number(process.env.MONITOR_SMS_MIN_COUNT) || 200;
    if (r.smsCount === null) return { level: 'ok', detail: `اعتبار ${r.creditRial ?? '؟'} ریال` };
    return r.smsCount < min
      ? { level: r.smsCount < min / 4 ? 'crit' : 'warn', detail: `حدود ${r.smsCount} پیامک باقی مانده`, metric: r.smsCount }
      : { level: 'ok', detail: `حدود ${r.smsCount} پیامک باقی مانده`, metric: r.smsCount };
  }

  // ── اجرای دوره‌ای ──────────────────────────────────────────────────────
  @Cron('*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (process.env.MONITOR_DISABLED === 'true') return;
    await this.runChecks().catch((e) => this.logger.error(`monitor run failed: ${e instanceof Error ? e.message : e}`));
  }

  async runChecks(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const specs = this.buildChecks();
      // ترتیبی و کم‌بار؛ هر چک ایزوله است تا خرابی یکی بقیه را نبرد
      const results: { spec: CheckSpec; result: CheckResult }[] = [];
      for (const spec of specs) {
        let result: CheckResult;
        try {
          result = await spec.run();
        } catch (e) {
          result = { level: 'unknown', detail: `خطای چک: ${e instanceof Error ? e.message : e}` };
        }
        results.push({ spec, result });
      }
      const nowIso = this.now().toISOString();
      const notifications: { spec: CheckSpec; result: CheckResult; notify: Notify }[] = [];
      await this.patch((s) => {
        const known = new Set(specs.map((x) => x.key));
        for (const k of Object.keys(s.checks)) if (!known.has(k)) delete s.checks[k];
        for (const { spec, result } of results) {
          const { next, notify } = applyResult(s.checks[spec.key], result, nowIso, spec.failuresBeforeAlert);
          s.checks[spec.key] = next;
          if (notify) notifications.push({ spec, result, notify });
        }
        pushHistory(s, nowIso);
      });
      for (const n of notifications) {
        if (n.notify!.type === 'alert') {
          const lvl = (n.notify as { level: string }).level;
          await this.notify(`${n.spec.key}:${lvl}`, `${n.spec.label}: ${n.result.detail}`, { source: 'checker' });
        } else {
          await this.notify(`${n.spec.key}:recovery`, `${n.spec.label}: ${n.result.detail}`, { source: 'checker', resolved: true });
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ── هشدار ──────────────────────────────────────────────────────────────
  /** یک هشدار در روز به‌ازای هر kind + سقف روزانه‌ی SMS. هرگز throw نمی‌کند. */
  async notify(
    kind: string,
    message: string,
    opts: { source: 'checker' | 'host' | 'test'; resolved?: boolean } = { source: 'checker' },
  ): Promise<{ sent: boolean; reason?: 'dedupe' | 'cap' | 'no-recipient' | 'sms-failed' }> {
    const text = sanitizeAlertText(message);
    const day = this.now().toISOString().slice(0, 10);
    const nowIso = this.now().toISOString();
    const decision = await this.patch((s) => {
      const d = shouldSend(s, day, kind, this.maxSmsPerDay);
      if (d.send) recordSent(s, day, kind, !!this.phone() && !!this.sms);
      return d;
    });
    if (!decision.send) return { sent: false, reason: decision.reason };
    const phone = this.phone();
    let delivered = false;
    let reason: 'no-recipient' | 'sms-failed' | undefined;
    if (!phone || !this.sms) {
      reason = 'no-recipient';
    } else {
      const body = opts.resolved ? `برطرف شد - پایش اکسیر: ${text}` : `هشدار پایش اکسیر: ${text}`;
      const res = await this.sms.sendSms(phone, body.slice(0, 300)).catch((e) => ({ success: false as const, error: String(e) }));
      delivered = res.success;
      if (!res.success) {
        reason = 'sms-failed';
        this.logger.warn(`monitor alert SMS failed: ${res.error}`);
      }
    }
    if (!opts.resolved && opts.source !== 'test') {
      await this.controlDb.errorLog
        .create({ data: { service: 'monitor', level: 'WARNING', message: `[monitor] ${text}`.slice(0, 1000), context: { kind, source: opts.source } } })
        .catch(() => {});
    }
    await this.patch((s) => {
      s.lastAlert = { at: nowIso, kind, message: text, delivered, reason };
      s.recent = [{ at: nowIso, kind, message: text, source: opts.source, delivered, reason }, ...(s.recent ?? [])].slice(0, 20);
    });
    return { sent: delivered, reason };
  }

  async recordHostHeartbeat(): Promise<void> {
    await this.patch((s) => void (s.hostHeartbeatAt = this.now().toISOString()));
  }

  async sendTestAlert(): Promise<{ sent: boolean; reason?: string }> {
    // هر دقیقه حداکثر یک تست (kind شامل دقیقه است)؛ سقف روزانه همچنان اعمال می‌شود
    const minute = Math.floor(this.now().getTime() / 60_000);
    return this.notify(`test:${minute}`, 'این یک هشدار آزمایشی از پنل ادمین است.', { source: 'test' });
  }

  // ── خروجی صفحه‌ی ادمین ─────────────────────────────────────────────────
  async getStatus() {
    const s = await this.readState();
    const phone = this.phone();
    const specs = this.buildChecks();
    const labels = new Map(specs.map((x) => [x.key, x.label]));
    const checks = Object.entries(s.checks).map(([key, c]) => ({
      key,
      label: labels.get(key) ?? key,
      level: c.level,
      detail: c.detail,
      metric: c.metric ?? null,
      since: c.since,
      lastCheckedAt: c.lastCheckedAt,
      consecutive: c.consecutive,
    }));
    let backup: { level: 'ok' | 'warn'; warnings: string[]; lastRestoreTest: unknown; restoreVerifiedStale: unknown } | null = null;
    if (this.backups) {
      try {
        const b = await this.backups.getStatus();
        backup = { level: b.warnings.length ? 'warn' : 'ok', warnings: b.warnings, lastRestoreTest: b.lastRestoreTest, restoreVerifiedStale: b.restoreVerification?.stale ?? [] };
      } catch {
        backup = null;
      }
    }
    return {
      generatedAt: this.now().toISOString(),
      config: {
        alertPhoneConfigured: !!phone,
        alertPhoneMasked: phone ? `${phone.slice(0, 4)}***${phone.slice(-2)}` : null,
        smsConfigured: !!this.sms?.isConfigured(),
        urls: this.urls(),
        tlsHosts: this.tlsHosts(),
        maxSmsPerDay: this.maxSmsPerDay,
        smsSentToday: s.smsToday?.day === this.now().toISOString().slice(0, 10) ? s.smsToday.count : 0,
        internalAlertEnabled: !!process.env.INTERNAL_ALERT_TOKEN,
      },
      checks,
      history: s.history.filter((h) => Date.parse(h.at) >= this.now().getTime() - 24 * 3_600_000),
      lastAlert: s.lastAlert ?? null,
      recent: s.recent ?? [],
      hostHeartbeatAt: s.hostHeartbeatAt ?? null,
      backup,
    };
  }
}
