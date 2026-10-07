import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FormsInboxService } from './forms-inbox.service.js';
import { formScope } from './form-scope.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

/** تننتی با دو فرم (یکی مال u1، یکی مال u2) و چند پاسخ — where ساده را واقعاً اعمال می‌کند تا scoping آزمایش شود. */
function makeDb() {
  const forms = [
    { id: 'fA', title: 'A', slug: 'a', type: 'SURVEY', createdByUserId: 'u1' },
    { id: 'fB', title: 'B', slug: 'b', type: 'SURVEY', createdByUserId: 'u2' },
  ];
  const subs: Array<Record<string, unknown>> = [
    { id: 's1', formId: 'fA', status: 'NEW', viewedAt: null, submittedAt: new Date('2026-01-03'), respondentName: 'x', respondentPhone: null, answers: [] },
    { id: 's2', formId: 'fA', status: 'IN_REVIEW', viewedAt: new Date(), submittedAt: new Date('2026-01-02'), respondentName: null, respondentPhone: null, answers: [] },
    { id: 's3', formId: 'fB', status: 'NEW', viewedAt: null, submittedAt: new Date('2026-01-01'), respondentName: 'secret', respondentPhone: null, answers: [] },
  ];
  const formMatches = (f: (typeof forms)[number], where: Record<string, unknown> | undefined) =>
    !where || Object.entries(where).every(([k, v]) => (f as Record<string, unknown>)[k] === v);
  const db = {
    form: { findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => forms.filter((f) => formMatches(f, where))) },
    formSubmission: {
      groupBy: vi.fn(async ({ where }: { where: { formId: { in: string[] }; status: string } }) => {
        const ids = where.formId.in;
        const byForm = new Map<string, number>();
        for (const s of subs) if (ids.includes(s.formId as string) && s.status === where.status) byForm.set(s.formId as string, (byForm.get(s.formId as string) ?? 0) + 1);
        return [...byForm].map(([formId, n]) => ({ formId, _count: { _all: n } }));
      }),
      findMany: vi.fn(async ({ where }: { where: { formId: string; status: string } }) => subs.filter((s) => s.formId === where.formId && s.status === where.status)),
      findFirst: vi.fn(async ({ where }: { where: { id: string; form: Record<string, unknown> } }) => {
        const s = subs.find((x) => x.id === where.id);
        const f = s && forms.find((ff) => ff.id === s.formId);
        return s && f && formMatches(f, where.form) ? s : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = subs.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return { db, subs };
}
const ctxOf = (db: unknown) => ({ tenantDb: db, auth: { type: 'tenant_user', sub: 'g1', role: 'MEMBER' } }) as unknown as TenantRequestContext;

describe('FormsInboxService', () => {
  const svc = new FormsInboxService();

  it('inbox-summary with full scope counts NEW per form', async () => {
    const { db } = makeDb();
    const r = await svc.inboxSummary(ctxOf(db), {});
    expect(r.totalNew).toBe(2);
    expect(r.forms.map((f) => [f.formId, f.newCount])).toEqual(expect.arrayContaining([['fA', 1], ['fB', 1]]));
  });

  it("inbox-summary with 'own' scope never leaks other users' forms", async () => {
    const { db } = makeDb();
    const r = await svc.inboxSummary(ctxOf(db), { createdByUserId: 'u1' });
    expect(r.totalNew).toBe(1);
    expect(r.forms).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(db.formSubmission.groupBy.mock.calls[0][0].where.formId.in).toEqual(['fA']);
  });

  it('by-id access outside scope is 404 for detail/viewed/update', async () => {
    const { db, subs } = makeDb();
    const own = { createdByUserId: 'u1' };
    await expect(svc.submissionDetail(ctxOf(db), 's3', own)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markViewed(ctxOf(db), 's3', own, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updateSubmission(ctxOf(db), 's3', own, { status: 'DONE' }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(subs.find((s) => s.id === 's3')!.status).toBe('NEW');
  });

  it('markViewed: NEW -> IN_REVIEW once, sets viewedAt/viewedBy, idempotent afterwards', async () => {
    const { db, subs } = makeDb();
    const first = await svc.markViewed(ctxOf(db), 's1', {}, 'u1');
    expect(first).toEqual({ id: 's1', status: 'IN_REVIEW', changed: true });
    expect(subs[0].viewedAt).toBeInstanceOf(Date);
    expect(subs[0].viewedByUserId).toBe('u1');
    const again = await svc.markViewed(ctxOf(db), 's1', {}, 'u2');
    expect(again.changed).toBe(false);
    expect(subs[0].viewedByUserId).toBe('u1');
    const summary = await svc.inboxSummary(ctxOf(db), { createdByUserId: 'u1' });
    expect(summary.totalNew).toBe(0);
  });

  it('updateSubmission: status transitions, back to NEW allowed, invalid rejected, note trimmed/cleared', async () => {
    const { db, subs } = makeDb();
    await svc.updateSubmission(ctxOf(db), 's1', {}, { status: 'DONE', internalNote: '  پیگیری شد ' }, 'u1');
    expect(subs[0].status).toBe('DONE');
    expect(subs[0].internalNote).toBe('پیگیری شد');
    expect(subs[0].viewedAt).toBeInstanceOf(Date); // DONE یعنی دیده شده
    await svc.updateSubmission(ctxOf(db), 's1', {}, { status: 'NEW' }, 'u1');
    expect(subs[0].status).toBe('NEW');
    await svc.updateSubmission(ctxOf(db), 's1', {}, { internalNote: '' }, 'u1');
    expect(subs[0].internalNote).toBeNull();
    await expect(svc.updateSubmission(ctxOf(db), 's1', {}, { status: 'BOGUS' }, 'u1')).rejects.toThrow();
  });
});

describe('formScope', () => {
  const perms = new PermissionsService();
  function ctx(rows: Array<Record<string, unknown>>, role: 'OWNER' | 'MEMBER' = 'MEMBER', userId: string | null = 'u1') {
    return {
      tenantDb: {
        user: { findUnique: vi.fn().mockResolvedValue(userId ? { id: userId } : null) },
        modulePermission: { findMany: vi.fn().mockResolvedValue(rows) },
        userModulePermission: { findUnique: vi.fn().mockResolvedValue(null) },
      },
      auth: { type: 'tenant_user', sub: 'g1', role },
      tenantId: 't',
    } as unknown as TenantRequestContext;
  }
  const row = (o: Record<string, unknown>) => ({ moduleCode: 'forms', canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false, ...o });

  it('view-all => no restriction; view-own => creator filter; none => 403', async () => {
    expect(await formScope(perms, ctx([row({ canViewAll: true })]))).toEqual({});
    expect(await formScope(perms, ctx([row({ canViewOwn: true })]))).toEqual({ createdByUserId: 'u1' });
    await expect(formScope(perms, ctx([row({})]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await formScope(perms, ctx([], 'OWNER'))).toEqual({});
  });
});
