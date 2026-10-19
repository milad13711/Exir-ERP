/**
 * منطق خالص پایش (بدون I/O) — تا با fake قابل‌آزمون باشد.
 * سطح هر چک: ok | warn | crit | unknown. «unknown» یعنی چک اجرا نشده/پیکربندی ندارد و هرگز هشدار نمی‌دهد.
 */
export type Level = 'ok' | 'warn' | 'crit' | 'unknown';

export type CheckResult = { level: Level; detail: string; metric?: number };

export type CheckState = {
  level: Level;
  detail: string;
  metric?: number;
  lastCheckedAt: string;
  /** تعداد اجراهای پیاپی با سطح غیر ok */
  consecutive: number;
  /** از چه زمانی در سطح فعلی است */
  since: string;
  /** آیا برای این وضعیت قبلاً هشدار «خرابی» لازم شده است (برای ارسال اعلان رفع) */
  alertOpen: boolean;
  /** آخرین سطحی که برایش هشدار صادر شد (برای هشدار ارتقا warn→crit) */
  alertedLevel?: Level;
};

export type HistoryPoint = { at: string; levels: Record<string, Level> };

export type MonitorState = {
  version: 1;
  checks: Record<string, CheckState>;
  history: HistoryPoint[];
  /** "YYYY-MM-DD:kind" -> true ؛ یک هشدار در روز به‌ازای هر kind */
  alertsSent: Record<string, true>;
  smsToday?: { day: string; count: number };
  lastAlert?: { at: string; kind: string; message: string; delivered: boolean; reason?: string };
  lastWalletCheckAt?: string;
  /** آخرین رویدادهای دریافت‌شده از host-watch و هشدارهای ارسالی (حداکثر ۲۰) */
  recent?: { at: string; kind: string; message: string; source: 'checker' | 'host' | 'test'; delivered: boolean; reason?: string }[];
  /** آخرین ضربان host-watch (dead-man switch) */
  hostHeartbeatAt?: string;
  /** پنجره‌ی نگه‌داری (deploy): هشدار SMS تا `until` خاموش است (ثبت در لاگ ادامه دارد) */
  maintenance?: { until: string; reason: string; setAt: string };
};

export const emptyMonitorState = (): MonitorState => ({ version: 1, checks: {}, history: [], alertsSent: {} });

export const HISTORY_MAX = 24 * 12 + 6; // 24 ساعت با گام ۵ دقیقه

// ── طبقه‌بندی‌ها ────────────────────────────────────────────────────────────
export function classifyDisk(freePct: number, warnPct = 15, critPct = 8): Level {
  if (!Number.isFinite(freePct)) return 'unknown';
  if (freePct < critPct) return 'crit';
  if (freePct < warnPct) return 'warn';
  return 'ok';
}

export function classifyTls(daysLeft: number, warnDays = 21, critDays = 7): Level {
  if (!Number.isFinite(daysLeft)) return 'unknown';
  if (daysLeft < critDays) return 'crit';
  if (daysLeft < warnDays) return 'warn';
  return 'ok';
}

export function classifyDbLatency(ms: number, warnMs = 500, critMs = 2000): Level {
  if (ms >= critMs) return 'crit';
  if (ms >= warnMs) return 'warn';
  return 'ok';
}

/**
 * نرخ خطا: `recent` = تعداد خطا در پنجره‌ی اخیر (۱۰ دقیقه)، `last24h` = تعداد کل ۲۴ ساعت گذشته.
 * جهش = از آستانه‌ی مطلق بیشتر، یا حداقل ۵ برابر میانگین پنجره‌های ۲۴ ساعت (و دست‌کم minSpike خطا).
 */
export function classifyErrorRate(recent: number, last24h: number, opts: { warn?: number; crit?: number; minSpike?: number; windowMin?: number } = {}): Level {
  const warn = opts.warn ?? 30;
  const crit = opts.crit ?? 100;
  const minSpike = opts.minSpike ?? 10;
  const windows = (24 * 60) / (opts.windowMin ?? 10);
  const baseline = Math.max(0, last24h - recent) / windows;
  if (recent >= crit) return 'crit';
  if (recent >= warn) return 'warn';
  if (recent >= minSpike && recent >= baseline * 5) return 'warn';
  return 'ok';
}

export function classifyUrlStatus(status: number | null): Level {
  return status !== null && status >= 200 && status < 400 ? 'ok' : 'crit';
}

// ── ماشین حالت هشدار ────────────────────────────────────────────────────────
export type Notify = { type: 'alert'; level: Level } | { type: 'recovery' } | null;

/**
 * نتیجه‌ی یک اجرا را روی وضعیت قبلی اعمال می‌کند و می‌گوید آیا باید اعلان رفت.
 *  - هشدار فقط وقتی که `consecutive >= failuresBeforeAlert`.
 *  - ارتقا (warn→crit) هشدار تازه دارد؛ تکرار همان سطح نه.
 *  - رفع (ok بعد از هشدار باز) یک اعلان «برطرف شد» می‌دهد.
 *  - unknown وضعیت قبلی را دست‌نخورده نگه می‌دارد (چک اجرا نشده = بی‌خبر، نه سالم).
 */
