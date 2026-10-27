import type { JsonSchema } from './mcp-tool.types.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** شناسه‌ی رکورد (UUID یا شناسه‌ی متنی کوتاه) */
export const idProp = (description: string): JsonSchema => ({ type: 'string', minLength: 1, maxLength: 64, description });
export const isoProp = (description: string): JsonSchema => ({ type: 'string', format: 'date-time', maxLength: 40, description });
export const dateProp = (description: string): JsonSchema => ({ type: 'string', format: 'date', description });
export const limitProp = (max = 50): JsonSchema => ({ type: 'integer', minimum: 1, maximum: max, description: `حداکثر تعداد نتیجه (پیش‌فرض ${Math.min(20, max)})` });

export function clampLimit(v: unknown, def = 20, max = 50): number {
  const n = typeof v === 'number' ? Math.floor(v) : def;
  return Math.min(max, Math.max(1, n));
}

export const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export const clip = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s);

/** متن ساده‌ی ایجنت → HTML امن (هر بند یک <p>؛ همه‌ی نویسه‌های خاص escape می‌شوند). سرور هم دوباره sanitize می‌کند. */
export function htmlFromText(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** بدنه‌ی یک نوشته‌ی ایجنت همیشه برچسب می‌خورد تا بعداً مشخص باشد منشأ آن دستیار هوشمند بوده. */
export const AGENT_TAG = '[ثبت‌شده با دستیار هوشمند]';

export function toolError(message: string): never {
  throw new Error(message);
}
