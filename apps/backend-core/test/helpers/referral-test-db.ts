/* Test helper (not shipped logic): a tiny in-memory Prisma-like tenant DB for referral specs. */
import { vi } from 'vitest';
import type { TenantRequestContext } from '../../src/common/request-context.js';

type Row = Record<string, any>;

function matchValue(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date || typeof cond !== 'object') return v === cond;
  if ('in' in cond) return cond.in.includes(v);
  if ('notIn' in cond) return !cond.notIn.includes(v);
  if ('not' in cond) return cond.not === null ? v !== null && v !== undefined : v !== cond.not;
  if ('lt' in cond) return v != null && v < cond.lt;
  if ('some' in cond) return Array.isArray(v) && v.some((x) => match(x, cond.some));
  return false;
}
export function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((c) => match(row, c));
    if (k === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((c: Row) => match(row, c));
    return matchValue(row[k], cond);
  });
}

function table(rows: Row[], extra: Record<string, any> = {}) {
  let n = 0;
  return {
    rows,
    findMany: vi.fn(async ({ where, take }: any = {}) => rows.filter((r) => match(r, where)).slice(0, take ?? 1e9)),
    findFirst: vi.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => rows.find((r) => match(r, where))!),
    count: vi.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
    create: vi.fn(async ({ data }: any) => {
      const r = { id: `gen-${++n}`, createdAt: new Date(Date.now() + n), status: 'PENDING', note: null, dueAt: null, acceptedAt: null, resolvedAt: null, resolvedByUserId: null, resolvedNote: null, idempotencyKey: null, ...data };
      rows.push(r);
      return r;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    ...extra,
  };
}

export type FakeSeed = {
  users?: Row[];
  invoices?: Row[];
  tasks?: Row[];
  referrals?: Row[];
  modulePerms?: Row[];
  employees?: Row[];
  projects?: Row[];
  contracts?: Row[];
};

export function makeTenantDb(seed: FakeSeed = {}) {
  const users = seed.users ?? [];
  const db: any = {
    user: table(users, {
      findUnique: vi.fn(async ({ where }: any) => users.find((u) => match(u, where)) ?? null),
    }),
    salesInvoice: table(seed.invoices ?? []),
    salesQuotation: table([]),
    project: table(seed.projects ?? []),
    contract: table(seed.contracts ?? []),
    crmContact: table([]),
    crmDeal: table([]),
    task: table(seed.tasks ?? []),
    documentReferral: table(seed.referrals ?? []),
    modulePermission: {
      findMany: vi.fn(async ({ where }: any) => {
        const uid = where.role.users.some.userId;
        return (seed.modulePerms ?? []).filter((r) => r.moduleCode === where.moduleCode && r.forUserId === uid);
      }),
    },
    userModulePermission: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    activityLog: { create: vi.fn(async () => ({})) },
    employee: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    department: { findMany: vi.fn(async () => []) },
  };
  db.$transaction = async (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

/** کاربر tenant با شناسه‌ی `id` (globalUserId = `g-${id}`) */
export function ctxFor(db: any, userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER', tenantId = 't1'): TenantRequestContext {
  return { tenantDb: db, auth: { type: 'tenant_user', sub: `g-${userId}`, role }, tenantId } as unknown as TenantRequestContext;
}

export const user = (id: string, name = id, extra: Row = {}) => ({ id, globalUserId: `g-${id}`, name, status: 'ACTIVE', ...extra });
/** ردیف دسترسی ماژول برای کاربر `forUserId` (از طریق نقش). */
export const perm = (forUserId: string, moduleCode: string, p: Partial<Record<'canViewAll' | 'canViewOwn' | 'canCreate' | 'canEdit' | 'canDelete', boolean>>) => ({
  forUserId, moduleCode, canViewAll: false, canViewOwn: false, canCreate: false, canEdit: false, canDelete: false, ...p,
});
