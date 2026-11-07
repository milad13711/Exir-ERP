import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ReferralsService } from './referrals.service.js';
import { grantedEntityIds, hasEntityGrant, scopeWithGrants } from './referral-grants.js';
import { assertTaskLinkAllowed } from './task-link.js';
import { ctxFor, makeTenantDb, match, perm, user } from '../../test/helpers/referral-test-db.js';

const permissions = new PermissionsService();
const mkNotifications = () => ({ notify: vi.fn(async (..._args: any[]): Promise<void> => undefined) });
const mkService = (n = mkNotifications()) => ({ svc: new ReferralsService(permissions, n as never), n });

const U = [user('creator', 'سارا'), user('expert', 'علی'), user('other', 'رضا'), user('boss', 'مدیر'), user('disabled', 'غیرفعال', { status: 'DISABLED' }), user('adm', 'ادمین')];
const INV = { id: 'inv1', invoiceNo: 123, createdByUserId: 'creator', status: 'DRAFT' };

function seed(extra: Record<string, unknown[]> = {}) {
  return makeTenantDb({
    users: U,
    invoices: [INV, { id: 'inv2', invoiceNo: 124, createdByUserId: 'other', status: 'DRAFT' }, { id: 'inv3', invoiceNo: 125, createdByUserId: 'boss', status: 'DRAFT' }, { id: 'inv4', invoiceNo: 126, createdByUserId: 'creator', status: 'CONFIRMED' }],
    modulePerms: [
      perm('creator', 'sales', { canViewOwn: true, canEdit: true }),
      perm('other', 'sales', { canViewOwn: true }),
    ],
    ...extra,
  } as never);
}

const refRow = (p: Record<string, unknown> = {}) => ({ id: 'r1', entityType: 'SalesInvoice', entityId: 'inv1', fromUserId: 'creator', toUserId: 'expert', status: 'PENDING', createdAt: new Date(), ...p });

