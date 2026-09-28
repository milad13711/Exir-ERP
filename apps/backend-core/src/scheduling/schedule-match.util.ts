/**
 * Pure helpers behind the "زمان‌بندی ارسال خودکار" (automated send scheduling)
 * settings — no DB, no NestJS DI, easy to unit test in isolation. Every
 * schedulable cron sweep consults `matchesSchedule` once per tenant per run
 * to decide whether *today* is the tenant's configured day for a given
 * target date, and `isConfiguredHour` to decide whether *this run* of the
 * (hourly-or-finer) cron is the tenant's configured hour.
 */

export type ScheduleOffsetUnit = 'DAYS_BEFORE' | 'SAME_DAY' | 'DAYS_AFTER';

export type JobScheduleConfig = {
  offsetDays: number; // always >= 0 — sign comes from `unit`, not from this field
  unit: ScheduleOffsetUnit;
  hour: number; // 0-23, tenant's local (Asia/Tehran) hour
  minute: number; // 0-59 — kept for a future finer-grained cron; today's hourly sweeps only compare `hour`
};

/** Midnight-UTC-of-that-calendar-day marker for `date` as seen in `timeZone` — matches the pattern used by daily-checklist's todayTehran(). */
export function dateOnlyInTimeZone(date: Date, timeZone = 'Asia/Tehran'): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The current hour-of-day (0-23) in `timeZone`, for comparing against a tenant's configured `hour`. */
export function currentHourInTimeZone(now: Date, timeZone = 'Asia/Tehran'): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now));
}

/** Signed day offset the config represents: DAYS_BEFORE 3 → +3 (target is 3 days after now), DAYS_AFTER 3 → -3 (target is 3 days in the past, i.e. overdue), SAME_DAY → 0. */
export function signedOffsetDays(config: Pick<JobScheduleConfig, 'offsetDays' | 'unit'>): number {
  if (config.unit === 'SAME_DAY') return 0;
  return config.unit === 'DAYS_BEFORE' ? config.offsetDays : -config.offsetDays;
}

/**
 * Does `targetDate` sit exactly on the day the tenant's schedule points at,
 * counting from `now`? Both dates are truncated to their calendar day in
 * `timeZone` first, so time-of-day on either side never affects the count.
 */
export function matchesScheduleDay(now: Date, targetDate: Date, config: Pick<JobScheduleConfig, 'offsetDays' | 'unit'>, timeZone = 'Asia/Tehran'): boolean {
  const today = dateOnlyInTimeZone(now, timeZone).getTime();
  const target = dateOnlyInTimeZone(targetDate, timeZone).getTime();
  const daysFromToday = Math.round((target - today) / 86_400_000);
  return daysFromToday === signedOffsetDays(config);
}

/** Is `now` inside the tenant's configured hour, in `timeZone`? (Minute granularity is intentionally not enforced — see JobScheduleConfig.minute.) */
export function isConfiguredHour(now: Date, config: Pick<JobScheduleConfig, 'hour'>, timeZone = 'Asia/Tehran'): boolean {
  return currentHourInTimeZone(now, timeZone) === config.hour;
}

/** Combines both checks — the single entry point a cron sweep should call per tenant per candidate target date. */
export function matchesSchedule(now: Date, targetDate: Date, config: JobScheduleConfig, timeZone = 'Asia/Tehran'): boolean {
  return isConfiguredHour(now, config, timeZone) && matchesScheduleDay(now, targetDate, config, timeZone);
}
