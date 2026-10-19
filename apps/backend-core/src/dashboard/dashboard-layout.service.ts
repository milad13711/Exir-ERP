import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import {
  WIDGET_REGISTRY,
  availableWidgets,
  effectiveCompanyItems,
  parseStoredCompanyLayout,
  parseStoredUserLayout,
  resolveLayout,
  validateCompanyLayoutInput,
  validateUserLayoutInput,
  type AclLike,
  type WidgetDef,
} from './dashboard-widgets.js';

const COMPANY = 'COMPANY';
const USER = 'USER';

function publicDef(d: WidgetDef) {
  return {
    key: d.key,
    title: d.title,
    description: d.description,
    moduleCode: d.moduleCode,
    sizes: d.sizes,
    variants: d.variants,
    defaultSize: d.defaultSize,
    defaultVariant: d.defaultVariant,
  };
}

@Injectable()
export class DashboardLayoutService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** ماژول‌های قابل‌استفاده‌ی تننت — همان منطق ModuleGuard (ردیف صریح ← وضعیت؛ بدون ردیف ← isCore) به‌اضافه‌ی وابستگی‌های انتقالی. */
  async installedModules(tenantId: string): Promise<Set<string>> {
    const [defs, installs] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId } }),
    ]);
    const byId = new Map(installs.map((i) => [i.moduleId, i]));
    const direct = new Map<string, boolean>();
    for (const m of defs) {
      const i = byId.get(m.id);
      direct.set(m.code, i ? i.status === 'INSTALLED' || i.status === 'TRIAL' : m.isCore);
    }
    const byCode = new Map(defs.map((d) => [d.code, d]));
    const usable = (code: string, seen = new Set<string>()): boolean => {
      if (seen.has(code)) return true;
      seen.add(code);
      if (direct.get(code) === false) return false;
      return (byCode.get(code)?.dependsOn ?? []).every((dep) => !byCode.has(dep) || usable(dep, seen));
    };
    return new Set(defs.filter((d) => usable(d.code)).map((d) => d.code));
  }

  private async load(ctx: TenantRequestContext, userId: string | null) {
    const [rows, installed, acl] = await Promise.all([
      ctx.tenantDb.dashboardLayout.findMany({
        where: { OR: [{ scope: COMPANY, ownerKey: '' }, ...(userId ? [{ scope: USER, ownerKey: userId }] : [])] },
      }),
      this.installedModules(ctx.tenantId),
      this.permissions.effectiveMatrix(ctx),
    ]);
    const company = parseStoredCompanyLayout(rows.find((r) => r.scope === COMPANY)?.layout);
    const user = userId ? parseStoredUserLayout(rows.find((r) => r.scope === USER)?.layout) : null;
    return { company, user, installed, acl: acl as AclLike & { manager: boolean } };
  }

  /** چیدمان مؤثر همین کاربر — فقط ویجت‌های مجاز؛ به‌علاوه‌ی اطلاعات لازم برای ویرایش. */
  async resolveForUser(ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const { company, user, installed, acl } = await this.load(ctx, userId);
    const allowed = availableWidgets(installed, acl);
    const widgets = resolveLayout(allowed, company, user);
    // برای حالت ویرایش شخصی: همه‌ی ویجت‌هایی که شرکت فعال کرده (حتی پنهان‌شده‌ی شخصی) به ترتیب مؤثر کاربر
    const companyEnabled = effectiveCompanyItems(company, allowed).filter((i) => i.enabled);
    const visible = new Set(widgets.map((x) => x.key));
    const userOrder = user?.items.map((i) => i.key).filter((k) => companyEnabled.some((c) => c.key === k)) ?? [];
    const orderedKeys = [...userOrder, ...companyEnabled.map((c) => c.key).filter((k) => !userOrder.includes(k))];
    const defs = new Map(allowed.map((d) => [d.key, d]));
    return {
      canConfigureCompany: acl.manager,
      hasCompanyLayout: !!company,
      hasUserLayout: !!user,
      widgets,
      personal: orderedKeys.map((k) => ({ key: k, title: defs.get(k)!.title, hidden: !visible.has(k) })),
    };
  }

  /** فقط مدیر: همه‌ی ویجت‌های ماژول‌های نصب‌شده + تنظیم فعلی شرکت. */
  async companyConfig(ctx: TenantRequestContext) {
    await this.assertManager(ctx);
    const { company, installed } = await this.load(ctx, null);
    const defs = WIDGET_REGISTRY.filter((d) => d.moduleCode === null || installed.has(d.moduleCode));
    const defMap = new Map(defs.map((d) => [d.key, d]));
    return {
      isDefault: !company,
      items: effectiveCompanyItems(company, defs).map((i) => ({ ...i, def: publicDef(defMap.get(i.key)!) })),
    };
  }

  async saveCompany(ctx: TenantRequestContext, raw: unknown) {
    await this.assertManager(ctx);
    const layout = validateCompanyLayoutInput(raw);
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    await ctx.tenantDb.dashboardLayout.upsert({
      where: { scope_ownerKey: { scope: COMPANY, ownerKey: '' } },
      create: { scope: COMPANY, ownerKey: '', layout: layout as never, updatedByUserId: userId },
      update: { layout: layout as never, updatedByUserId: userId },
    });
    return this.companyConfig(ctx);
  }

  async resetCompany(ctx: TenantRequestContext) {
    await this.assertManager(ctx);
    await ctx.tenantDb.dashboardLayout.deleteMany({ where: { scope: COMPANY, ownerKey: '' } });
    return this.companyConfig(ctx);
  }

  async saveMine(ctx: TenantRequestContext, raw: unknown) {
    const userId = await this.requireUserId(ctx);
    const layout = validateUserLayoutInput(raw);
    await ctx.tenantDb.dashboardLayout.upsert({
      where: { scope_ownerKey: { scope: USER, ownerKey: userId } },
      create: { scope: USER, ownerKey: userId, layout: layout as never, updatedByUserId: userId },
      update: { layout: layout as never, updatedByUserId: userId },
    });
    return this.resolveForUser(ctx);
  }

  async resetMine(ctx: TenantRequestContext) {
    const userId = await this.requireUserId(ctx);
    await ctx.tenantDb.dashboardLayout.deleteMany({ where: { scope: USER, ownerKey: userId } });
    return this.resolveForUser(ctx);
  }

  private async requireUserId(ctx: TenantRequestContext): Promise<string> {
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    if (!userId) throw new ForbiddenException('این عملیات برای کلید API ممکن نیست');
    return userId;
  }

  private async assertManager(ctx: TenantRequestContext): Promise<void> {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مدیر می‌تواند داشبورد شرکت را تنظیم کند');
    }
  }
}
