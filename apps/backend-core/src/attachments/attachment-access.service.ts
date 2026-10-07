import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getVisibleEmployeeIds } from '../hr/org-chain.util.js';
import { contractScope, projectScope, proposalScope } from '../permissions/entity-scopes.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { assertInScope } from '../permissions/scope.util.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

export type AttachmentMode = 'read' | 'write' | 'delete';

/** Entities whose visibility is a plain owner column on the module's own matrix. */
const OWNED: Record<string, { module: string; ownerField: string; model: 'salesQuotation' | 'salesInvoice' | 'purchaseOrder' | 'crmContact' | 'crmDeal' }> = {
  SalesQuotation: { module: 'sales', ownerField: 'createdByUserId', model: 'salesQuotation' },
  SalesInvoice: { module: 'sales', ownerField: 'createdByUserId', model: 'salesInvoice' },
  PurchaseOrder: { module: 'purchasing', ownerField: 'createdByUserId', model: 'purchaseOrder' },
  CrmContact: { module: 'crm', ownerField: 'ownerUserId', model: 'crmContact' },
  CrmDeal: { module: 'crm', ownerField: 'ownerUserId', model: 'crmDeal' },
};

/** Entities in modules whose list is view-all only (no per-record owner scope). */
const VIEW_ALL_ONLY: Record<string, string> = {
  Shipment: 'fleet',
  Report: 'reports',
  production_order: 'production',
};

/**
 * Generic attachments hang off any entity by (entityType, entityId). They must
 * never be a back door around the entity's own access matrix: reading/adding/
 * removing a file requires the same access to the parent record the user would
 * need to open it (including the "view own" ownership scope). Unknown entity
 * types are manager-only.
 */
