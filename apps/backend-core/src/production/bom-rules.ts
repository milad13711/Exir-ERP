/**
 * قوانین خالص فرمول تولید (بدون Prisma) تا بدون دیتابیس قابل‌آزمون باشند.
 */

export type BomLineInput = { rawMaterialProductId: string; quantityPerBatch: number };

/** اعتبارسنجی خطوط: حداقل یک خط، مقدار صحیح مثبت، بدون ماده‌ی تکراری، بدون خودارجاعی. خطا ⇒ متن فارسی؛ سالم ⇒ null. */
export function validateBomLines(outputProductId: string, batchOutputQty: number, lines: BomLineInput[]): string | null {
  if (!Number.isInteger(batchOutputQty) || batchOutputQty <= 0) return 'مقدار پایه‌ی هر بچ باید عددی بزرگ‌تر از صفر باشد';
  if (lines.length === 0) return 'فرمول باید حداقل یک ماده‌ی اولیه داشته باشد';
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantityPerBatch) || l.quantityPerBatch <= 0) return 'مقدار مصرف هر ماده‌ی اولیه باید عددی بزرگ‌تر از صفر باشد';
    if (l.rawMaterialProductId === outputProductId) return 'محصول نهایی نمی‌تواند ماده اولیه‌ی فرمول خودش باشد';
    if (seen.has(l.rawMaterialProductId)) return 'یک ماده‌ی اولیه بیش از یک بار در فرمول آمده است؛ مقدارها را در یک ردیف جمع کنید';
    seen.add(l.rawMaterialProductId);
  }
  return null;
}

/**
 * وابستگی چرخه‌ای (نیمه‌ساخته‌ها): اگر یکی از اجزای فرمول (مستقیم یا از طریق فرمول فعال خودش) به همان محصول نهایی برسد
 * چرخه است. `activeComponents` نگاشت «محصول نهایی ← مواد اولیه‌ی فرمول فعالش» است (فرمول در حال ویرایش باید از آن حذف شده باشد).
 * خروجی: مسیر چرخه (شناسه‌ها) یا null.
 */
export function findBomCycle(
  outputProductId: string,
  componentIds: string[],
  activeComponents: Map<string, string[]>,
): string[] | null {
  const visiting = new Set<string>();
  const dfs = (productId: string, path: string[]): string[] | null => {
    if (productId === outputProductId) return [...path, productId];
    if (visiting.has(productId)) return null;
    visiting.add(productId);
    for (const next of activeComponents.get(productId) ?? []) {
      const hit = dfs(next, [...path, productId]);
      if (hit) return hit;
    }
    return null;
  };
  for (const c of componentIds) {
    const hit = dfs(c, [outputProductId]);
    if (hit) return hit;
  }
  return null;
}

/** نام‌ها برای یکتایی: trim + فاصله‌های تکراری + یکسان‌سازی ی/ک عربی + حروف کوچک. */
export function normalizeName(name: string): string {
  return name
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** آیا ویرایش پیشنهادی روی محتوای هزینه‌ساز فرمول (مقدار پایه/خطوط) اثر دارد؟ فقط توضیحات ⇒ false. */
export function bomContentChanged(
  current: { batchOutputQty: number; lines: BomLineInput[] },
  next: { batchOutputQty: number; lines: BomLineInput[] },
): boolean {
  if (current.batchOutputQty !== next.batchOutputQty) return true;
  if (current.lines.length !== next.lines.length) return true;
  const map = new Map(current.lines.map((l) => [l.rawMaterialProductId, l.quantityPerBatch]));
  return next.lines.some((l) => map.get(l.rawMaterialProductId) !== l.quantityPerBatch);
}
