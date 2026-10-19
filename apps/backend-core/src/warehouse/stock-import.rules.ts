/**
 * منطق خالصِ اعتبارسنجی «ورود موجودی اولیه از اکسل» — بدون پایگاه داده تا تست‌پذیر باشد.
 * سرویس (stock-import.service.ts) داده‌های مرجع را می‌خواند، این‌جا ردیف‌ها بررسی و طرح (plan) ساخته می‌شود.
 */

export const STOCK_IMPORT_HEADERS = ['کد کالا', 'نام کالا', 'انبار', 'تعداد', 'بهای واحد (تومان)', 'واحد', 'شماره لات/بچ', 'محل قفسه'] as const;
export const STOCK_IMPORT_MAX_ROWS = 5000;

const DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** عدد از سلول اکسل: ارقام فارسی/عربی، جداکننده‌ی هزارگان و «٫» پذیرفته می‌شود. null = خالی، NaN = نامعتبر. */
export function parseCellNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const t = String(v).trim();
  if (t === '') return null;
  const latin = t.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d] ?? d).replace(/[,،٬\s]/g, '').replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(latin)) return Number.NaN;
  return Number(latin);
}

const norm = (s: unknown) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();

export type RefProduct = { id: string; sku: string; name: string; unit: string; costPrice: number };
export type RefWarehouse = { id: string; name: string; isDefault: boolean };

export type PlanRow = {
  row: number;
  status: 'OK' | 'ERROR';
  messages: string[];
  warnings: string[];
  sku: string;
  name: string;
  warehouseId: string | null;
  warehouseName: string;
  quantity: number;
  unitCost: number | null;
  unit: string;
  lot: string;
  location: string;
  productId: string | null;
  createsProduct: boolean;
};

export type ImportPlan = {
  rows: PlanRow[];
  okCount: number;
  errorCount: number;
  newProducts: number;
  totalQuantity: number;
  totalValue: number;
  tooManyRows: boolean;
};