describe('access grant: grantedEntityIds / hasEntityGrant', () => {
  it('active referral (PENDING or ACCEPTED) grants view of exactly that entity', async () => {
    for (const status of ['PENDING', 'ACCEPTED']) {
      const db = seed({ referrals: [refRow({ status })] });
      expect(await grantedEntityIds(db, 'expert', 'SalesInvoice')).toEqual(['inv1']);
      expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1')).toBe(true);
      expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv2')).toBe(false); // سند دیگر
      expect(await hasEntityGrant(db, 'expert', 'SalesQuotation', 'inv1')).toBe(false); // نوع دیگر
      expect(await hasEntityGrant(db, 'other', 'SalesInvoice', 'inv1')).toBe(false); // کاربر دیگر
    }
  });

  it('RETURNED / CANCELLED / FORWARDED revoke both view and edit', async () => {
    for (const status of ['RETURNED', 'CANCELLED', 'FORWARDED']) {
      const db = seed({ referrals: [refRow({ status })] });
      for (const mode of ['view', 'edit'] as const) {
        expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1', mode)).toBe(false);
        expect(await grantedEntityIds(db, 'expert', 'SalesInvoice', mode)).toEqual([]);
      }
    }
  });

  it('active referral grants EDIT; DONE keeps VIEW permanently but no edit', async () => {
    for (const status of ['PENDING', 'ACCEPTED']) {
      expect(await hasEntityGrant(seed({ referrals: [refRow({ status })] }), 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(true);
    }
    const done = seed({ referrals: [refRow({ status: 'DONE' })] });
    expect(await hasEntityGrant(done, 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(true);
    expect(await hasEntityGrant(done, 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(false);
    expect(await grantedEntityIds(done, 'expert', 'SalesInvoice')).toEqual(['inv1']);
    expect(await grantedEntityIds(done, 'expert', 'SalesInvoice', 'edit')).toEqual([]);
    // فقط همان سند، همان کاربر
    expect(await hasEntityGrant(done, 'other', 'SalesInvoice', 'inv1')).toBe(false);
    expect(await hasEntityGrant(done, 'expert', 'SalesInvoice', 'inv2')).toBe(false);
  });

  it('an open task grants VIEW only — never edit; closed task grants neither', async () => {
    const task = { id: 't1', isPublished: true, status: 'IN_PROGRESS', relatedModule: 'sales', relatedEntityId: 'inv1', assignedUserId: null, assignees: [{ userId: 'expert' }] };
    expect(await hasEntityGrant(seed({ tasks: [task] }), 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(true);
    expect(await hasEntityGrant(seed({ tasks: [task] }), 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(false);
    expect(await grantedEntityIds(seed({ tasks: [task] }), 'expert', 'SalesInvoice', 'edit')).toEqual([]);
    expect(await permissions.hasEditGrant(ctxFor(seed({ tasks: [task] }), 'expert'), 'SalesInvoice', 'inv1')).toBe(false);
    expect(await hasEntityGrant(seed({ tasks: [{ ...task, status: 'APPROVED' }] }), 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(false);
  });
});

describe('scopeWithGrants / PermissionsService.viewScopeGranted', () => {
  it('view-all and managers stay unrestricted ({}), no extra queries needed', async () => {
    const db = seed({ modulePerms: [perm('boss', 'sales', { canViewAll: true })] });
    expect(await permissions.viewScopeGranted(ctxFor(db, 'boss'), 'sales', 'createdByUserId', 'SalesInvoice')).toEqual({});
    expect(await permissions.viewScopeGranted(ctxFor(db, 'x', 'OWNER'), 'sales', 'createdByUserId', 'SalesInvoice')).toEqual({});
  });

  it('view-own without grants is exactly the old own-scope', async () => {
    const db = seed();
    expect(await permissions.viewScopeGranted(ctxFor(db, 'other'), 'sales', 'createdByUserId', 'SalesInvoice')).toEqual({ createdByUserId: 'other' });
  });

  it('view-own + grant = own OR the granted ids (AND-wrapped so callers OR keys survive)', async () => {
    const db = seed({ referrals: [refRow({ toUserId: 'other' })] });
    const scope = await permissions.viewScopeGranted(ctxFor(db, 'other'), 'sales', 'createdByUserId', 'SalesInvoice');
    expect(scope).toEqual({ AND: [{ OR: [{ createdByUserId: 'other' }, { id: { in: ['inv1'] } }] }] });
    // و روی داده‌ی واقعی: فاکتور خودش + فاکتور ارجاع‌شده، نه چیز دیگر
    expect(db.salesInvoice.rows.filter((r: any) => match(r, scope)).map((r: any) => r.id).sort()).toEqual(['inv1', 'inv2']);
  });

  it('user with NO module access sees only the single referred entity', async () => {
    const db = seed({ referrals: [refRow()] });
    const scope = await permissions.viewScopeGranted(ctxFor(db, 'expert'), 'sales', 'createdByUserId', 'SalesInvoice');
    expect(scope).toEqual({ AND: [{ id: { in: ['inv1'] } }] });
  });

  it('no access and no grant: still Forbidden (grants do not open anything else)', async () => {
    await expect(permissions.viewScopeGranted(ctxFor(seed(), 'expert'), 'sales', 'createdByUserId', 'SalesInvoice')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('strict viewScope (used by writes) is NOT widened by grants', async () => {
    const db = seed({ referrals: [refRow()] });
    await expect(permissions.viewScope(ctxFor(db, 'expert'), 'sales', 'createdByUserId')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('non-admin API key (no tenant user id) never gets grants', async () => {
    const db = seed({ referrals: [refRow()] });
    const ctx = { tenantDb: db, auth: { type: 'api_key', sub: 'k', role: 'MEMBER' }, tenantId: 't1' } as never;
    await expect(scopeWithGrants(ctx, 'SalesInvoice', async () => { throw new ForbiddenException('x'); })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('edit grant via PermissionsService / controller routes', () => {
  it('hasEditGrant: active referral yes; DONE no; other user no; manager-less API key no', async () => {
    expect(await permissions.hasEditGrant(ctxFor(seed({ referrals: [refRow()] }), 'expert'), 'SalesInvoice', 'inv1')).toBe(true);
    expect(await permissions.hasEditGrant(ctxFor(seed({ referrals: [refRow({ status: 'DONE' })] }), 'expert'), 'SalesInvoice', 'inv1')).toBe(false);
    expect(await permissions.hasEditGrant(ctxFor(seed({ referrals: [refRow()] }), 'other'), 'SalesInvoice', 'inv1')).toBe(false);
    const apiCtx = { tenantDb: seed({ referrals: [refRow()] }), auth: { type: 'api_key', sub: 'k', role: 'MEMBER' }, tenantId: 't1' } as never;
    expect(await permissions.hasEditGrant(apiCtx, 'SalesInvoice', 'inv1')).toBe(false);
  });

  it('tenant isolation: a grant in tenant A is not visible in tenant B DB', async () => {
    const dbB = makeTenantDb({ users: U } as never);
    expect(await permissions.hasEditGrant(ctxFor(dbB, 'expert', 'MEMBER', 'tB'), 'SalesInvoice', 'inv1')).toBe(false);
  });

  it('InvoicesController.updateDraft: grantee edits without module permission; after DONE it is forbidden; delete/cancel/confirm/payments never open', async () => {
    const { InvoicesController } = await import('../sales/invoices.controller.js');
    const invoices = { updateDraft: vi.fn(async () => 'ok'), removeDraft: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), recordPayment: vi.fn() } as any;
    const mk = (db: any) => new (InvoicesController as any)(invoices, permissions, {}, {}, {}, {}) as InstanceType<typeof InvoicesController>;
    const active = seed({ referrals: [refRow()] });
    const c = mk(active);
    await expect(c.updateDraft('inv1', {} as never, ctxFor(active, 'expert'))).resolves.toBe('ok');
    await expect(c.removeDraft('inv1', ctxFor(active, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.cancel('inv1', { reason: 'xxxx' }, ctxFor(active, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.confirm('inv1', ctxFor(active, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.recordPayment('inv1', {} as never, ctxFor(active, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    // IDOR: grant on inv1 does not allow editing inv2
    await expect(c.updateDraft('inv2', {} as never, ctxFor(active, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    for (const status of ['DONE', 'RETURNED', 'CANCELLED']) {
      const db = seed({ referrals: [refRow({ status })] });
      await expect(mk(db).updateDraft('inv1', {} as never, ctxFor(db, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(invoices.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('attachments: grantee can add/remove on an active referral, only read after DONE', async () => {
    const { AttachmentAccessService } = await import('../attachments/attachment-access.service.js');
    const svc = new AttachmentAccessService(permissions, {} as never);
    const active = seed({ referrals: [refRow()] });
    await expect(svc.assertAccess(ctxFor(active, 'expert'), 'SalesInvoice', 'inv1', 'write')).resolves.toBeUndefined();
    await expect(svc.assertAccess(ctxFor(active, 'expert'), 'SalesInvoice', 'inv2', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    const done = seed({ referrals: [refRow({ status: 'DONE' })] });
    await expect(svc.assertAccess(ctxFor(done, 'expert'), 'SalesInvoice', 'inv1', 'read')).resolves.toBeUndefined();
    await expect(svc.assertAccess(ctxFor(done, 'expert'), 'SalesInvoice', 'inv1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertAccess(ctxFor(done, 'expert'), 'SalesInvoice', 'inv1', 'delete')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ReferralsService.refer', () => {
  it('creates a referral, notifies the recipient with a clear title, deep link and approvals category', async () => {
    const db = seed();
    const { svc, n } = mkService();
    const res = await svc.refer(ctxFor(db, 'creator'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert', note: 'لطفاً پیگیری کنید' });
    expect(res.status).toBe('PENDING');
    expect(res.duplicate).toBe(false);
    expect(db.documentReferral.rows).toHaveLength(1);
    expect(n.notify).toHaveBeenCalledTimes(1);
    const call = (n.notify.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(call).toMatchObject({ userId: 'expert', title: 'فاکتور 123 به شما ارجاع شد', link: '/referrals/view?type=SalesInvoice&id=inv1', category: 'approvals', entityType: 'DocumentReferral' });
    expect(String(call.body)).toContain('سارا');
    expect(String(call.body)).toContain('لطفاً پیگیری کنید');
    // بعد از ارجاع گیرنده سند را می‌بیند
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1')).toBe(true);
  });

  it('is idempotent: same recipient again returns the active referral without a second row or notification', async () => {
    const db = seed();
    const { svc, n } = mkService();
    const ctx = ctxFor(db, 'creator');
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    const again = await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    expect(again.duplicate).toBe(true);
    expect(db.documentReferral.rows).toHaveLength(1);
    expect(n.notify).toHaveBeenCalledTimes(1);
  });

  it('idempotencyKey replays the same result and rejects reuse for a different document', async () => {
    const db = seed();
    const { svc } = mkService();
    const ctx = ctxFor(db, 'creator');
    const a = await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert', idempotencyKey: 'k1' });
    const b = await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert', idempotencyKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    await expect(svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv2', toUserId: 'expert', idempotencyKey: 'k1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('re-referring to someone else replaces the responsible expert (old one FORWARDED, loses access, is told)', async () => {
    const db = seed();
    const { svc, n } = mkService();
    const ctx = ctxFor(db, 'creator');
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'other' });
    const statuses = db.documentReferral.rows.map((r: any) => `${r.toUserId}:${r.status}`);
    expect(statuses).toEqual(['expert:FORWARDED', 'other:PENDING']);
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1')).toBe(false);
    expect(await hasEntityGrant(db, 'other', 'SalesInvoice', 'inv1')).toBe(true);
    expect(n.notify.mock.calls.some((c) => (c[1] as { type: string; userId: string }).type === 'referral.forwarded' && (c[1] as { userId: string }).userId === 'expert')).toBe(true);
    const info = await svc.forEntity(ctx, 'SalesInvoice', 'inv1');
    expect(info.current?.toName).toBe('رضا');
    expect(info.history).toHaveLength(2);
  });

  it('additional=true adds a co-assignee instead of replacing', async () => {
    const db = seed();
    const { svc } = mkService();
    const ctx = ctxFor(db, 'creator');
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'other', additional: true });
    expect(db.documentReferral.rows.map((r: any) => r.status)).toEqual(['PENDING', 'PENDING']);
  });

  it('who may refer: stranger / view-only non-owner is Forbidden; the current assignee may forward', async () => {
    const db = seed({ modulePerms: [perm('creator', 'sales', { canViewOwn: true, canEdit: true }), perm('other', 'sales', { canViewAll: true })] });
    const { svc } = mkService();
    // «other» می‌بیند ولی نه ویرایش دارد نه صاحب است
    await expect(svc.refer(ctxFor(db, 'other'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' })).rejects.toBeInstanceOf(ForbiddenException);
    await svc.refer(ctxFor(db, 'creator'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    // مسئول فعلی می‌تواند ارجاع مجدد دهد
    const fwd = await svc.refer(ctxFor(db, 'expert'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'other' });
    expect(fwd.status).toBe('PENDING');
  });

  it('manager (OWNER/ADMIN) may refer any document', async () => {
    const db = seed({ users: U });
    const { svc } = mkService();
    const r = await svc.refer(ctxFor(db, 'adm', 'ADMIN'), { entityType: 'SalesInvoice', entityId: 'inv2', toUserId: 'expert' });
    expect(r.status).toBe('PENDING');
  });

  it('rejects self-referral, unknown type, disabled/unknown target', async () => {
    const db = seed();
    const { svc } = mkService();
    const ctx = ctxFor(db, 'creator');
    await expect(svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'creator' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.refer(ctx, { entityType: 'Nope', entityId: 'inv1', toUserId: 'expert' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'disabled' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'ghost' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('IDOR: a user cannot refer (or even probe) a document outside their scope — 404 like a missing one', async () => {
    const db = seed();
    const { svc } = mkService();
    // «other» فقط فاکتور خودش را می‌بیند؛ inv1 مال creator است
    await expect(svc.refer(ctxFor(db, 'other'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.forEntity(ctxFor(db, 'other'), 'SalesInvoice', 'inv1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant isolation: the same ids in another tenant DB are simply not found', async () => {
    const dbB = makeTenantDb({ users: U, invoices: [], referrals: [] } as never);
    const { svc } = mkService();
    await expect(svc.refer(ctxFor(dbB, 'creator', 'ADMIN', 'tB'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' })).rejects.toBeInstanceOf(NotFoundException);
    expect(dbB.documentReferral.rows).toHaveLength(0);
  });
});

describe('ReferralsService.respond (accept / return / complete / cancel)', () => {
  const base = () => seed({ referrals: [refRow()] });

  it('only the recipient accepts; accept notifies the referrer; grant stays', async () => {
    const db = base();
    const { svc, n } = mkService();
    await expect(svc.respond(ctxFor(db, 'creator'), 'r1', 'accept')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.respond(ctxFor(db, 'other'), 'r1', 'accept')).rejects.toBeInstanceOf(NotFoundException); // IDOR: stranger can't even see it
    const r = await svc.respond(ctxFor(db, 'expert'), 'r1', 'accept');
    expect(r.status).toBe('ACCEPTED');
    expect((n.notify.mock.calls[0][1] as { userId: string }).userId).toBe('creator');
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1')).toBe(true);
  });

  it('complete: view stays, edit is revoked; return: everything is revoked', async () => {
    const db1 = base();
    const { svc } = mkService();
    const r = await svc.respond(ctxFor(db1, 'expert'), 'r1', 'complete', 'تمام شد');
    expect(r.status).toBe('DONE');
    expect(await hasEntityGrant(db1, 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(true);
    expect(await hasEntityGrant(db1, 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(false);
    // نشان تکمیل و عدم نمایش مسئول فعلی
    const info = await svc.forEntity(ctxFor(db1, 'creator'), 'SalesInvoice', 'inv1');
    expect(info.current).toBeNull();
    expect(info.completed?.toName).toBe('علی');
    const db2 = base();
    await svc.respond(ctxFor(db2, 'expert'), 'r1', 'return');
    expect(await hasEntityGrant(db2, 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(false);
    expect(await hasEntityGrant(db2, 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(false);
  });

  it('cancel by referrer or manager revokes; recipient/strangers cannot cancel', async () => {
    const db = base();
    const { svc, n } = mkService();
    await expect(svc.respond(ctxFor(db, 'expert'), 'r1', 'cancel')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.respond(ctxFor(db, 'creator'), 'r1', 'cancel', 'اشتباه بود');
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1')).toBe(false);
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1', 'edit')).toBe(false);
    expect((n.notify.mock.calls.at(-1)![1] as { userId: string; type: string })).toMatchObject({ userId: 'expert', type: 'referral.cancelled' });
    const db2 = base();
    await mkService().svc.respond(ctxFor(db2, 'adm', 'ADMIN'), 'r1', 'cancel');
    expect(db2.documentReferral.rows[0].status).toBe('CANCELLED');
  });

  it('state machine: finished referrals cannot be acted on again (409)', async () => {
    const db = base();
    const { svc } = mkService();
    await svc.respond(ctxFor(db, 'expert'), 'r1', 'complete');
    await expect(svc.respond(ctxFor(db, 'expert'), 'r1', 'accept')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.respond(ctxFor(db, 'expert'), 'r1', 'complete')).rejects.toBeInstanceOf(ConflictException);
  });

  it('completeActiveFor (e.g. report paraph) closes the recipient referral', async () => {
    const db = base();
    const { svc } = mkService();
    await svc.completeActiveFor(ctxFor(db, 'expert'), 'SalesInvoice', 'inv1', 'expert', 'پاراف شد');
    expect(db.documentReferral.rows[0].status).toBe('DONE');
  });
});

describe('ReferralsService reads', () => {
  it('inbox lists only my referrals; sent view lists mine as sender; counts reflect active/overdue', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const db = seed({ referrals: [refRow(), refRow({ id: 'r2', entityId: 'inv2', toUserId: 'other', status: 'ACCEPTED', dueAt: past }), refRow({ id: 'r3', status: 'DONE' })] });
    const { svc } = mkService();
    const mine = await svc.inbox(ctxFor(db, 'expert'), 'active');
    expect(mine.map((r: any) => r.id)).toEqual(['r1']);
    expect(mine[0]).toMatchObject({ link: '/referrals/view?type=SalesInvoice&id=inv1', fromName: 'سارا', statusLabel: 'در انتظار پذیرش' });
    expect((await svc.inbox(ctxFor(db, 'expert'), 'done')).map((r: any) => r.id)).toEqual(['r3']);
    expect((await svc.inbox(ctxFor(db, 'creator'), 'sent')).map((r: any) => r.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(await svc.counts(ctxFor(db, 'other'))).toMatchObject({ pending: 0, accepted: 1, overdue: 1 });
  });

  it('assignees(): returns responsible names only for documents the caller can see', async () => {
    const db = seed({ referrals: [refRow(), refRow({ id: 'r2', entityId: 'inv2', toUserId: 'creator', fromUserId: 'other' })] });
    const { svc } = mkService();
    const asCreator = await svc.assignees(ctxFor(db, 'creator'), 'SalesInvoice', ['inv1', 'inv2']);
    expect(Object.keys(asCreator).sort()).toEqual(['inv1', 'inv2']); // inv2 به creator ارجاع شده → می‌بیند
    expect(asCreator.inv1.name).toBe('علی');
    const asOther = await svc.assignees(ctxFor(db, 'other'), 'SalesInvoice', ['inv1', 'inv2']);
    expect(Object.keys(asOther)).toEqual(['inv2']); // inv1 خارج از دامنه‌ی other است: نام مسئول افشا نمی‌شود
  });
});

describe('task link validation', () => {
  it('creator must see the linked document; unmapped modules are untouched; managers pass', async () => {
    const db = seed();
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'other'), 'sales', 'inv1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'creator'), 'sales', 'inv1')).resolves.toBeUndefined();
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'other'), 'daily-checklist', 'x')).resolves.toBeUndefined();
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'adm', 'OWNER'), 'sales', 'inv1')).resolves.toBeUndefined();
  });

  it('the active referral assignee may link tasks to the document', async () => {
    const db = seed({ referrals: [refRow()] });
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'expert'), 'sales', 'inv1')).resolves.toBeUndefined();
  });
});

describe('security regressions', () => {
  it('grants-only scope can never override the requested id (two grants + a third id)', async () => {
    const db = seed({ referrals: [refRow(), refRow({ id: 'r2', entityId: 'inv3' })] });
    const ctx = ctxFor(db, 'expert');
    const scope = await permissions.viewScopeGranted(ctx, 'sales', 'createdByUserId', 'SalesInvoice');
    const rows = db.salesInvoice.rows;
    const find = (id: string) => rows.find((r: any) => match(r, { id, ...scope }));
    expect(find('inv1')?.id).toBe('inv1');
    expect(find('inv3')?.id).toBe('inv3');
    expect(find('inv2')).toBeUndefined(); // سوم، بدون ارجاع
    expect(find('inv4')).toBeUndefined();
  });

  it('IDOR through every service entry point for a third id', async () => {
    const db = seed({ referrals: [refRow(), refRow({ id: 'r2', entityId: 'inv3' })] });
    const { svc } = mkService();
    const ctx = ctxFor(db, 'expert');
    await expect(svc.forEntity(ctx, 'SalesInvoice', 'inv2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv2', toUserId: 'other' })).rejects.toBeInstanceOf(NotFoundException);
    expect(Object.keys(await svc.assignees(ctx, 'SalesInvoice', ['inv1', 'inv2', 'inv3'])).sort()).toEqual(['inv1', 'inv3']); // inv2 مخفی
    const { AttachmentAccessService } = await import('../attachments/attachment-access.service.js');
    const att = new AttachmentAccessService(permissions, {} as never);
    await expect(att.assertAccess(ctx, 'SalesInvoice', 'inv1', 'read')).resolves.toBeUndefined();
    await expect(att.assertAccess(ctx, 'SalesInvoice', 'inv3', 'read')).resolves.toBeUndefined();
    await expect(att.assertAccess(ctx, 'SalesInvoice', 'inv2', 'read')).rejects.toBeInstanceOf(NotFoundException);
    const { assertInScope } = await import('../permissions/scope.util.js');
    const scope = await permissions.viewScopeGranted(ctx, 'sales', 'createdByUserId', 'SalesInvoice');
    await expect(assertInScope(db.salesInvoice, scope, { id: 'inv2' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attachment write/delete by referral grant is blocked on confirmed/issued documents; allowed on drafts', async () => {
    const { AttachmentAccessService } = await import('../attachments/attachment-access.service.js');
    const att = new AttachmentAccessService(permissions, {} as never);
    const db = seed({ referrals: [refRow({ entityId: 'inv4' }), refRow({ id: 'r2' })] });
    await expect(att.assertAccess(ctxFor(db, 'expert'), 'SalesInvoice', 'inv4', 'write')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(att.assertAccess(ctxFor(db, 'expert'), 'SalesInvoice', 'inv4', 'delete')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(att.assertAccess(ctxFor(db, 'expert'), 'SalesInvoice', 'inv1', 'write')).resolves.toBeUndefined();
  });

  it('a task never grants attachment write', async () => {
    const { AttachmentAccessService } = await import('../attachments/attachment-access.service.js');
    const att = new AttachmentAccessService(permissions, {} as never);
    const task = { id: 't1', isPublished: true, status: 'NEW', relatedModule: 'sales', relatedEntityId: 'inv1', assignedUserId: null, assignees: [{ userId: 'expert' }] };
    const db = seed({ tasks: [task] });
    await expect(att.assertAccess(ctxFor(db, 'expert'), 'SalesInvoice', 'inv1', 'read')).resolves.toBeUndefined();
    await expect(att.assertAccess(ctxFor(db, 'expert'), 'SalesInvoice', 'inv1', 'write')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grant-edit strips ownership/access fields: project manager+members, contract signer, proposal assignee', async () => {
    const referral = (entityType: string, entityId: string) => refRow({ entityType, entityId });
    const { ProjectsController } = await import('../projects/projects.controller.js');
    const projects = { update: vi.fn(async (..._a: any[]) => 'ok') } as any;
    const pdb = seed({ referrals: [referral('Project', 'p1')], projects: [{ id: 'p1', contactId: null, status: 'ACTIVE' }] });
    const pc = new (ProjectsController as any)(projects, {}, permissions, {}, {});
    await pc.update('p1', { name: 'x', managerUserId: 'evil', memberUserIds: ['evil'] }, ctxFor(pdb, 'expert'));
    expect(projects.update.mock.calls[0][2]).toEqual({ name: 'x' });

    const { ContractsController } = await import('../contracts/contracts.controller.js');
    const contracts = { update: vi.fn(async (..._a: any[]) => 'ok') } as any;
    const cdb = seed({ referrals: [referral('Contract', 'c1')], contracts: [{ id: 'c1', contactId: null, status: 'DRAFT' }] });
    const cc = new (ContractsController as any)(contracts, permissions, {}, {}, {});
    await cc.update('c1', { title: 't', referredSignerUserId: 'evil' }, ctxFor(cdb, 'expert'));
    expect(contracts.update.mock.calls[0][2]).toEqual({ title: 't' });

    const { ProposalsController } = await import('../proposals/proposals.controller.js');
    const proposals = { update: vi.fn(async (..._a: any[]) => 'ok') } as any;
    const prc = new (ProposalsController as any)(proposals, {}, permissions);
    await prc.update('pp1', { title: 'T', assignedUserId: 'evil' }, ctxFor(seed({ referrals: [referral('Proposal', 'pp1')] }), 'expert'));
    expect(proposals.update.mock.calls[0][2]).toEqual({ title: 'T' });
  });

  it('grant-edit cannot re-point an invoice to a contact outside the editor strict CRM scope', async () => {
    const { InvoicesController } = await import('../sales/invoices.controller.js');
    const invoices = { updateDraft: vi.fn(async (..._a: any[]) => 'ok') } as any;
    const c = new (InvoicesController as any)(invoices, permissions, {}, {}, {}, {}) as InstanceType<typeof InvoicesController>;
    const db = seed({ referrals: [refRow()] });
    db.salesInvoice.rows[0].contactId = 'c-old';
    await expect(c.updateDraft('inv1', { contactId: 'c-new' } as never, ctxFor(db, 'expert'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.updateDraft('inv1', { contactId: 'c-old' } as never, ctxFor(db, 'expert'))).resolves.toBe('ok');
  });

  it('DONE referral can be REVOKED by managers (and boss of the referrer) with no notification; others cannot', async () => {
    const mkDone = () => seed({ referrals: [refRow({ status: 'DONE' })] });
    const { svc, n } = mkService();
    const db = mkDone();
    await expect(svc.respond(ctxFor(db, 'expert'), 'r1', 'revoke')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.respond(ctxFor(db, 'other'), 'r1', 'revoke')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(true);
    const r = await svc.respond(ctxFor(db, 'adm', 'ADMIN'), 'r1', 'revoke');
    expect(r.status).toBe('REVOKED');
    expect(await hasEntityGrant(db, 'expert', 'SalesInvoice', 'inv1', 'view')).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
    // فقط DONE قابل لغو دسترسی است
    const active = seed({ referrals: [refRow()] });
    await expect(svc.respond(ctxFor(active, 'adm', 'ADMIN'), 'r1', 'revoke')).rejects.toBeInstanceOf(ConflictException);
    // canRevoke فقط برای مدیر روی ردیف DONE
    const d2 = mkDone();
    const info = await svc.forEntity(ctxFor(d2, 'adm', 'ADMIN'), 'SalesInvoice', 'inv1');
    expect(info.history[0].canRevoke).toBe(true);
    const info2 = await svc.forEntity(ctxFor(d2, 'creator'), 'SalesInvoice', 'inv1');
    expect(info2.history[0].canRevoke).toBe(false);
  });

  it('grantedEntityIds is deterministic and not capped at 500', async () => {
    const referrals = Array.from({ length: 700 }, (_, i) => refRow({ id: `r${i}`, entityId: `e${i}` }));
    const ids = await grantedEntityIds(seed({ referrals }), 'expert', 'SalesInvoice');
    expect(ids).toHaveLength(700);
  });

  it('concurrent refer(): duplicate idempotencyKey P2002 returns the existing referral; primary race retries once', async () => {
    const db = seed();
    const { svc } = mkService();
    const ctx = ctxFor(db, 'creator');
    db.documentReferral.create.mockImplementationOnce(async () => {
      db.documentReferral.rows.push(refRow({ id: 'win', idempotencyKey: 'k9' }));
      throw Object.assign(new Error('dup'), { code: 'P2002' });
    });
    const res = await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert', idempotencyKey: 'k9' });
    expect(res.id).toBe('win');
    expect(res.duplicate).toBe(true);

    const db2 = seed();
    db2.documentReferral.create.mockRejectedValueOnce(Object.assign(new Error('race'), { code: 'P2002' }));
    const r2 = await mkService().svc.refer(ctxFor(db2, 'creator'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    expect(r2.status).toBe('PENDING');
    expect(db2.documentReferral.rows).toHaveLength(1);

    const db3 = seed();
    db3.documentReferral.create.mockRejectedValue(Object.assign(new Error('race'), { code: 'P2002' }));
    await expect(mkService().svc.refer(ctxFor(db3, 'creator'), { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('replace marks the new referral primary; additional referral is a co-worker (not primary)', async () => {
    const db = seed();
    const { svc } = mkService();
    const ctx = ctxFor(db, 'creator');
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'expert' });
    await svc.refer(ctx, { entityType: 'SalesInvoice', entityId: 'inv1', toUserId: 'other', additional: true });
    expect(db.documentReferral.rows.map((r: any) => r.isPrimary)).toEqual([true, false]);
  });

  it('task link lookups: prototype keys never 500; Shipment links need dispatch view; recurrence skips grantable links', async () => {
    const db = seed();
    for (const m of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'other'), m, 'x')).resolves.toBeUndefined();
    }
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'other'), 'Shipment', 's1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertTaskLinkAllowed(permissions, ctxFor(db, 'adm', 'OWNER'), 'Shipment', 's1')).resolves.toBeUndefined();
    const { isGrantLinkedModule } = await import('./referral-grants.js');
    expect(isGrantLinkedModule('sales')).toBe(true);
    expect(isGrantLinkedModule('SalesInvoice')).toBe(true);
    expect(isGrantLinkedModule('Shipment')).toBe(false);
    expect(isGrantLinkedModule('constructor')).toBe(false);
  });
});