@Injectable()
export class AttachmentAccessService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  private isManager(ctx: TenantRequestContext): boolean {
    return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  }

  private async assertWriteMatrix(ctx: TenantRequestContext, moduleCode: string, mode: AttachmentMode): Promise<void> {
    if (mode === 'read') return;
    const m = await this.permissions.getEffective(ctx, moduleCode);
    const ok = mode === 'delete' ? m.canEdit || m.canDelete : m.canEdit || m.canCreate;
    if (!ok) throw new ForbiddenException('اجازه‌ی ویرایش در این بخش را ندارید');
  }

  async assertAccess(ctx: TenantRequestContext, entityType: string, entityId: string, mode: AttachmentMode): Promise<void> {
    // پروپوزال پذیرفته‌شده قفل است: برای همه‌ی نقش‌ها (حتی مدیر) افزودن/حذف پیوست ممنوع است.
    if (entityType === 'Proposal' && mode !== 'read') {
      const proposal = await ctx.tenantDb.proposal.findUnique({ where: { id: entityId }, select: { status: true } });
      if (proposal?.status === 'ACCEPTED') throw new ForbiddenException('پروپوزال پذیرفته‌شده قفل است و پیوست‌هایش تغییر نمی‌کند');
    }

    if (this.isManager(ctx)) return;

    const owned = OWNED[entityType];
    if (owned) {
      const scope = await this.permissions.viewScope(ctx, owned.module, owned.ownerField);
      await this.assertWriteMatrix(ctx, owned.module, mode);
      await assertInScope(ctx.tenantDb[owned.model], scope, { id: entityId }, { message: 'رکورد یافت نشد' });
      return;
    }

    if (entityType === 'Contract') {
      const scope = await contractScope(this.permissions, ctx);
      await this.assertWriteMatrix(ctx, 'contracts', mode);
      await assertInScope(ctx.tenantDb.contract, scope, { id: entityId }, { message: 'رکورد یافت نشد' });
      return;
    }

    if (entityType === 'Proposal') {
      const scope = await proposalScope(this.permissions, ctx);
      await this.assertWriteMatrix(ctx, 'proposals', mode);
      await assertInScope(ctx.tenantDb.proposal, scope, { id: entityId }, { message: 'رکورد یافت نشد' });
      return;
    }

    if (entityType === 'Project') {
      const scope = await projectScope(this.permissions, ctx);
      await this.assertWriteMatrix(ctx, 'projects', mode);
      await assertInScope(ctx.tenantDb.project, scope, { id: entityId }, { message: 'رکورد یافت نشد' });
      return;
    }

    // گزارش روزانه‌ی چک‌لیست: صاحبش (یا مدیرِ بالادستش) فایل‌های بایگانی‌شده‌ی همان گزارش را می‌بیند،
    // حتی بدون «مشاهده‌ی همه» در ماژول گزارش‌ها؛ هر گزارش دیگری فقط با view-all. نوشتن/حذف فقط با ماتریس گزارش‌ها.
    if (entityType === 'Report' && mode === 'read') {
      const m = await this.permissions.getEffective(ctx, 'reports');
      if (!m.canViewAll) {
        const close = await ctx.tenantDb.dailyChecklistDayClose.findFirst({ where: { reportId: entityId }, select: { userId: true } });
        if (!close) throw new ForbiddenException('اجازه‌ی دسترسی به پیوست‌های این بخش را ندارید');
        await this.assertChecklistOwnerVisible(ctx, close.userId);
        return;
      }
    }

    const viewAllModule = VIEW_ALL_ONLY[entityType];
    if (viewAllModule) {
      await this.permissions.assertViewAll(ctx, viewAllModule);
      await this.assertWriteMatrix(ctx, viewAllModule, mode);
      return;
    }

    if (entityType === 'production_order_stage') {
      // کاربرِ مسئول مرحله (کارگر خط تولید) بدون «مشاهده‌ی همه» هم باید بتواند برای مرحله‌ی خودش فایل بگذارد.
      const m = await this.permissions.getEffective(ctx, 'production');
      if (!m.canViewAll) {
        const me = await resolveTenantUserId(ctx);
        const stage = me ? await ctx.tenantDb.productionOrderStage.findFirst({ where: { id: entityId, assignedUserId: me }, select: { id: true } }) : null;
        if (!stage) throw new ForbiddenException('فقط مسئول این مرحله می‌تواند پیوست‌هایش را ببیند');
        return;
      }
      await this.assertWriteMatrix(ctx, 'production', mode);
      return;
    }

    if (entityType === 'DailyChecklistItem') {
      const item = await ctx.tenantDb.dailyChecklistItem.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!item) throw new ForbiddenException('رکورد یافت نشد');
      await this.assertChecklistOwnerVisible(ctx, item.userId);
      return;
    }

    if (entityType === 'SupportTicket') {
      const sub = ctx.auth.sub;
      const ticket = await this.controlDb.supportTicket.findUnique({ where: { id: entityId }, select: { tenantId: true, createdByUserId: true } });
      if (!ticket || ticket.tenantId !== ctx.tenantId || ticket.createdByUserId !== sub) throw new ForbiddenException('تیکت یافت نشد');
      return;
    }

    throw new ForbiddenException('اجازه‌ی دسترسی به پیوست‌های این بخش را ندارید');
  }

  /** فقط خودِ صاحب چک‌لیست یا مدیرانِ بالادستش (زنجیره‌ی سازمانی). */
  private async assertChecklistOwnerVisible(ctx: TenantRequestContext, ownerUserId: string): Promise<void> {
    const me = await resolveTenantUserId(ctx);
    if (me && ownerUserId === me) return;
    const myEmployee = me ? await ctx.tenantDb.employee.findUnique({ where: { userId: me }, select: { id: true } }) : null;
    if (myEmployee) {
      const visible = await getVisibleEmployeeIds(ctx.tenantDb, myEmployee.id);
      const owner = await ctx.tenantDb.employee.findFirst({ where: { id: { in: [...visible] }, userId: ownerUserId }, select: { id: true } });
      if (owner) return;
    }
    throw new ForbiddenException('فقط چک‌لیست خودتان یا زیردستان‌تان');
  }
}
