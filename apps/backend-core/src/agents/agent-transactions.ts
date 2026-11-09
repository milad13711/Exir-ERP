/**
 * دفتر مرکزی تراکنش‌های محصولات + پورسانت نماینده. داخل تراکنش DB ِ ingest صدا زده می‌شود (Tx).
 *
 * - هر تراکنش (چه مشتری نماینده داشته باشد چه نه) یک‌بار با (productId, externalTxId) ثبت می‌شود — ایدمپوتنت.
 * - انواع تراکنش و اقلام ناشناخته خودکار به کاتالوگ محصول اضافه می‌شوند تا ادمین برایشان قانون بگذارد.
 * - پورسانت فقط وقتی: مشتری به نماینده‌ای نسبت داده شده، عضویت او در لحظه‌ی ثبت ACTIVE است و قانونی تطبیق دارد.
 *   قانون و درصد در خود ردیف پورسانت snapshot می‌شود (تغییر بعدی قانون روی گذشته اثر ندارد).
 * - بازپرداخت: پورسانت(های) تراکنش اصلی به‌نسبت مبلغ برگشتی، فوری و با مبلغ منفی برگشت می‌خورد.
 */
import type { Prisma } from '../../generated/tenant-client/index.js';
import { commissionAmount, deriveOccurrence, pickPlanRule, reversalAmount, type TxOccurrence } from './agent-commission.js';

type Tx = Prisma.TransactionClient;

export type TransactionInput = {
  externalTxId: string;
  externalCustomerId: string;
  txTypeCode: string;
  itemCode: string | null;
  itemName: string | null;
  occurrence: TxOccurrence | null;
  grossAmount: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  /** به واحد پایه */
  netAmount: number;
  currency: string;
  originalCurrency: string;
  originalNetAmount: number;
  paidAt: Date;
  periodEnd: Date | null;
  /** برای بازپرداخت: شناسه‌ی تراکنش اصلی نزد محصول */
  refundOfExternalTxId: string | null;
  inboundEventId: string | null;
};

export type RecordResult = {
  duplicate: boolean;
  transactionId: string;
  occurrence: string;
  commissionStatus: string;
  commission: { membershipId: string; amount: number; percent: number; ruleId: string | null } | null;
};

export class TransactionRejection extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;

async function ensureCatalog(tx: Tx, productId: string, txTypeCode: string, itemCode: string | null, itemName: string | null) {
  await tx.agentTransactionType.upsert({ where: { productId_code: { productId, code: txTypeCode } }, create: { productId, code: txTypeCode, name: txTypeCode }, update: {} });
  if (itemCode) {
    await tx.agentTransactionItem.upsert({ where: { productId_code: { productId, code: itemCode } }, create: { productId, code: itemCode, name: itemName ?? itemCode }, update: {} });
  }
}

export async function recordTransaction(tx: Tx, productId: string, input: TransactionInput, now = new Date()): Promise<RecordResult> {
  const existing = await tx.agentTransaction.findUnique({ where: { productId_externalTxId: { productId, externalTxId: input.externalTxId } } });
  if (existing) return { duplicate: true, transactionId: existing.id, occurrence: existing.occurrence, commissionStatus: existing.commissionStatus, commission: null };

  await ensureCatalog(tx, productId, input.txTypeCode, input.itemCode, input.itemName);
  const customer = await tx.agentCustomer.findUnique({ where: { productId_externalCustomerId: { productId, externalCustomerId: input.externalCustomerId } } });

  if (input.refundOfExternalTxId) return recordRefund(tx, productId, input, customer, now);

  const prior = await tx.agentTransaction.count({
    where: { productId, externalCustomerId: input.externalCustomerId, txTypeCode: input.txTypeCode, itemCode: input.itemCode, occurrence: { not: 'REFUND' } },
  });
  const occurrence = deriveOccurrence(input.occurrence, prior);

  let commissionStatus = 'NOT_ATTRIBUTED';
  let note: string | null = null;
  let membership: { id: string; level: string; status: string } | null = null;
  let rule: Awaited<ReturnType<typeof tx.agentCommissionPlanRule.findMany>>[number] | null = null;
  let amount = 0;

  if (customer) {
    membership = await tx.agentProductMembership.findUnique({ where: { id: customer.membershipId }, select: { id: true, level: true, status: true } });
    if (!membership || membership.status !== 'ACTIVE') {
      commissionStatus = 'AGENT_INACTIVE';
      note = 'عضویت نماینده در زمان تراکنش فعال نبود';
    } else {
      const rules = await tx.agentCommissionPlanRule.findMany({ where: { productId, level: membership.level } });
      rule = pickPlanRule(rules, { level: membership.level, txTypeCode: input.txTypeCode, itemCode: input.itemCode, occurrence, at: input.paidAt });
      if (!rule) {
        commissionStatus = 'NO_RULE';
        note = 'قانون پورسانتی برای این نوع تراکنش/قلم/سطح تعریف نشده است';
      } else {
        amount = commissionAmount(input.netAmount, rule.percent);
        commissionStatus = amount > 0 ? 'CREDITED' : 'ZERO';
      }
    }
  }

  const t = await tx.agentTransaction.create({
    data: {
      productId,
      externalTxId: input.externalTxId,
      externalCustomerId: input.externalCustomerId,
      customerId: customer?.id ?? null,
      membershipId: membership?.id ?? null,
      membershipLevel: membership?.level ?? null,
      txTypeCode: input.txTypeCode,
      itemCode: input.itemCode,
      itemName: input.itemName,
      occurrence,
      grossAmount: input.grossAmount,
      discountAmount: input.discountAmount,
      taxAmount: input.taxAmount,
      netAmount: input.netAmount,
      currency: input.currency,
      originalCurrency: input.originalCurrency,
      originalNetAmount: input.originalNetAmount,
      paidAt: input.paidAt,
      periodEnd: input.periodEnd,
      commissionStatus,
      commissionNote: note,
      inboundEventId: input.inboundEventId,
    },
  });

  if (commissionStatus === 'CREDITED' && customer && membership && rule) {
    const product = await tx.agentProduct.findUnique({ where: { id: productId }, select: { holdDays: true } });
    const holdMs = (product?.holdDays ?? 0) * DAY;
    const availableAt = new Date(Math.max(input.paidAt.getTime(), now.getTime()) + holdMs);
    await tx.agentCommission.create({
      data: {
        transactionId: t.id,
        productId,
        membershipId: membership.id,
        customerId: customer.id,
        ruleId: rule.id,
        level: membership.level,
        percent: rule.percent,
        baseAmount: input.netAmount,
        amount,
        kind: 'CREDIT',
        availableAt,
        ruleSnapshot: { ruleId: rule.id, level: rule.level, txTypeCode: rule.txTypeCode, itemCode: rule.itemCode, occurrence: rule.occurrence, percent: rule.percent, effectiveFrom: rule.effectiveFrom.toISOString() },
      },
    });
    return { duplicate: false, transactionId: t.id, occurrence, commissionStatus, commission: { membershipId: membership.id, amount, percent: rule.percent, ruleId: rule.id } };
  }
  return { duplicate: false, transactionId: t.id, occurrence, commissionStatus, commission: null };
}