export function applyResult(prev: CheckState | undefined, r: CheckResult, nowIso: string, failuresBeforeAlert: number): { next: CheckState; notify: Notify } {
  if (r.level === 'unknown') {
    const base: CheckState = prev ?? { level: 'unknown', detail: r.detail, lastCheckedAt: nowIso, consecutive: 0, since: nowIso, alertOpen: false };
    return { next: { ...base, level: prev ? prev.level : 'unknown', detail: r.detail, lastCheckedAt: nowIso }, notify: null };
  }
  const sameLevel = prev && prev.level === r.level;
  const next: CheckState = {
    level: r.level,
    detail: r.detail,
    metric: r.metric,
    lastCheckedAt: nowIso,
    consecutive: r.level === 'ok' ? 0 : (prev && prev.level !== 'ok' && prev.level !== 'unknown' ? prev.consecutive : 0) + 1,
    since: sameLevel ? prev!.since : nowIso,
    alertOpen: prev?.alertOpen ?? false,
    alertedLevel: prev?.alertedLevel,
  };
  let notify: Notify = null;
  if (r.level === 'ok') {
    if (prev?.alertOpen) notify = { type: 'recovery' };
    next.alertOpen = false;
    next.alertedLevel = undefined;
  } else if (next.consecutive >= failuresBeforeAlert) {
    const escalated = next.alertedLevel === 'warn' && r.level === 'crit';
    if (!next.alertOpen || escalated) notify = { type: 'alert', level: r.level };
    next.alertOpen = true;
    next.alertedLevel = r.level;
  }
  return { next, notify };
}

/** سقف روزانه + dedupe «یک بار در روز به‌ازای هر kind» */
export function shouldSend(state: MonitorState, day: string, kind: string, maxPerDay: number): { send: boolean; reason?: 'dedupe' | 'cap' } {
  if (state.alertsSent[`${day}:${kind}`]) return { send: false, reason: 'dedupe' };
  const used = state.smsToday?.day === day ? state.smsToday.count : 0;
  if (used >= maxPerDay) return { send: false, reason: 'cap' };
  return { send: true };
}

export function recordSent(state: MonitorState, day: string, kind: string, sms: boolean): void {
  state.alertsSent[`${day}:${kind}`] = true;
  if (sms) state.smsToday = { day, count: (state.smsToday?.day === day ? state.smsToday.count : 0) + 1 };
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
  for (const k of Object.keys(state.alertsSent)) if (k.slice(0, 10) < cutoff) delete state.alertsSent[k];
}

export function pushHistory(state: MonitorState, nowIso: string): void {
  const levels: Record<string, Level> = {};
  for (const [k, c] of Object.entries(state.checks)) levels[k] = c.level;
  state.history.push({ at: nowIso, levels });
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX);
}

export function sanitizeAlertText(s: unknown, max = 300): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

export const KIND_RE = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,79}$/;

export function resolveAlertPhone(env: NodeJS.ProcessEnv = process.env): string | null {
  return (env.MONITOR_ALERT_PHONE || env.BACKUP_ALERT_PHONE || env.ON_PREM_OWNER_PHONE || '').trim() || null;
}

// ── حالت نگه‌داری / مهلت پس از بوت ──────────────────────────────────────────
export const MAINTENANCE_MAX_MIN = 120;
export const BOOT_GRACE_DEFAULT_MIN = 5;

/** minutes باید عدد صحیح 1..MAINTENANCE_MAX_MIN باشد؛ reason متن پاک‌سازی‌شده. null = ورودی نامعتبر. */
export function normalizeMaintenanceInput(minutes: unknown, reason: unknown): { minutes: number; reason: string } | null {
  const m = typeof minutes === 'number' ? minutes : typeof minutes === 'string' && minutes.trim() ? Number(minutes) : NaN;
  if (!Number.isInteger(m) || m < 1 || m > MAINTENANCE_MAX_MIN) return null;
  return { minutes: m, reason: sanitizeAlertText(reason, 120) || 'maintenance' };
}

export type Suppression = { kind: 'maintenance' | 'boot-grace'; until: string; reason: string } | null;

/**
 * آیا اکنون ارسال هشدار (SMS) باید خاموش باشد؟ پنجره‌ی نگه‌داری و مهلت بوت هر دو را بررسی می‌کند؛ دیرترین `until` برنده است.
 * توجه: این فقط هشدارهای داخلی برنامه را خاموش می‌کند؛ پایشگر بیرونی «سرور مرده» (EXTERNAL-UPTIME.md) مستقل از این است.
 */
export function activeSuppression(state: Pick<MonitorState, 'maintenance'>, bootGraceUntilMs: number, nowMs: number): Suppression {
  const cands: NonNullable<Suppression>[] = [];
  const m = state.maintenance;
  if (m && Date.parse(m.until) > nowMs) cands.push({ kind: 'maintenance', until: m.until, reason: m.reason });
  if (bootGraceUntilMs > nowMs) cands.push({ kind: 'boot-grace', until: new Date(bootGraceUntilMs).toISOString(), reason: 'backend restart grace' });
  if (!cands.length) return null;
  return cands.reduce((a, b) => (Date.parse(b.until) > Date.parse(a.until) ? b : a));
}

export function bootGraceMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MONITOR_BOOT_GRACE_MIN;
  if (raw === undefined || raw === '') return BOOT_GRACE_DEFAULT_MIN;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : BOOT_GRACE_DEFAULT_MIN;
}

/**
 * کدام هشدارها در نگه‌داری خاموش می‌شوند: همه‌ی چک‌های خودِ برنامه، و از host-watch فقط هشدارهای «دردسترس‌بودن» (5xx/کانتینر).
 * هشدارهای امنیتی میزبان (ورود SSH، fail2ban، …) و هر چیز دیگر هرگز خاموش نمی‌شوند.
 */
export const HOST_SUPPRESSIBLE_RE = /^host:(nginx-5xx|docker-unhealthy|docker-cli)$/;
export function isSuppressibleAlert(kind: string, source: 'checker' | 'host' | 'test'): boolean {
  if (source === 'checker') return true;
  if (source === 'host') return HOST_SUPPRESSIBLE_RE.test(kind);
  return false;
}
