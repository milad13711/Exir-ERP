import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { loadBaseCurrency } from '../base-currency/base-unit.js';
import { stageAfterEvent } from './agent-funnel.js';
import type { FunnelStage } from './agent-constants.js';
import { toBaseUnit, InexactAmountError, UnsupportedCurrencyError } from './agent-money.js';
import { phoneKey } from './agent-phone.js';
import type { NormalizedEvent } from './agent-event-validator.js';
import { recordTransaction, TransactionRejection, type RecordResult } from './agent-transactions.js';

type Db = TenantPrismaClient;
type Tx = Prisma.TransactionClient;

/** خطای دامنه‌ای با کد HTTP و کد ماشین‌خوان برای پاسخ به محصول. */
export class IngestRejection extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class DryRunRollback extends Error {}

export type IngestOutcome = { status: 'ACCEPTED' | 'DUPLICATE' | 'IGNORED'; eventId: string; detail?: Record<string, unknown> };

const PHONE_MASK = (v: string | null | undefined) => (v ? v.replace(/^(\d{4})\d{3}(\d{4})$/, '$1•••$2') : null);

/** حذف/ماسک PII از payload پیش از ذخیره در لاگ ممیزی. */
export function sanitizePayload(e: NormalizedEvent): Record<string, unknown> {
  const data: Record<string, unknown> = { ...e.data };
  if ('phone' in data) data.phone = PHONE_MASK(data.phone as string | null);
  if ('email' in data && typeof data.email === 'string') data.email = data.email.replace(/^(.).*(@.*)$/, '$1•••$2');
  return { eventId: e.eventId, type: e.type, occurredAt: e.occurredAt.toISOString(), data };
}

/** پردازش رویدادهای ورودی محصولات: ایدمپوتنت (eventId)، تراکنشی، جداسازی کامل محصول‌ها، ضد خود-معرفی. */
@Injectable()
export class AgentIngestService {
  private readonly logger = new Logger('AgentIngestService');

  async process(db: Db, ctx: { productId: string; keyId: string; ip?: string }, event: NormalizedEvent, opts: { dryRun?: boolean } = {}): Promise<IngestOutcome> {
    const base = await loadBaseCurrency(db);
    try {
      return await db.$transaction(
        async (tx) => {
          // ایدمپوتنسی: درج لاگ با کلید یکتای (محصول، eventId) — رویداد تکراری یا هم‌زمان یکی‌شان P2002 می‌گیرد
          let logId: string;
          try {
            const row = await tx.agentApiEventLog.create({
              data: {
                productId: ctx.productId,
                keyId: ctx.keyId,
                clientEventId: event.eventId,
                eventId: opts.dryRun ? null : event.eventId,
                type: event.type,
                status: 'ACCEPTED',
                httpStatus: 202,
                payload: sanitizePayload(event) as Prisma.InputJsonValue,
                ip: ctx.ip,
              },
            });
            logId = row.id;
          } catch (e) {
            if ((e as { code?: string }).code === 'P2002') return { status: 'DUPLICATE' as const, eventId: event.eventId };
            throw e;
          }
          const result = await this.apply(tx as unknown as Db, ctx.productId, event, base);
          if (result.status === 'IGNORED') await tx.agentApiEventLog.update({ where: { id: logId }, data: { status: 'IGNORED', message: String(result.detail?.reason ?? '') } });
          if (opts.dryRun) throw new DryRunRollback(JSON.stringify(result));
          return result;
        },
        { timeout: 15_000, maxWait: 5_000 },
      );
    } catch (e) {
      if (e instanceof DryRunRollback) return { status: 'ACCEPTED', eventId: event.eventId, detail: { dryRun: true, ...(JSON.parse(e.message) as object) } };
      if (e instanceof IngestRejection) throw e;
      if (e instanceof TransactionRejection) throw new IngestRejection(e.httpStatus, e.code, e.message);
      if (e instanceof UnsupportedCurrencyError) throw new IngestRejection(400, 'UNSUPPORTED_CURRENCY', e.message);
      if (e instanceof InexactAmountError) throw new IngestRejection(422, 'INEXACT_AMOUNT', e.message);
      if ((e as { code?: string }).code === 'P2002') throw new IngestRejection(409, 'CONFLICT', 'رکورد تکراری (شناسه‌ی پرداخت یا مشتری قبلاً ثبت شده است)');
      throw e;
    }
  }

