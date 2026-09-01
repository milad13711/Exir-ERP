import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

export type ModuleMatrix = {
  canViewAll: boolean;
  canViewOwn: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

const FULL_ACCESS: ModuleMatrix = {
  canViewAll: true,
  canViewOwn: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
};
const NO_ACCESS: ModuleMatrix = {
  canViewAll: false,
  canViewOwn: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

/**
 * Resolves and enforces the per-module access matrix an admin configures in
 * Settings → Roles (see ModulePermission in prisma/tenant/schema.prisma).
 * The tenant OWNER/ADMIN (control-plane membership role, in ctx.auth.role —
 * distinct from a tenant-local Role) always gets full access, matching how
 * every other admin-only route in this codebase already treats that role;
 * API keys inherit the OWNER/ADMIN role they were created under, same as
 * elsewhere. Everyone else's access is the union (logical OR) across every
 * tenant-local Role assigned to them — one role granting an action is
 * enough, even if another role they hold doesn't.
 */
@Injectable()
export class PermissionsService {
  async getEffective(ctx: TenantRequestContext, moduleCode: string): Promise<ModuleMatrix> {
    if (ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN') return FULL_ACCESS;

    const userId = await resolveTenantUserId(ctx);
    if (!userId) return NO_ACCESS;

    const rows = await ctx.tenantDb.modulePermission.findMany({
      where: { moduleCode, role: { users: { some: { userId } } } },
    });
    if (rows.length === 0) return NO_ACCESS;

    return rows.reduce<ModuleMatrix>(
      (acc, row) => ({
        canViewAll: acc.canViewAll || row.canViewAll,
        canViewOwn: acc.canViewOwn || row.canViewOwn,
        canCreate: acc.canCreate || row.canCreate,
        canEdit: acc.canEdit || row.canEdit,
        canDelete: acc.canDelete || row.canDelete,
      }),
      { ...NO_ACCESS },
    );
  }

  /** For routes over non-owned/master data (e.g. chart of accounts, product catalog) where "own" has no meaning — any view access (all or own) is enough. */
  async assertView(ctx: TenantRequestContext, moduleCode: string): Promise<void> {
    const matrix = await this.getEffective(ctx, moduleCode);
    if (!matrix.canViewAll && !matrix.canViewOwn) {
      throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    }
  }

  async assertCreate(ctx: TenantRequestContext, moduleCode: string): Promise<void> {
    const matrix = await this.getEffective(ctx, moduleCode);
    if (!matrix.canCreate) throw new ForbiddenException('اجازه‌ی ایجاد رکورد جدید در این بخش را ندارید');
  }

  async assertEdit(ctx: TenantRequestContext, moduleCode: string): Promise<void> {
    const matrix = await this.getEffective(ctx, moduleCode);
    if (!matrix.canEdit) throw new ForbiddenException('اجازه‌ی ویرایش در این بخش را ندارید');
  }

  async assertDelete(ctx: TenantRequestContext, moduleCode: string): Promise<void> {
    const matrix = await this.getEffective(ctx, moduleCode);
    if (!matrix.canDelete) throw new ForbiddenException('اجازه‌ی حذف در این بخش را ندارید');
  }

  /**
   * For list/detail routes: returns the Prisma where-fragment to merge into
   * the query (an empty object for full view access, or `{ [ownerField]: userId }`
   * to scope to the caller's own records), or throws if they can't view at
   * all. Merge the result into the query's `where` with a spread.
   */
  async viewScope(
    ctx: TenantRequestContext,
    moduleCode: string,
    ownerField: string,
  ): Promise<Record<string, unknown>> {
    const matrix = await this.getEffective(ctx, moduleCode);
    if (matrix.canViewAll) return {};
    if (matrix.canViewOwn) {
      const userId = await resolveTenantUserId(ctx);
      return { [ownerField]: userId };
    }
    throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
  }
}
