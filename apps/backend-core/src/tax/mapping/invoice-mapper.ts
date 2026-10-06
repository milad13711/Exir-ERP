import {
  BODY_KEYS,
  BUYER_TYPE,
  HEADER_KEYS,
  INVOICE_SUBJECT_CODE,
  INVOICE_TYPE,
  PATTERNS,
  SETTLEMENT,
  SUBJECTS_REQUIRING_REFERENCE,
  SUPPORTED_PATTERNS,
  TOMAN_TO_RIAL,
  vatRateToWire,
  type TaxSubjectKey,
} from './moodian-field-map.js';
import { checkManualTaxId } from '../taxid/taxid.js';

/** نگاشت فاکتور فروش اکسیر → JSON صورتحساب مودیان (جدول ۷) + گزارش نواقص. تابع خالص؛ بدون DB و شبکه. */

export type IssueSeverity = 'BLOCKING' | 'WARNING';
export type TaxIssue = { code: string; severity: IssueSeverity; message: string; field?: string; lineIndex?: number };

export type MapperSettings = {
  economicCode: string | null;
  fiscalId: string | null;
  branchCode: string | null;
  defaultVatRate: number | null;
  defaultSstid: string | null;
  defaultUnitCode: number | null;
};

export type MapperLine = { productId: string | null; description: string; quantity: number; unitPrice: number; lineTotal: number };

export type MapperInvoice = {
  invoiceNo: number;
  officialInvoiceNo: number | null;
  isOfficial: boolean;
  status: string;
  issuedAt: Date;
  subtotal: number;
  discount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  paidAmount: number;
  signedAt: Date | null;
  lines: MapperLine[];
  contact: { type: 'INDIVIDUAL' | 'COMPANY'; name: string; economicCode: string | null; nationalId: string | null; legalId: string | null };
};

export type TaxOverrides = {
  buyerPostalCode?: string;
  buyerEconomicCode?: string;
  buyerId?: string;
  buyerType?: number;
  invoiceType?: number;
  branchCode?: string;
  buyerBranchCode?: string;
};

export type MapperTaxInvoice = {
  subject: TaxSubjectKey;
  pattern: number;
  taxid: string | null;
  irtaxid: string | null;
  createdAt: Date;
  overrides: TaxOverrides | null;
};

export type ProductMapping = { sstid: string; unitCode: number; vatRate: number | null };

export type MapperInput = {
  settings: MapperSettings;
  invoice: MapperInvoice;
  taxInvoice: MapperTaxInvoice;
  mappings: Map<string, ProductMapping>;
  now?: Date;
};

export type MoodianInvoice = {
  header: Record<(typeof HEADER_KEYS)[number], string | number | null>;
  body: Array<Record<(typeof BODY_KEYS)[number], string | number | null>>;
  payments: Array<Record<string, string | number | null>>;
};

export type MapResult = {
  payload: MoodianInvoice;
  issues: TaxIssue[];
  /** نتیجه‌ی تصمیم‌های نگاشت که روی ردیف TaxInvoice ذخیره می‌شود. */
  resolved: { invoiceType: number; pattern: number; inno: string | null; taxid: string | null };
  blocking: boolean;
};

const blocking = (code: string, message: string, extra: Partial<TaxIssue> = {}): TaxIssue => ({ code, severity: 'BLOCKING', message, ...extra });
const warning = (code: string, message: string, extra: Partial<TaxIssue> = {}): TaxIssue => ({ code, severity: 'WARNING', message, ...extra });

export const toRial = (toman: number): number => Math.round(toman * TOMAN_TO_RIAL);

