/**
 * Grandfather-father-son retention. Pure functions: given backup dates (YYYY-MM-DD),
 * return the set to KEEP. Used identically for local files and the off-site bucket.
 *
 *  - daily   : the newest N dates
 *  - weekly  : per ISO week (Mon-Sun) the LAST backup of that week (the Sunday when it
 *              exists); newest M completed weeks.
 *  - monthly : per calendar month the FIRST backup of that month (the 1st when it
 *              exists); newest K months.
 *  - the single newest backup is always kept, whatever the policy says.
 */
export type RetentionPolicy = { daily: number; weekly: number; monthly: number };

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 6 };

export const BACKUP_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.(json|sql\.gz|sql\.gz\.enc)$/;

function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : fallback;
}

export function retentionFromEnv(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  const p = {
    daily: intEnv(env.BACKUP_KEEP_DAILY, DEFAULT_RETENTION.daily),
    weekly: intEnv(env.BACKUP_KEEP_WEEKLY, DEFAULT_RETENTION.weekly),
    monthly: intEnv(env.BACKUP_KEEP_MONTHLY, DEFAULT_RETENTION.monthly),
  };
  if (p.daily < 1) p.daily = 1; // never configure away the most recent backups
  return p;
}

/** Key of the ISO week a date belongs to: the date of its Monday. */
function isoWeekKey(date: string): string {
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function selectKeepDates(dates: string[], policy: RetentionPolicy): Set<string> {
  const sorted = [...new Set(dates)].sort(); // ascending
  const keep = new Set<string>();
  if (sorted.length === 0) return keep;
  const desc = [...sorted].reverse();

  keep.add(desc[0]);
  for (const d of desc.slice(0, policy.daily)) keep.add(d);

  const lastOfWeek = new Map<string, string>();
  for (const d of sorted) lastOfWeek.set(isoWeekKey(d), d); // ascending => last wins
  // The still-running week (its newest backup is not a Sunday) is covered by the daily set
  // and must not consume a weekly slot.
  const weeks = [...lastOfWeek.keys()].sort().reverse();
  if (weeks.length && new Date(`${lastOfWeek.get(weeks[0])}T00:00:00Z`).getUTCDay() !== 0) weeks.shift();
  for (const wk of weeks.slice(0, policy.weekly)) keep.add(lastOfWeek.get(wk)!);

  const firstOfMonth = new Map<string, string>();
  for (const d of sorted) if (!firstOfMonth.has(d.slice(0, 7))) firstOfMonth.set(d.slice(0, 7), d);
  for (const mk of [...firstOfMonth.keys()].sort().reverse().slice(0, policy.monthly)) keep.add(firstOfMonth.get(mk)!);

  return keep;
}

/** Dates that retention allows deleting. */
export function selectDeleteDates(dates: string[], policy: RetentionPolicy): string[] {
  const keep = selectKeepDates(dates, policy);
  return [...new Set(dates)].filter((d) => !keep.has(d)).sort();
}

/** Upper bound of files kept per database under a policy (overlaps make the real number lower). */
export function maxFilesKept(p: RetentionPolicy): number {
  return p.daily + p.weekly + p.monthly;
}
