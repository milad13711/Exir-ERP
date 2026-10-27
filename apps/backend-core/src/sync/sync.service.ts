import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { buildChangesResult, cursorWhere, MAX_IDS, type ChangeEntity, type ChangesQuery } from './sync-changes.js';
import { roleAllowed } from './sync-policy.js';
import { SyncPolicyService } from './sync-policy.service.js';
import { OFFLINE_OPERATION_KEYS } from './sync-policy.js';

/** نسخه‌ی طرح رجیستری/کش سمت کلاینت؛ با تغییر ناسازگار افزایش می‌یابد تا کش قدیمی دور ریخته شود. */
export const SYNC_SCHEMA_VERSION = 1;

@Injectable()
export class SyncService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly permissions: PermissionsService,
    private readonly policies: SyncPolicyService,
  ) {}

  async bootstrap(ctx: TenantRequestContext) {
    const policy = await this.policies.get(ctx);
    const allowed = roleAllowed(policy, ctx.auth.role);
    return {
      serverTime: new Date().toISOString(),
      schemaVersion: SYNC_SCHEMA_VERSION,
      allowed,
      policy: { ...policy, enabledOperations: allowed ? policy.enabledOperations : [] },
      knownOperations: OFFLINE_OPERATION_KEYS,
      entities: [
        { key: 'contacts', module: 'crm', ttlSec: 6 * 3600, maxRows: 5000 },
        { key: 'products', module: 'warehouse', ttlSec: 6 * 3600, maxRows: 5000 },
        { key: 'tasksMine', module: 'tasks', ttlSec: 900, maxRows: 500 },
        { key: 'users', module: null, ttlSec: 24 * 3600, maxRows: 1000 },
      ],
    };
  }

  /** دلتای لیست‌های قابل‌کش؛ دامنه‌ی دسترسی همان مجوزهای عادی است (viewScope) و فقط فیلدهای لازم برگردانده می‌شود. */
  async changes(ctx: TenantRequestContext, q: ChangesQuery) {
    const out: Record<string, unknown> = {};
    for (const e of q.entities) out[e] = await this.one(ctx, e, q);
    return { serverTime: new Date().toISOString(), schemaVersion: SYNC_SCHEMA_VERSION, entities: out };
  }

  private async one(ctx: TenantRequestContext, entity: ChangeEntity, q: ChangesQuery): Promise<unknown> {
    const updatedWhere = cursorWhere(q.since);
    const order = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }];
    const idsOf = async (rows: Promise<Array<{ id: string }>>) => {
      const r = await rows;
      return r.length > MAX_IDS ? undefined : r.map((x) => x.id); // خیلی بزرگ → بدون هرس
    };
    const take = q.limit + 1;
    switch (entity) {
      case 'contacts': {
        if (!(await isModuleEnabled(this.controlDb, ctx.tenantId, 'crm'))) return { unavailable: 'MODULE_DISABLED' };
        const scope = await this.permissions.viewScope(ctx, 'crm', 'ownerUserId');
        const rows = await ctx.tenantDb.crmContact.findMany({
          where: { ...scope, ...updatedWhere },
          orderBy: order,
          take,
          select: { id: true, name: true, company: true, phone: true, type: true, isCustomer: true, isSupplier: true, updatedAt: true },
        });
        const ids = q.withIds ? await idsOf(ctx.tenantDb.crmContact.findMany({ where: scope, select: { id: true }, take: MAX_IDS + 1 })) : undefined;
        return buildChangesResult(rows, q, ids);
      }
      case 'products': {
        if (!(await isModuleEnabled(this.controlDb, ctx.tenantId, 'warehouse'))) return { unavailable: 'MODULE_DISABLED' };
        await this.permissions.assertView(ctx, 'warehouse');
        const rows = await ctx.tenantDb.product.findMany({
          where: { isActive: true, ...updatedWhere },
          orderBy: order,
          take,
          select: { id: true, sku: true, name: true, unit: true, category: true, salePrice: true, updatedAt: true },
        });
        const ids = q.withIds ? await idsOf(ctx.tenantDb.product.findMany({ where: { isActive: true }, select: { id: true }, take: MAX_IDS + 1 })) : undefined;
        return buildChangesResult(rows, q, ids);
      }
      case 'tasksMine': {
        const me = await resolveTenantUserId(ctx);
        if (!me) return buildChangesResult([], q);
        const rows = await ctx.tenantDb.task.findMany({
          where: { isPublished: true, AND: [{ OR: [{ assignedUserId: me }, { assignees: { some: { userId: me } } }] }, updatedWhere] },
          orderBy: order,
          take,
          select: { id: true, number: true, title: true, description: true, status: true, priority: true, dueAt: true, updatedAt: true },
        });
        const ids = q.withIds
          ? await idsOf(ctx.tenantDb.task.findMany({ where: { isPublished: true, OR: [{ assignedUserId: me }, { assignees: { some: { userId: me } } }] }, select: { id: true }, take: MAX_IDS + 1 }))
          : undefined;
        return buildChangesResult(rows, q, ids);
      }
      case 'users': {
        // User مدل updatedAt ندارد → همیشه «کامل» (فهرست کوچک: فقط شناسه و نام)
        const rows = await ctx.tenantDb.user.findMany({ where: { status: { not: 'DISABLED' } }, orderBy: { name: 'asc' }, take: q.limit, select: { id: true, name: true } });
        return { mode: 'full', items: rows, nextSince: null, truncated: false };
      }
    }
  }

  async status(ctx: TenantRequestContext) {
    const now = new Date();
    const [total, pending, expired, oldest] = await Promise.all([
      ctx.tenantDb.syncIdempotency.count(),
      ctx.tenantDb.syncIdempotency.count({ where: { status: 'PENDING' } }),
      ctx.tenantDb.syncIdempotency.count({ where: { expiresAt: { lt: now } } }),
      ctx.tenantDb.syncIdempotency.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return { serverTime: now.toISOString(), idempotency: { total, pending, expired, oldestAt: oldest?.createdAt.toISOString() ?? null } };
  }
}
