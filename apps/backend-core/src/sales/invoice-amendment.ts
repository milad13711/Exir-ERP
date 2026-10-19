/**
 * قواعد خالصِ «ویرایش/ابطال فاکتور پس از تأیید» — بدون وابستگی به پایگاه داده تا تست‌پذیر باشد.
 * منطق تراکنشی در InvoicesService.editConfirmed / cancelConfirmed است؛ این‌جا فقط
 * (۱) تشخیص مسدودیت، (۲) تصویر/تفاوت قبل و بعد برای تاریخچه، (۳) محاسبه‌ی خالص حرکت‌های انبار.
 */

export type AmendableInvoice = {
  status: string;
  paidAmount: number;
  signedAt: Date | null;
  deliveryConfirmedAt: Date | null;
  paymentsCount: number;
  checksCount: number;
  returnsCount: number;
  activeShipmentsCount: number;
};

const RETURN_PATH = 'برای اصلاح، «برگشت از فروش» ثبت کنید یا فاکتور را باطل و فاکتور تازه صادر کنید';

/** null = قابل ویرایش؛ وگرنه پیام فارسیِ علت مسدودیت (همراه با مسیر جایگزین). */
export function invoiceEditBlock(inv: AmendableInvoice): string | null {
  if (inv.status === 'DRAFT') return 'این فاکتور هنوز پیش‌نویس است؛ مستقیم ویرایش کنید';
  if (inv.status === 'CANCELLED') return 'فاکتور باطل‌شده قابل ویرایش نیست';
  if (inv.status === 'PAID' || inv.status === 'PARTIALLY_PAID' || inv.paidAmount > 0 || inv.paymentsCount > 0) {
    return `این فاکتور پرداخت دارد و ویرایش آن حساب مشتری را به‌هم می‌ریزد. ${RETURN_PATH}`;
  }
  if (inv.status !== 'CONFIRMED') return 'فقط فاکتور تأییدشده‌ی بدون پرداخت قابل ویرایش است';
  if (inv.checksCount > 0) return `برای این فاکتور چک ثبت شده است. ${RETURN_PATH}`;
  if (inv.returnsCount > 0) return 'برای این فاکتور مرجوعی ثبت شده است و ویرایش آن ممکن نیست؛ ابتدا مرجوعی‌ها را حذف کنید';
  if (inv.deliveryConfirmedAt) return `تحویل کالا به مشتری تأیید شده است. ${RETURN_PATH}`;
  if (inv.signedAt) return `این فاکتور امضا شده است و تغییر آن مدرک امضا را بی‌اعتبار می‌کند. ${RETURN_PATH}`;
  if (inv.activeShipmentsCount > 0) return 'برای این فاکتور بار (حمل) ثبت شده است؛ ابتدا اعلام بار را لغو کنید';
  return null;
}

/** ابطال فاکتور تأییدشده — همان مسدودیت‌های ویرایش به‌علاوه‌ی تحویل و بار؛ فاکتور امضاشده قابل ابطال است (با دلیل). */
export function invoiceVoidBlock(inv: AmendableInvoice): string | null {
  if (inv.status === 'DRAFT') return 'پیش‌نویس را حذف کنید (ابطال فقط برای فاکتور تأییدشده است)';
  if (inv.status === 'CANCELLED') return 'این فاکتور قبلاً باطل شده است';
  if (inv.status !== 'CONFIRMED') return 'فقط فاکتور تأییدشده‌ی بدون پرداخت قابل ابطال است';
  if (inv.paidAmount > 0 || inv.paymentsCount > 0) return 'این فاکتور پرداخت دارد؛ ابتدا پرداخت‌ها را برگردانید';
  if (inv.returnsCount > 0) return 'برای این فاکتور مرجوعی ثبت شده است و ابطال کامل ممکن نیست';
  if (inv.deliveryConfirmedAt) return 'تحویل کالا به مشتری تأیید شده است؛ به‌جای ابطال «برگشت از فروش» ثبت کنید';
  if (inv.activeShipmentsCount > 0) return 'برای این فاکتور بار (حمل) ثبت شده است؛ ابتدا اعلام بار را لغو کنید';
  return null;
}

export type InvoiceSnapshot = {
  contactId: string;
  contactName?: string | null;
  dueAt: string | null;
  discount: number;
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  notes: string | null;
  paymentMethod: string;
  paymentBankInfo: string | null;
  lines: Array<{ productId: string | null; description: string; quantity: number; unitPrice: number }>;
};