/** تقسیم عدد صحیح total بین وزن‌ها با روش بزرگ‌ترین باقی‌مانده؛ جمع خروجی دقیقاً total است. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i]! += 1;
    rest -= 1;
  }
  return floors;
}

const emptyHeader = () => Object.fromEntries(HEADER_KEYS.map((k) => [k, null])) as MoodianInvoice['header'];
const emptyBody = () => Object.fromEntries(BODY_KEYS.map((k) => [k, null])) as MoodianInvoice['body'][number];

export function mapSalesInvoiceToMoodian(input: MapperInput): MapResult {
  const { settings, invoice, taxInvoice, mappings } = input;
  const now = input.now ?? new Date();
  const issues: TaxIssue[] = [];
  const o = taxInvoice.overrides ?? {};

  // ── شرایط فاکتور فروش ──
  if (!invoice.isOfficial) issues.push(blocking('INVOICE_NOT_OFFICIAL', 'این فاکتور «رسمی» نیست؛ فقط فاکتور رسمی به مودیان ارسال می‌شود', { field: 'isOfficial' }));
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
    issues.push(blocking('INVOICE_STATUS', 'فاکتور باید تأیید شده و باطل نشده باشد', { field: 'status' }));
  }
  if (invoice.isOfficial && invoice.officialInvoiceNo === null) {
    issues.push(blocking('OFFICIAL_NO_MISSING', 'شماره‌ی فاکتور رسمی ثبت نشده است', { field: 'officialInvoiceNo' }));
  }
  if (invoice.isOfficial && !invoice.signedAt) {
    issues.push(warning('NOT_SIGNED', 'فاکتور رسمی هنوز امضا/مهر مدیر را نگرفته است', { field: 'signedAt' }));
  }
  if (invoice.lines.length === 0) issues.push(blocking('NO_LINES', 'فاکتور هیچ ردیفی ندارد', { field: 'lines' }));
  if (invoice.issuedAt.getTime() > now.getTime() + 60_000) issues.push(blocking('FUTURE_DATE', 'تاریخ صدور فاکتور در آینده است (خطای ۴۲ سامانه)', { field: 'issuedAt' }));
  if (!SUPPORTED_PATTERNS.includes(taxInvoice.pattern)) issues.push(blocking('PATTERN_UNSUPPORTED', `الگوی صورتحساب ${taxInvoice.pattern} هنوز پشتیبانی نمی‌شود (فقط الگوی ۱: فروش)`, { field: 'pattern' }));

  // ── فروشنده ──
  const seller = settings;
  if (!seller.economicCode) issues.push(blocking('SELLER_ECONOMIC_CODE', 'شماره اقتصادی فروشنده در تنظیمات ماژول مالیات ثبت نشده است', { field: 'tins' }));
  else if (!PATTERNS.economicCode.test(seller.economicCode)) issues.push(blocking('SELLER_ECONOMIC_CODE_FORMAT', 'شماره اقتصادی فروشنده باید ۱۰ یا ۱۴ رقم باشد', { field: 'tins' }));
  if (!seller.fiscalId) issues.push(blocking('FISCAL_ID', 'شناسه یکتای حافظه مالیاتی در تنظیمات ثبت نشده است', { field: 'fiscalId' }));
  else if (!PATTERNS.fiscalId.test(seller.fiscalId)) issues.push(blocking('FISCAL_ID_FORMAT', 'شناسه یکتای حافظه مالیاتی باید ۶ نویسه‌ی حرف/عدد باشد', { field: 'fiscalId' }));

  // ── شماره مالیاتی ──
  let taxid: string | null = null;
  let inno: string | null = null;
  if (!taxInvoice.taxid) {
    issues.push(blocking('TAXID_MISSING', 'شماره منحصر به فرد مالیاتی (taxid) وارد نشده است؛ ساخت خودکار آن هنوز راستی‌آزمایی نشده و باید دستی وارد شود', { field: 'taxid' }));
  } else {
    const chk = checkManualTaxId(taxInvoice.taxid, seller.fiscalId);
    if (!chk.ok) issues.push(blocking('TAXID_FORMAT', chk.reason, { field: 'taxid' }));
    else {
      taxid = chk.taxid;
      inno = chk.inno;
    }
  }
  const subjectCode = INVOICE_SUBJECT_CODE[taxInvoice.subject];
  if (SUBJECTS_REQUIRING_REFERENCE.includes(taxInvoice.subject)) {
    if (!taxInvoice.irtaxid) issues.push(blocking('IRTAXID_MISSING', 'شماره مالیاتی صورتحساب مرجع (irtaxid) برای اصلاحی/ابطالی لازم است', { field: 'irtaxid' }));
    else if (!PATTERNS.taxid.test(taxInvoice.irtaxid)) issues.push(blocking('IRTAXID_FORMAT', 'شماره مالیاتی صورتحساب مرجع نامعتبر است', { field: 'irtaxid' }));
  }

  // ── خریدار ──
  const c = invoice.contact;
  const buyerEconomic = (o.buyerEconomicCode ?? c.economicCode ?? '').trim() || null;
  let buyerId: string | null = (o.buyerId ?? '').trim() || null;
  let tob = o.buyerType ?? null;
  if (c.type === 'COMPANY') {
    tob = tob ?? BUYER_TYPE.LEGAL;
    buyerId = buyerId ?? (c.legalId?.trim() || c.nationalId?.trim() || null);
    if (!buyerEconomic) issues.push(blocking('BUYER_ECONOMIC_CODE', 'کد اقتصادی مشتری حقوقی ثبت نشده است (صورتحساب نوع اول)', { field: 'tinb' }));
    if (!buyerId) issues.push(blocking('BUYER_ID', 'شناسه ملی مشتری حقوقی ثبت نشده است', { field: 'bid' }));
  } else {
    buyerId = buyerId ?? (c.nationalId?.trim() || null);
    tob = tob ?? (buyerId ? BUYER_TYPE.INDIVIDUAL : BUYER_TYPE.FINAL_CONSUMER);
    if (!buyerId && tob !== BUYER_TYPE.FINAL_CONSUMER) issues.push(blocking('BUYER_ID', 'کد ملی خریدار ثبت نشده است', { field: 'bid' }));
    if (!buyerId) issues.push(warning('BUYER_NO_ID', 'کد ملی مشتری ثبت نشده؛ صورتحساب به‌عنوان «مصرف‌کننده نهایی» ارسال می‌شود', { field: 'bid' }));
  }
  if (buyerEconomic && !PATTERNS.economicCode.test(buyerEconomic)) issues.push(blocking('BUYER_ECONOMIC_CODE_FORMAT', 'کد اقتصادی خریدار باید ۱۰ یا ۱۴ رقم باشد', { field: 'tinb' }));
  if (buyerId && c.type === 'INDIVIDUAL' && tob === BUYER_TYPE.INDIVIDUAL && !PATTERNS.nationalId.test(buyerId)) issues.push(blocking('BUYER_ID_FORMAT', 'کد ملی خریدار باید ۱۰ رقم باشد', { field: 'bid' }));
  if (buyerId && c.type === 'COMPANY' && !PATTERNS.legalId.test(buyerId)) issues.push(blocking('BUYER_ID_FORMAT', 'شناسه ملی خریدار حقوقی باید ۱۱ رقم باشد', { field: 'bid' }));
  const bpc = (o.buyerPostalCode ?? '').trim() || null;
  if (!bpc) issues.push(warning('BUYER_POSTAL_CODE', 'کد پستی خریدار ثبت نشده است (در برگه‌ی اصلاح وارد کنید)', { field: 'bpc' }));
  else if (!PATTERNS.postalCode.test(bpc)) issues.push(blocking('BUYER_POSTAL_CODE_FORMAT', 'کد پستی خریدار باید ۱۰ رقم باشد', { field: 'bpc' }));

  const invoiceType = o.invoiceType ?? (buyerEconomic ? INVOICE_TYPE.TYPE_1 : INVOICE_TYPE.TYPE_2);

  // ── ردیف‌ها ──
  const grossRial = invoice.lines.map((l) => toRial(l.quantity * l.unitPrice));
  const discountRial = allocate(Math.min(toRial(invoice.discount), grossRial.reduce((a, b) => a + b, 0)), grossRial);
  const body = invoice.lines.map((l, idx) => {
    const m = l.productId ? mappings.get(l.productId) : undefined;
    const sstid = m?.sstid ?? settings.defaultSstid ?? null;
    const unit = m?.unitCode ?? settings.defaultUnitCode ?? null;
    const rate = m?.vatRate ?? invoice.taxRate ?? settings.defaultVatRate ?? null;
    if (!sstid) issues.push(blocking('SSTID_MISSING', `برای «${l.description}» شناسه کالا/خدمت (۱۳ رقمی) نگاشت نشده و پیش‌فرضی هم تنظیم نیست`, { lineIndex: idx, field: 'sstid' }));
    else if (!PATTERNS.sstid.test(sstid)) issues.push(blocking('SSTID_FORMAT', `شناسه کالا/خدمت «${l.description}» باید ۱۳ رقم باشد`, { lineIndex: idx, field: 'sstid' }));
    else if (!m) issues.push(warning('SSTID_DEFAULT', `«${l.description}» با شناسه‌ی پیش‌فرض ارسال می‌شود (نگاشت اختصاصی ندارد)`, { lineIndex: idx, field: 'sstid' }));
    if (unit === null) issues.push(blocking('UNIT_MISSING', `واحد اندازه‌گیری «${l.description}» مشخص نیست`, { lineIndex: idx, field: 'mu' }));
    if (rate === null) issues.push(blocking('VAT_RATE_MISSING', `نرخ مالیات بر ارزش افزوده «${l.description}» مشخص نیست (فاکتور، نگاشت کالا یا تنظیمات)`, { lineIndex: idx, field: 'vra' }));
    else if (rate < 0 || rate > 100) issues.push(blocking('VAT_RATE_RANGE', `نرخ ارزش افزوده «${l.description}» خارج از بازه‌ی ۰ تا ۱۰۰ است`, { lineIndex: idx, field: 'vra' }));
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) issues.push(blocking('QUANTITY', `تعداد «${l.description}» نامعتبر است`, { lineIndex: idx, field: 'am' }));

    const prdis = grossRial[idx]!;
    const dis = discountRial[idx]!;
    const adis = prdis - dis;
    const vam = rate === null ? 0 : Math.round((adis * rate) / 100);
    const row = emptyBody();
    row.sstid = sstid;
    row.sstt = l.description;
    row.mu = unit;
    row.am = l.quantity;
    row.fee = toRial(l.unitPrice);
    row.prdis = prdis;
    row.dis = dis;
    row.adis = adis;
    row.vra = rate === null ? null : vatRateToWire(rate);
    row.vam = vam;
    row.tsstam = adis + vam;
    return row;
  });

  // ── جمع‌ها و تسویه ──
  const sum = (key: 'prdis' | 'dis' | 'adis' | 'vam' | 'tsstam') => body.reduce((a, r) => a + Number(r[key] ?? 0), 0);
  const tprdis = sum('prdis');
  const tdis = sum('dis');
  const tadis = sum('adis');
  const tvam = sum('vam');
  const tbill = tadis + tvam;

  const expectedRial = toRial(invoice.total);
  const diffToman = Math.abs(tbill - expectedRial) / TOMAN_TO_RIAL;
  if (diffToman > 0) {
    if (diffToman > Math.max(1, invoice.lines.length)) {
      issues.push(blocking('TOTAL_MISMATCH', `مجموع صورتحساب مودیان (${(tbill / TOMAN_TO_RIAL).toLocaleString('en-US')} تومان) با مبلغ فاکتور فروش (${invoice.total.toLocaleString('en-US')} تومان) نمی‌خواند؛ نرخ مالیات اقلام را بررسی کنید`, { field: 'tbill' }));
    } else {
      issues.push(warning('TOTAL_ROUNDING', `اختلاف گرد کردن ${diffToman.toLocaleString('en-US')} تومان بین فاکتور فروش و صورتحساب مودیان`, { field: 'tbill' }));
    }
  }

  const paidRial = Math.min(toRial(Math.max(0, invoice.paidAmount)), tbill);
  const setm = paidRial <= 0 ? SETTLEMENT.CREDIT : paidRial >= tbill ? SETTLEMENT.CASH : SETTLEMENT.CASH_CREDIT;
  const cap = paidRial;
  const insp = tbill - paidRial;
  const tvop = tbill > 0 ? Math.round((tvam * paidRial) / tbill) : 0;
  const copShares = allocate(cap, body.map((r) => Number(r.tsstam)));
  const vopShares = allocate(tvop, body.map((r) => Number(r.tsstam)));
  body.forEach((r, i) => {
    r.cop = copShares[i]!;
    r.vop = vopShares[i]!;
  });

  const header = emptyHeader();
  header.taxid = taxid;
  header.indatim = invoice.issuedAt.getTime();
  header.indati2m = taxInvoice.createdAt.getTime();
  header.inty = invoiceType;
  header.inno = inno;
  header.irtaxid = taxInvoice.irtaxid ?? null;
  header.inp = taxInvoice.pattern;
  header.ins = subjectCode;
  header.tins = seller.economicCode;
  header.tob = tob;
  header.bid = buyerId;
  header.tinb = buyerEconomic;
  header.sbc = (o.branchCode ?? seller.branchCode) || null;
  header.bpc = bpc;
  header.bbc = (o.buyerBranchCode ?? '') || null;
  header.tprdis = tprdis;
  header.tdis = tdis;
  header.tadis = tadis;
  header.tvam = tvam;
  header.todam = 0;
  header.tbill = tbill;
  header.setm = setm;
  header.cap = cap;
  header.insp = insp;
  header.tvop = tvop;

  return {
    payload: { header, body, payments: [] },
    issues,
    resolved: { invoiceType, pattern: taxInvoice.pattern, inno, taxid },
    blocking: issues.some((i) => i.severity === 'BLOCKING'),
  };
}
