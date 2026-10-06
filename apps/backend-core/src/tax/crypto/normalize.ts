import { ARRAY_INDEX_KEY_PREFIX } from '../mapping/moodian-field-map.js';

/**
 * نرمال‌سازی JSON برای امضا — سند RC_TICS.IS_V01 بخش ۶-۲-۱ و کد مرجع جاوا/دات‌نت (پیوست ۱-۱ و ۱-۲).
 *
 * قاعده‌ی نوشتاری: ۱) تخت‌کردن با کلید نقطه‌دار ۲) مرتب‌سازی کلیدها ۳) ادغام مقدارها با «#»؛
 * «#» داخل متن → «##»؛ مقدار null یا "" → «###».
 *
 * ابهام سند و تصمیم (NEEDS-SANDBOX-VERIFICATION):
 *  - «###» در متن سند در واقع نتیجه‌ی ادغام است نه توکن: کد مرجع برای مقدار null/"" یک «#» می‌نویسد
 *    و بعد از هر مقدار (از جمله null) جداکننده‌ی «#» می‌گذارد و جداکننده‌ی آخر را حذف می‌کند.
 *    پس v1، null، v2 ← «v1###v2». این رفتار با رشته‌ی نمونه‌ی بدنه‌ی سند (بخش ۶-۲-۲) سازگار است
 *    (تست واحد همین قطعه را تطبیق می‌دهد) و پیاده‌سازی ما از کد مرجع پیروی می‌کند، نه از جمله‌ی «###».
 *  - در نمونه‌ی کامل سند چند مقدار «0.0» و یک «null» متنی آمده که با JSON همان بخش نمی‌خواند؛
 *    قالب‌بندی اعداد اعشاری سمت سرور (Double در جاوا) ممکن است «0.0» بنویسد. اینجا قالب JS (0 → "0").
 *  - کلید عناصر آرایه: ARRAY_INDEX_KEY_PREFIX (جاوا «E0», دات‌نت «0»).
 *  - مرتب‌سازی: ordinal. (جاوا Collator؛ برای بیش از ۱۰ ردیف بدنه ممکن است ترتیب 10/2 فرق کند.)
 *  - بولین به‌صورت true/false (حروف کوچک).
 */

type Json = unknown;

function keyFor(root: string | null, key: string): string {
  return root === null ? key : `${root}.${key}`;
}

function flatten(out: Map<string, Json>, root: string | null, input: Json): void {
  if (Array.isArray(input)) {
    input.forEach((el, i) => flatten(out, keyFor(root, `${ARRAY_INDEX_KEY_PREFIX}${i}`), el));
  } else if (input !== null && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, Json>)) flatten(out, keyFor(root, k), v);
  } else {
    out.set(root ?? '', input);
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function valueToText(v: Json): string {
  if (v === null || v === undefined) return '#';
  const text = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (text === '') return '#';
  return text.replace(/#/g, '##');
}

/**
 * @param object بدنه (آبجکت یا آرایه؛ ریشه‌ی آرایه در فیلد packets قرار می‌گیرد)
 * @param header سرآیندهایی که با بدنه ادغام می‌شوند (کلیدهای سرآیند روی کلیدهای هم‌نام بدنه می‌نشینند)
 */
export function normalizeJson(object: Json, header?: Record<string, string | number | boolean | null> | null): string {
  let root: Record<string, Json> | null = null;
  if (object !== null && object !== undefined) {
    const parsed = typeof object === 'string' ? (JSON.parse(object) as Json) : object;
    root = Array.isArray(parsed) ? { packets: parsed } : { ...(parsed as Record<string, Json>) };
  }
  if (header) root = { ...(root ?? {}), ...header };
  if (!root) throw new Error('normalizeJson: both body and header are empty');
  const flat = new Map<string, Json>();
  flatten(flat, null, root);
  const keys = [...flat.keys()].sort(compareKeys);
  if (keys.length === 0) return '';
  return keys.map((k) => valueToText(flat.get(k))).join('#');
}