async function recordRefund(
  tx: Tx,
  productId: string,
  input: TransactionInput,
  customer: { id: string } | null,
  now: Date,
): Promise<RecordResult> {
  const original = await tx.agentTransaction.findUnique({ where: { productId_externalTxId: { productId, externalTxId: input.refundOfExternalTxId! } } });
  if (!original || original.occurrence === 'REFUND') throw new TransactionRejection(422, 'ORIGINAL_TRANSACTION_NOT_FOUND', 'تراکنش اصلیِ این بازپرداخت یافت نشد');
  if (original.externalCustomerId !== input.externalCustomerId) throw new TransactionRejection(422, 'PAYMENT_CUSTOMER_MISMATCH', 'تراکنش اصلی به این مشتری تعلق ندارد');
  const refunded = await tx.agentTransaction.aggregate({ _sum: { netAmount: true }, where: { productId, refundOfTransactionId: original.id } });
  if (input.netAmount <= 0) throw new TransactionRejection(422, 'INVALID_REFUND', 'مبلغ بازپرداخت باید مثبت باشد');
  if ((refunded._sum.netAmount ?? 0) + input.netAmount > original.netAmount) throw new TransactionRejection(422, 'REFUND_EXCEEDS_PAYMENT', 'جمع بازپرداخت‌ها از مبلغ تراکنش بیشتر می‌شود');

  const credits = await tx.agentCommission.findMany({ where: { transactionId: original.id, kind: 'CREDIT' } });
  const t = await tx.agentTransaction.create({
    data: {
      productId,
      externalTxId: input.externalTxId,
      externalCustomerId: input.externalCustomerId,
      customerId: customer?.id ?? original.customerId,
      membershipId: original.membershipId,
      membershipLevel: original.membershipLevel,
      txTypeCode: input.txTypeCode,
      itemCode: input.itemCode ?? original.itemCode,
      itemName: input.itemName ?? original.itemName,
      occurrence: 'REFUND',
      grossAmount: input.grossAmount,
      discountAmount: input.discountAmount,
      taxAmount: input.taxAmount,
      netAmount: input.netAmount,
      currency: input.currency,
      originalCurrency: input.originalCurrency,
      originalNetAmount: input.originalNetAmount,
      paidAt: input.paidAt,
      periodEnd: null,
      refundOfTransactionId: original.id,
      commissionStatus: credits.length ? 'REVERSED' : 'NOT_ATTRIBUTED',
      commissionNote: null,
      inboundEventId: input.inboundEventId,
    },
  });

  let reversedTotal = 0;
  for (const c of credits) {
    // برگشت‌های قبلیِ همین پورسانت (هر بازپرداخت یک تراکنش جدا با ردیف REVERSAL خودش)
    const prev = await tx.agentCommission.aggregate({ _sum: { amount: true }, where: { reversesCommissionId: c.id, kind: 'REVERSAL' } });
    const back = reversalAmount(c.amount, -(prev._sum.amount ?? 0), original.netAmount, input.netAmount);
    if (back <= 0) continue;
    await tx.agentCommission.create({
      data: {
        transactionId: t.id,
        productId,
        membershipId: c.membershipId,
        customerId: c.customerId,
        ruleId: c.ruleId,
        level: c.level,
        percent: c.percent,
        baseAmount: input.netAmount,
        amount: -back,
        kind: 'REVERSAL',
        reversesCommissionId: c.id,
        availableAt: now,
        ruleSnapshot: c.ruleSnapshot as Prisma.InputJsonValue,
      },
    });
    reversedTotal += back;
  }
  return { duplicate: false, transactionId: t.id, occurrence: 'REFUND', commissionStatus: t.commissionStatus, commission: reversedTotal ? { membershipId: credits[0].membershipId, amount: -reversedTotal, percent: credits[0].percent, ruleId: credits[0].ruleId } : null };
}
