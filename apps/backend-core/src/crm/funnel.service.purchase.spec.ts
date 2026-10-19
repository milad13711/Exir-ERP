import { describe, expect, it, vi } from 'vitest';
import { FunnelService } from './funnel.service.js';
import { logInitialFunnelEvent } from './funnel-events.js';
import type { TenantRequestContext } from '../common/request-context.js';

type Contact = Record<string, any>;

function setup(initial: Partial<Contact> = {}) {
  const contact: Contact = {
    id: 'c1', name: 'علی', phone: '0912', funnelStage: 'NEW_LEAD', purchaseCount: 0, isBrandAmbassador: false,
    convertedAt: null, firstPurchaseAt: null, lastPurchaseAt: null, avgPurchaseGapDays: null, churnWarningAt: null, ownerUserId: null, ...initial,
  };
  const purchaseEvents: Contact[] = [];
  const stageEvents: Contact[] = [];
  const deals: Contact[] = [];
  const db: any = {
    crmContact: {
      findUnique: vi.fn(async () => ({ ...contact })),
      update: vi.fn(async ({ data }: any) => { Object.assign(contact, data); return contact; }),
    },
    crmFunnelStageEvent: { create: vi.fn(async ({ data }: any) => { stageEvents.push(data); return data; }) },
    crmDeal: { create: vi.fn(async ({ data }: any) => { deals.push(data); return data; }) },
    crmPurchaseEvent: {
      create: vi.fn(async ({ data }: any) => {
        if (purchaseEvents.some((e) => e.contactId === data.contactId && e.sourceType === data.sourceType && e.sourceId === data.sourceId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `pe${purchaseEvents.length + 1}`, occurredAt: new Date(), voidedAt: null, amount: 0, ...data };
        purchaseEvents.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.contactId_sourceType_sourceId;
        return purchaseEvents.find((e) => e.contactId === k.contactId && e.sourceType === k.sourceType && e.sourceId === k.sourceId) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const e = purchaseEvents.find((x) => x.id === where.id && x.voidedAt == null);
        if (!e) return { count: 0 };
        Object.assign(e, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async () => purchaseEvents.filter((e) => e.voidedAt == null)),
    },
  };
  const svc = new FunnelService({ emit: vi.fn() } as never);
  const ctx = { tenantDb: db, tenantId: 't' } as unknown as TenantRequestContext;
  return { svc, ctx, contact, purchaseEvents, stageEvents, deals, db };
}

describe('FunnelService purchase idempotency per source document', () => {
  it('counts a source document once even if recordPurchase is called twice (book invoice created, later paid)', async () => {
    const t = setup();
    await t.svc.recordPurchase(t.ctx, 'c1', 1000, 'x', { type: 'SALES_INVOICE', id: 'inv1' }); // book-store at payment time
    await t.svc.recordPurchase(t.ctx, 'c1', 1000, 'x', { type: 'SALES_INVOICE', id: 'inv1' }); // invoice later marked PAID
    expect(t.contact.purchaseCount).toBe(1);
    expect(t.contact.funnelStage).toBe('CUSTOMER');
    expect(t.purchaseEvents).toHaveLength(1);
    expect(t.deals).toHaveLength(0);
  });

  it('different sources count separately, producing REPEAT_CUSTOMER and a won deal', async () => {
    const t = setup();
    await t.svc.recordPurchase(t.ctx, 'c1', 1000, 'x', { type: 'STORE_ORDER', id: 'o1' });
    await t.svc.recordPurchase(t.ctx, 'c1', 500, 'x', { type: 'SALES_INVOICE', id: 'inv2' });
    expect(t.contact.purchaseCount).toBe(2);
    expect(t.contact.funnelStage).toBe('REPEAT_CUSTOMER');
    expect(t.deals).toHaveLength(1);
  });

  it('without a source it still counts (backwards compatible)', async () => {
    const t = setup();
    await t.svc.recordPurchase(t.ctx, 'c1', 1);
    await t.svc.recordPurchase(t.ctx, 'c1', 1);
    expect(t.contact.purchaseCount).toBe(2);
  });
});

describe('FunnelService.reversePurchase', () => {
  it('decrements, demotes REPEAT→CUSTOMER, recomputes dates, logs the stage event, voids (not deletes) the event', async () => {
    const t = setup();
    await t.svc.recordPurchase(t.ctx, 'c1', 1, 'x', { type: 'SALES_INVOICE', id: 'a' });
    await t.svc.recordPurchase(t.ctx, 'c1', 1, 'x', { type: 'SALES_INVOICE', id: 'b' });
    t.purchaseEvents[0].occurredAt = new Date('2026-01-01');
    t.purchaseEvents[1].occurredAt = new Date('2026-02-01');
    t.contact.firstPurchaseAt = new Date('2026-01-01');
    t.contact.lastPurchaseAt = new Date('2026-02-01');
    t.stageEvents.length = 0;
    const done = await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'b' });
    expect(done).toBe(true);
    expect(t.contact.purchaseCount).toBe(1);
    expect(t.contact.funnelStage).toBe('CUSTOMER');
    expect(t.contact.lastPurchaseAt).toEqual(new Date('2026-01-01'));
    expect(t.stageEvents).toEqual([expect.objectContaining({ fromStage: 'REPEAT_CUSTOMER', toStage: 'CUSTOMER' })]);
    expect(t.purchaseEvents).toHaveLength(2);
    expect(t.purchaseEvents[1].voidedAt).toBeInstanceOf(Date);
  });

  it('is idempotent and never goes below zero; a customer is never moved back to lead', async () => {
    const t = setup();
    await t.svc.recordPurchase(t.ctx, 'c1', 1, 'x', { type: 'SALES_INVOICE', id: 'a' });
    expect(await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'a' })).toBe(true);
    expect(await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'a' })).toBe(false);
    expect(t.contact.purchaseCount).toBe(0);
    expect(t.contact.firstPurchaseAt).toBeNull();
    expect(t.contact.funnelStage).toBe('CUSTOMER');
    // re-paying the voided source must not count again
    await t.svc.recordPurchase(t.ctx, 'c1', 1, 'x', { type: 'SALES_INVOICE', id: 'a' });
    expect(t.contact.purchaseCount).toBe(0);
  });

  it('legacy counted PAID invoice (no event row) is reversed once; a never-counted source is a no-op', async () => {
    const t = setup({ funnelStage: 'CUSTOMER', purchaseCount: 1, convertedAt: new Date() });
    expect(await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'z' })).toBe(false);
    expect(t.contact.purchaseCount).toBe(1);
    expect(await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'z' }, { legacyCounted: true })).toBe(true);
    expect(t.contact.purchaseCount).toBe(0);
    expect(await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'z' }, { legacyCounted: true })).toBe(false);
  });

  it('keeps BRAND_AMBASSADOR (referral-driven) when dropping below two purchases', async () => {
    const t = setup({ funnelStage: 'BRAND_AMBASSADOR', isBrandAmbassador: true, purchaseCount: 2, convertedAt: new Date() });
    await t.svc.reversePurchase(t.ctx, 'c1', { type: 'SALES_INVOICE', id: 'q' }, { legacyCounted: true });
    expect(t.contact.purchaseCount).toBe(1);
    expect(t.contact.funnelStage).toBe('BRAND_AMBASSADOR');
  });
});

describe('logInitialFunnelEvent', () => {
  it('records null → NEW_LEAD and swallows failures', async () => {
    const create = vi.fn(async () => ({}));
    await logInitialFunnelEvent({ crmFunnelStageEvent: { create } } as never, 'c9');
    expect(create).toHaveBeenCalledWith({ data: { contactId: 'c9', fromStage: null, toStage: 'NEW_LEAD' } });
    await expect(logInitialFunnelEvent({ crmFunnelStageEvent: { create: vi.fn(async () => { throw new Error('x'); }) } } as never, 'c9')).resolves.toBeUndefined();
  });
});
