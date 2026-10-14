import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { invoiceFinalizationBlock } from './dispatch-weight.js';

/**
 * دروازه‌ی نهایی‌شدن فاکتور فروش — فقط وقتی ماژول dispatch نصب است صدا زده می‌شود (invoices.service → confirm).
 * اگر برای این فاکتور بار با «نیاز به وزن‌کشی» اعلام شده و وزن/تعدیل هنوز تأیید نشده باشد، پیام مسدودکننده برمی‌گردد.
 */
export async function invoiceWeighingBlockFor(db: TenantPrismaClient, invoiceId: string): Promise<string | null> {
  const loadings = await db.shipmentLoading.findMany({
    where: { needsWeighing: true, shipment: { sourceInvoiceId: invoiceId } },
    select: { shipmentId: true, weightConfirmedAt: true, shipment: { select: { status: true } } },
  });
  for (const l of loadings) {
    const adj = await db.dispatchInvoiceAdjustment.findFirst({ where: { invoiceId, shipmentId: l.shipmentId }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    const block = invoiceFinalizationBlock({
      needsWeighing: true,
      shipmentCancelled: l.shipment.status === 'CANCELLED',
      weightConfirmed: !!l.weightConfirmedAt,
      adjustmentStatus: adj?.status ?? null,
    });
    if (block) return block;
  }
  return null;
}