  /**
   * «ارسال رویداد آزمایشی» پنل ادمین: توالی رویدادها را در یک تراکنش اجرا و در پایان همیشه برمی‌گرداند — هیچ اثری روی مشتری/دفتر پرداخت نمی‌ماند.
   * خروجی هر گام: موفق یا کد خطای دامنه.
   */
  async dryRunSequence(db: Db, productId: string, events: NormalizedEvent[]): Promise<Array<{ type: string; ok: boolean; status?: string; code?: string; message?: string }>> {
    const base = await loadBaseCurrency(db);
    const steps: Array<{ type: string; ok: boolean; status?: string; code?: string; message?: string }> = [];
    try {
      await db.$transaction(
        async (tx) => {
          for (const ev of events) {
            try {
              const r = await this.apply(tx as unknown as Db, productId, ev, base);
              steps.push({ type: ev.type, ok: true, status: r.status });
            } catch (e) {
              if (e instanceof IngestRejection) steps.push({ type: ev.type, ok: false, code: e.code, message: e.message });
              else if (e instanceof UnsupportedCurrencyError || e instanceof InexactAmountError) steps.push({ type: ev.type, ok: false, code: 'INVALID_AMOUNT', message: e.message });
              else throw e;
              break;
            }
          }
          throw new DryRunRollback('rollback');
        },
        { timeout: 15_000, maxWait: 5_000 },
      );
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
    return steps;
  }

  /** اثر رویداد روی داده‌ها؛ همیشه داخل تراکنش فراخوانی می‌شود. */
  private async apply(tx: Db, productId: string, event: NormalizedEvent, base: Awaited<ReturnType<typeof loadBaseCurrency>>): Promise<IngestOutcome> {
    switch (event.type) {
      case 'customer.registered':
        return this.onRegistered(tx, productId, event);
      case 'subscription.activated':
      case 'subscription.renewed':
        return this.onSubscription(tx, productId, event, base);
      case 'subscription.cancelled':
        return this.onCancelled(tx, productId, event);
      case 'payment.refunded':
        return this.onRefund(tx, productId, event, base);
      case 'transaction.recorded':
        return this.onTransaction(tx, productId, event, base);
    }
  }

  private async setStage(tx: Db, customerId: string, from: string | null, to: FunnelStage | null, note: string) {
    if (!to || to === from) return;
    await tx.agentCustomer.update({ where: { id: customerId }, data: { funnelStage: to } });
    await tx.agentCustomerStageLog.create({ data: { customerId, fromStage: from, toStage: to, source: 'EVENT', note } });
  }

  private async onRegistered(tx: Db, productId: string, e: Extract<NormalizedEvent, { type: 'customer.registered' }>): Promise<IngestOutcome> {
    const membership = await tx.agentProductMembership.findFirst({
      where: { productId, referralCode: e.data.referralCode },
      include: { resellerProfile: { include: { contact: { select: { phone: true, email: true } }, user: { select: { id: true } } } } },
    });
    if (!membership) throw new IngestRejection(422, 'UNKNOWN_REFERRAL_CODE', 'کد معرف برای این محصول وجود ندارد');
    if (membership.status !== 'ACTIVE') throw new IngestRejection(422, 'REFERRAL_CODE_INACTIVE', 'کد معرف فعال نیست');

    // ضد خود-معرفی: شماره/ایمیل خودِ نماینده (مخاطب و حساب ورودش) نمی‌تواند مشتریِ او باشد
    const agentKeys = new Set<string>();
    const k1 = phoneKey(membership.resellerProfile.contact.phone);
    if (k1) agentKeys.add(k1);
    if (membership.resellerProfile.userId) {
      const u = await tx.user.findUnique({ where: { id: membership.resellerProfile.userId }, select: { phone: true, email: true } });
      const k2 = phoneKey(u?.phone);
      if (k2) agentKeys.add(k2);
      if (u?.email && e.data.email && u.email.toLowerCase() === e.data.email.toLowerCase()) throw new IngestRejection(422, 'SELF_REFERRAL', 'نماینده نمی‌تواند مشتری خودش باشد');
    }
    const custKey = phoneKey(e.data.phone);
    if (custKey && agentKeys.has(custKey)) throw new IngestRejection(422, 'SELF_REFERRAL', 'نماینده نمی‌تواند مشتری خودش باشد');
    const ce = membership.resellerProfile.contact.email;
    if (ce && e.data.email && ce.toLowerCase() === e.data.email.toLowerCase()) throw new IngestRejection(422, 'SELF_REFERRAL', 'نماینده نمی‌تواند مشتری خودش باشد');

    const existing = await tx.agentCustomer.findUnique({ where: { productId_externalCustomerId: { productId, externalCustomerId: e.data.externalCustomerId } } });
    if (existing && existing.membershipId !== membership.id) throw new IngestRejection(409, 'CUSTOMER_ALREADY_ATTRIBUTED', 'این مشتری قبلاً به نماینده‌ی دیگری نسبت داده شده است');
    if (existing) {
      await tx.agentCustomer.update({ where: { id: existing.id }, data: { name: e.data.name, phone: e.data.phone ?? existing.phone, email: e.data.email ?? existing.email } });
      await this.setStage(tx, existing.id, existing.funnelStage, stageAfterEvent(existing.funnelStage as FunnelStage, 'customer.registered'), e.eventId);
      return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: existing.id, existing: true } };
    }
    const c = await tx.agentCustomer.create({
      data: { productId, membershipId: membership.id, externalCustomerId: e.data.externalCustomerId, name: e.data.name, phone: e.data.phone, email: e.data.email, funnelStage: 'REGISTERED', registeredAt: e.occurredAt },
    });
    await tx.agentCustomerStageLog.create({ data: { customerId: c.id, fromStage: null, toStage: 'REGISTERED', source: 'EVENT', note: e.eventId } });
    return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: c.id } };
  }

  private async findCustomer(tx: Db, productId: string, externalCustomerId: string) {
    return tx.agentCustomer.findUnique({ where: { productId_externalCustomerId: { productId, externalCustomerId } } });
  }

  private async onSubscription(tx: Db, productId: string, e: Extract<NormalizedEvent, { type: 'subscription.activated' | 'subscription.renewed' }>, base: Awaited<ReturnType<typeof loadBaseCurrency>>): Promise<IngestOutcome> {
    // دفتر مرکزی: هر پرداخت واقعی (حتی مشتری بدون نماینده) ثبت می‌شود و پورسانت از همین‌جا محاسبه می‌شود
    let ledger: RecordResult | null = null;
    if (!e.data.isTrial) {
      ledger = await recordTransaction(tx as unknown as Tx, productId, {
        externalTxId: e.data.paymentRef,
        externalCustomerId: e.data.externalCustomerId,
        txTypeCode: 'SUBSCRIPTION',
        itemCode: e.data.planCode,
        itemName: e.data.planName,
        occurrence: null,
        grossAmount: null,
        discountAmount: null,
        taxAmount: null,
        netAmount: toBaseUnit(e.data.amount, e.data.currency, base),
        currency: base.code,
        originalCurrency: e.data.currency,
        originalNetAmount: e.data.amount,
        paidAt: e.data.paidAt,
        periodEnd: e.data.periodEnd,
        refundOfExternalTxId: null,
        inboundEventId: e.eventId,
      });
    }
    const c = await this.findCustomer(tx, productId, e.data.externalCustomerId);
    if (!c) return { status: ledger ? 'ACCEPTED' : 'IGNORED', eventId: e.eventId, detail: { reason: 'CUSTOMER_NOT_REFERRED', ...(ledger ? { transactionId: ledger.transactionId } : {}) } };
    const next = stageAfterEvent(c.funnelStage as FunnelStage, e.type, { isTrial: e.data.isTrial });
    const common = {
      planCode: e.data.planCode,
      planName: e.data.planName,
      status: 'ACTIVE',
      cancelledAt: null as Date | null,
      nextRenewalAt: !c.nextRenewalAt || e.data.periodEnd.getTime() >= c.nextRenewalAt.getTime() ? e.data.periodEnd : c.nextRenewalAt,
    };
    if (e.data.isTrial) {
      await tx.agentCustomer.update({ where: { id: c.id }, data: common });
      await this.setStage(tx, c.id, c.funnelStage, next, e.eventId);
      return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: c.id, trial: true } };
    }
    const amount = toBaseUnit(e.data.amount, e.data.currency, base);
    const prior = await tx.agentPaymentEvent.count({ where: { customerId: c.id, type: { in: ['PAYMENT_FIRST', 'PAYMENT_RENEWAL'] } } });
    const type = prior === 0 ? 'PAYMENT_FIRST' : 'PAYMENT_RENEWAL';
    await tx.agentPaymentEvent.create({
      data: {
        productId,
        membershipId: c.membershipId,
        customerId: c.id,
        type,
        paymentRef: e.data.paymentRef,
        amount,
        currency: base.code,
        originalCurrency: e.data.currency,
        originalAmount: e.data.amount,
        planCode: e.data.planCode,
        planName: e.data.planName,
        paidAt: e.data.paidAt,
        periodEnd: e.data.periodEnd,
        inboundEventId: e.eventId,
      },
    });
    await tx.agentCustomer.update({
      where: { id: c.id },
      data: { ...common, lastPaymentAt: !c.lastPaymentAt || e.data.paidAt.getTime() > c.lastPaymentAt.getTime() ? e.data.paidAt : c.lastPaymentAt },
    });
    await this.setStage(tx, c.id, c.funnelStage, type === 'PAYMENT_RENEWAL' ? stageAfterEvent(c.funnelStage as FunnelStage, 'subscription.renewed') : next, e.eventId);
    return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: c.id, ledgerType: type, ...(ledger ? { transactionId: ledger.transactionId, commissionStatus: ledger.commissionStatus, commission: ledger.commission?.amount ?? 0 } : {}) } };
  }

  private async onCancelled(tx: Db, productId: string, e: Extract<NormalizedEvent, { type: 'subscription.cancelled' }>): Promise<IngestOutcome> {
    const c = await this.findCustomer(tx, productId, e.data.externalCustomerId);
    if (!c) return { status: 'IGNORED', eventId: e.eventId, detail: { reason: 'CUSTOMER_NOT_REFERRED' } };
    await tx.agentCustomer.update({ where: { id: c.id }, data: { status: 'CANCELLED', cancelledAt: e.occurredAt, nextRenewalAt: null } });
    await this.setStage(tx, c.id, c.funnelStage, stageAfterEvent(c.funnelStage as FunnelStage, 'subscription.cancelled'), e.data.reason ?? e.eventId);
    return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: c.id } };
  }

  /** هر تراکنش محصول → دفتر مرکزی + پورسانت. مشتریِ نماینده‌دار: تاریخ آخرین پرداخت/تمدید بعدی هم به‌روز می‌شود. */
  private async onTransaction(tx: Db, productId: string, e: Extract<NormalizedEvent, { type: 'transaction.recorded' }>, base: Awaited<ReturnType<typeof loadBaseCurrency>>): Promise<IngestOutcome> {
    const d = e.data;
    const toBase = (v: number | null) => (v === null ? null : toBaseUnit(v, d.currency, base));
    const r = await recordTransaction(tx as unknown as Tx, productId, {
      externalTxId: d.transactionId,
      externalCustomerId: d.externalCustomerId,
      txTypeCode: d.txType,
      itemCode: d.itemCode,
      itemName: d.itemName,
      occurrence: d.occurrence,
      grossAmount: toBase(d.grossAmount),
      discountAmount: toBase(d.discountAmount),
      taxAmount: toBase(d.taxAmount),
      netAmount: toBaseUnit(d.netAmount, d.currency, base),
      currency: base.code,
      originalCurrency: d.currency,
      originalNetAmount: d.netAmount,
      paidAt: d.paidAt,
      periodEnd: d.periodEnd,
      refundOfExternalTxId: d.refundOf,
      inboundEventId: e.eventId,
    });
    if (r.duplicate) return { status: 'DUPLICATE', eventId: e.eventId, detail: { transactionId: r.transactionId } };
    if (!d.refundOf) {
      const c = await this.findCustomer(tx, productId, d.externalCustomerId);
      if (c) {
        await tx.agentCustomer.update({
          where: { id: c.id },
          data: {
            lastPaymentAt: !c.lastPaymentAt || d.paidAt.getTime() > c.lastPaymentAt.getTime() ? d.paidAt : c.lastPaymentAt,
            ...(d.periodEnd && (!c.nextRenewalAt || d.periodEnd.getTime() >= c.nextRenewalAt.getTime()) ? { nextRenewalAt: d.periodEnd, status: 'ACTIVE', cancelledAt: null } : {}),
          },
        });
        await this.setStage(tx, c.id, c.funnelStage, stageAfterEvent(c.funnelStage as FunnelStage, r.occurrence === 'RENEWAL' ? 'subscription.renewed' : 'subscription.activated'), e.eventId);
      }
    }
    return {
      status: 'ACCEPTED',
      eventId: e.eventId,
      detail: { transactionId: r.transactionId, occurrence: r.occurrence, commissionStatus: r.commissionStatus, commission: r.commission?.amount ?? 0 },
    };
  }

  private async onRefund(tx: Db, productId: string, e: Extract<NormalizedEvent, { type: 'payment.refunded' }>, base: Awaited<ReturnType<typeof loadBaseCurrency>>): Promise<IngestOutcome> {
    // دفتر مرکزی: اگر پرداخت اصلی آنجاست، بازپرداخت ثبت و پورسانتش به‌نسبت برگشت می‌خورد
    const ledgerOriginal = await tx.agentTransaction.findUnique({ where: { productId_externalTxId: { productId, externalTxId: e.data.paymentRef } } });
    let ledger: RecordResult | null = null;
    if (ledgerOriginal) {
      ledger = await recordTransaction(tx as unknown as Tx, productId, {
        externalTxId: `${e.data.paymentRef}:r:${e.eventId}`,
        externalCustomerId: e.data.externalCustomerId ?? ledgerOriginal.externalCustomerId,
        txTypeCode: ledgerOriginal.txTypeCode,
        itemCode: ledgerOriginal.itemCode,
        itemName: ledgerOriginal.itemName,
        occurrence: null,
        grossAmount: null,
        discountAmount: null,
        taxAmount: null,
        netAmount: toBaseUnit(e.data.amount, e.data.currency, base),
        currency: base.code,
        originalCurrency: e.data.currency,
        originalNetAmount: e.data.amount,
        paidAt: e.occurredAt,
        periodEnd: null,
        refundOfExternalTxId: e.data.paymentRef,
        inboundEventId: e.eventId,
      });
    }
    const original = await tx.agentPaymentEvent.findFirst({ where: { productId, paymentRef: e.data.paymentRef, type: { in: ['PAYMENT_FIRST', 'PAYMENT_RENEWAL'] } } });
    if (!original) return { status: ledger ? 'ACCEPTED' : 'IGNORED', eventId: e.eventId, detail: ledger ? { transactionId: ledger.transactionId } : { reason: 'PAYMENT_NOT_FOUND' } };
    if (e.data.externalCustomerId) {
      const c = await this.findCustomer(tx, productId, e.data.externalCustomerId);
      if (!c || c.id !== original.customerId) throw new IngestRejection(422, 'PAYMENT_CUSTOMER_MISMATCH', 'شناسه‌ی پرداخت به این مشتری تعلق ندارد');
    }
    const amount = toBaseUnit(e.data.amount, e.data.currency, base);
    const refunded = await tx.agentPaymentEvent.aggregate({ _sum: { amount: true }, where: { productId, type: 'REFUND', paymentRef: { startsWith: `${e.data.paymentRef}:r:` } } });
    if (amount <= 0) throw new IngestRejection(422, 'INVALID_REFUND', 'مبلغ بازپرداخت باید مثبت باشد');
    if ((refunded._sum.amount ?? 0) + amount > original.amount) throw new IngestRejection(422, 'REFUND_EXCEEDS_PAYMENT', 'جمع بازپرداخت‌ها از مبلغ پرداخت بیشتر می‌شود');
    await tx.agentPaymentEvent.create({
      data: {
        productId,
        membershipId: original.membershipId,
        customerId: original.customerId,
        type: 'REFUND',
        paymentRef: `${e.data.paymentRef}:r:${e.eventId}`,
        amount,
        currency: base.code,
        originalCurrency: e.data.currency,
        originalAmount: e.data.amount,
        planCode: original.planCode,
        planName: original.planName,
        paidAt: e.occurredAt,
        inboundEventId: e.eventId,
      },
    });
    return { status: 'ACCEPTED', eventId: e.eventId, detail: { customerId: original.customerId } };
  }
}