export type Change = { field: string; from: unknown; to: unknown };

export function snapshotInvoice(inv: {
  contactId: string;
  contact?: { name: string; company?: string | null } | null;
  dueAt: Date | null;
  discount: number;
  subtotal: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  notes: string | null;
  paymentMethod: string;
  paymentBankInfo: string | null;
  lines: Array<{ productId: string | null; description: string; quantity: number; unitPrice: number }>;
}): InvoiceSnapshot {
  return {
    contactId: inv.contactId,
    contactName: inv.contact ? inv.contact.company || inv.contact.name : null,
    dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
    discount: inv.discount,
    subtotal: inv.subtotal,
    taxRate: inv.taxRate,
    taxAmount: inv.taxAmount,
    total: inv.total,
    notes: inv.notes,
    paymentMethod: inv.paymentMethod,
    paymentBankInfo: inv.paymentBankInfo,
    lines: inv.lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
  };
}

const FIELD_LABELS: Record<string, string> = {
  contactId: 'مشتری',
  dueAt: 'سررسید',
  discount: 'تخفیف',
  subtotal: 'جمع اقلام',
  taxRate: 'نرخ مالیات',
  taxAmount: 'مالیات',
  total: 'مبلغ نهایی',
  notes: 'یادداشت',
  paymentMethod: 'روش پرداخت',
  paymentBankInfo: 'حساب بانکی',
};

const lineKey = (l: { productId: string | null; description: string }) => `${l.productId ?? ''}::${l.description}`;

/** تفاوت خوانا بین دو تصویر؛ اقلام بر اساس (کالا+شرح) تطبیق داده می‌شوند. */
export function diffSnapshots(before: InvoiceSnapshot, after: InvoiceSnapshot): Change[] {
  const changes: Change[] = [];
  for (const k of Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS & keyof InvoiceSnapshot>) {
    const a = before[k];
    const b = after[k];
    if (a === b || (a == null && b == null)) continue;
    if (k === 'contactId') {
      changes.push({ field: FIELD_LABELS[k], from: before.contactName ?? a, to: after.contactName ?? b });
    } else {
      changes.push({ field: FIELD_LABELS[k], from: a, to: b });
    }
  }
  const beforeMap = new Map(before.lines.map((l) => [lineKey(l), l]));
  const afterMap = new Map(after.lines.map((l) => [lineKey(l), l]));
  for (const [key, l] of afterMap) {
    const old = beforeMap.get(key);
    if (!old) {
      changes.push({ field: `قلم «${l.description}»`, from: null, to: `${l.quantity} × ${l.unitPrice}` });
    } else if (old.quantity !== l.quantity || old.unitPrice !== l.unitPrice) {
      changes.push({ field: `قلم «${l.description}»`, from: `${old.quantity} × ${old.unitPrice}`, to: `${l.quantity} × ${l.unitPrice}` });
    }
  }
  for (const [key, l] of beforeMap) {
    if (!afterMap.has(key)) changes.push({ field: `قلم «${l.description}»`, from: `${l.quantity} × ${l.unitPrice}`, to: null });
  }
  return changes;
}

/**
 * خالص تغییر موجودی هر کالا بین فاکتور قدیم و جدید: مثبت = باید خروج بیشتری ثبت شود (حواله)،
 * منفی = بخشی از کالا به انبار برمی‌گردد. کالای بدون تغییر در خروجی نمی‌آید — به‌جای معکوس‌کردن و ثبت
 * مجدد همه‌ی حرکت‌ها (که تاریخچه‌ی انبار را شلوغ می‌کند)، فقط اختلاف ثبت می‌شود.
 */
export function netStockDeltas(
  oldLines: Array<{ productId?: string | null; quantity: number }>,
  newLines: Array<{ productId?: string | null; quantity: number }>,
): Array<{ productId: string; issueDelta: number }> {
  const totals = new Map<string, number>();
  for (const l of oldLines) if (l.productId) totals.set(l.productId, (totals.get(l.productId) ?? 0) - l.quantity);
  for (const l of newLines) if (l.productId) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.quantity);
  return [...totals.entries()].filter(([, d]) => d !== 0).map(([productId, issueDelta]) => ({ productId, issueDelta }));
}

/** سطرهای سند معکوس: بدهکار/بستانکار جابه‌جا می‌شود. */
export function reverseJournalLines<T extends { accountId: string; debit: bigint; credit: bigint; description?: string | null }>(lines: T[]) {
  return lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description ?? undefined }));
}