export function planOpeningStockImport(
  rawRows: Array<Record<string, string | number | null>>,
  ref: {
    products: RefProduct[];
    warehouses: RefWarehouse[];
    createMissing: boolean;
    /** کلید «productId|warehouseId» برای کالایی که همین الان در آن انبار حرکت دارد. */
    existingStockKeys?: Set<string>;
  },
): ImportPlan {
  const bySku = new Map(ref.products.map((p) => [norm(p.sku), p]));
  const nameCount = new Map<string, number>();
  for (const p of ref.products) nameCount.set(norm(p.name), (nameCount.get(norm(p.name)) ?? 0) + 1);
  const byName = new Map(ref.products.map((p) => [norm(p.name), p]));
  const whByName = new Map(ref.warehouses.map((w) => [norm(w.name), w]));
  const defaultWh = ref.warehouses.find((w) => w.isDefault) ?? ref.warehouses[0] ?? null;

  const seen = new Map<string, number>(); // کلید یکتای ردیف → شماره‌ی ردیف اول
  const rows: PlanRow[] = [];

  const tooManyRows = rawRows.length > STOCK_IMPORT_MAX_ROWS;
  const work = tooManyRows ? rawRows.slice(0, STOCK_IMPORT_MAX_ROWS) : rawRows;

  work.forEach((raw, i) => {
    const rowNo = i + 2; // ردیف ۱ عنوان ستون‌هاست
    const messages: string[] = [];
    const warnings: string[] = [];
    const sku = String(raw['کد کالا'] ?? '').trim();
    const name = String(raw['نام کالا'] ?? '').trim();
    const whName = String(raw['انبار'] ?? '').trim();
    const unit = String(raw['واحد'] ?? '').trim();
    const lot = String(raw['شماره لات/بچ'] ?? '').trim();
    const location = String(raw['محل قفسه'] ?? '').trim();

    // ── کالا ──
    let product: RefProduct | null = null;
    if (!sku && !name) {
      messages.push('کد کالا یا نام کالا باید پر باشد');
    } else {
      if (sku) product = bySku.get(norm(sku)) ?? null;
      if (!product && name) {
        if ((nameCount.get(norm(name)) ?? 0) > 1) messages.push(`چند کالا با نام «${name}» وجود دارد؛ کد کالا را وارد کنید`);
        else product = byName.get(norm(name)) ?? null;
      }
      if (!product && messages.length === 0) {
        if (!ref.createMissing) {
          messages.push(`کالا یافت نشد (${sku || name}) — گزینه‌ی «ساخت کالاهای ناموجود» را فعال کنید یا ابتدا کالا را تعریف کنید`);
        } else if (!name) {
          messages.push('برای ساخت کالای جدید، نام کالا الزامی است');
        }
      }
      if (product && unit && norm(unit) !== norm(product.unit)) {
        messages.push(`واحد «${unit}» با واحد کالا («${product.unit}») مطابقت ندارد`);
      }
    }

    // ── انبار ──
    let warehouse: RefWarehouse | null = null;
    if (!whName) {
      warehouse = defaultWh;
      if (!warehouse) messages.push('انباری تعریف نشده است');
    } else {
      warehouse = whByName.get(norm(whName)) ?? null;
      if (!warehouse) messages.push(`انبار «${whName}» یافت نشد`);
    }

    // ── مقدار و بها ──
    const qty = parseCellNumber(raw['تعداد']);
    let quantity = 0;
    if (qty === null) messages.push('تعداد خالی است');
    else if (Number.isNaN(qty)) messages.push('تعداد عدد معتبر نیست');
    else if (qty < 0) messages.push('تعداد منفی است');
    else if (qty === 0) messages.push('تعداد صفر است');
    else if (!Number.isInteger(qty)) messages.push('تعداد باید عدد صحیح باشد');
    else quantity = qty;

    const cost = parseCellNumber(raw['بهای واحد (تومان)']);
    let unitCost: number | null = null;
    if (cost === null) {
      unitCost = product && product.costPrice > 0 ? product.costPrice : null;
      warnings.push(unitCost ? 'بهای واحد خالی بود؛ از بهای فعلی کالا استفاده شد' : 'بهای واحد ندارد — ارزش موجودی صفر ثبت می‌شود');
    } else if (Number.isNaN(cost)) messages.push('بهای واحد عدد معتبر نیست');
    else if (cost < 0) messages.push('بهای واحد منفی است');
    else if (!Number.isInteger(cost)) messages.push('بهای واحد باید عدد صحیح (تومان) باشد');
    else unitCost = cost;

    // ── تکراری بودن ──
    const identity = product ? product.id : `new:${norm(sku) || norm(name)}`;
    const key = `${identity}|${warehouse?.id ?? ''}|${norm(lot)}`;
    const first = seen.get(key);
    if (first !== undefined) messages.push(`ردیف تکراری (همان کالا، انبار و لات در ردیف ${first})`);
    else seen.set(key, rowNo);

    if (product && warehouse && ref.existingStockKeys?.has(`${product.id}|${warehouse.id}`)) {
      warnings.push('این کالا در این انبار از قبل حرکت/موجودی دارد؛ مقدار به موجودی فعلی افزوده می‌شود');
    }

    const createsProduct = !product && ref.createMissing && messages.length === 0;

    rows.push({
      row: rowNo,
      status: messages.length ? 'ERROR' : 'OK',
      messages,
      warnings,
      sku,
      name: name || product?.name || '',
      warehouseId: warehouse?.id ?? null,
      warehouseName: warehouse?.name ?? whName,
      quantity,
      unitCost,
      unit: unit || product?.unit || 'عدد',
      lot,
      location,
      productId: product?.id ?? null,
      createsProduct,
    });
  });

  const ok = rows.filter((r) => r.status === 'OK');
  // شمار کالاهای جدید = تعداد کلیدهای یکتا (یک کالا ممکن است در چند انبار بیاید)
  const newProductKeys = new Set(ok.filter((r) => r.createsProduct).map((r) => norm(r.sku) || norm(r.name)));
  return {
    rows,
    okCount: ok.length,
    errorCount: rows.length - ok.length,
    newProducts: newProductKeys.size,
    totalQuantity: ok.reduce((s, r) => s + r.quantity, 0),
    totalValue: ok.reduce((s, r) => s + r.quantity * (r.unitCost ?? 0), 0),
    tooManyRows,
  };
}
