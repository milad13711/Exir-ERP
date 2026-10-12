export const DEFAULT_TASK_PREFIX = 'TASK';

/** پیشوند فقط حروف/ارقام لاتین، حداکثر ۱۰ نویسه؛ مقدار نامعتبر → پیش‌فرض. */
export function sanitizeTaskPrefix(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_TASK_PREFIX;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return cleaned || DEFAULT_TASK_PREFIX;
}

/** TASK-000125 — شماره از توالیِ اتمیکِ دیتابیس (tasks_number_seq) می‌آید و پیشوند فقط در نمایش اعمال می‌شود. */
export function formatTaskCode(prefix: string, number: number): string {
  return `${sanitizeTaskPrefix(prefix)}-${String(number).padStart(6, '0')}`;
}

/** برای جستجو: «TASK-000125» یا «125» یا «000125» → عدد؛ در غیر این صورت null. */
export function parseTaskNumber(query: string): number | null {
  const m = /^(?:[A-Za-z0-9]{1,10}-)?0*(\d{1,9})$/.exec(query.trim());
  return m ? Number(m[1]) : null;
}
