import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { getManagerUsers } from '../common/manager-users.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { taskLink } from '../tasks/tasks.service.js';
import { DISPATCH_MODULE, SETTINGS_KEY, mergeSettings, type DispatchSettings } from './dispatch-settings.js';
import { DEFAULT_DOC_TYPES, buildDocsTaskText, defaultRuleDraft, evaluateRules, type DocRule, type RuleEvaluation } from './dispatch-rules.js';
import { dedupe, type Actor } from './dispatch-common.js';

type RuleRow = {
  id: string;
  name: string;
  isActive: boolean;
  minNetKg: number | null;
  cargoTypes: string[];
  regions: string[];
  docTypeCodes: string[];
  handlerRoleId: string | null;
  handlerUserId: string | null;
  sortOrder: number;
};

const toRule = (r: RuleRow): DocRule => ({
  id: r.id,
  name: r.name,
  isActive: r.isActive,
  minNetKg: r.minNetKg,
  cargoTypes: r.cargoTypes,
  regions: r.regions,
  docTypeCodes: r.docTypeCodes,
  handlerRoleId: r.handlerRoleId,
  handlerUserId: r.handlerUserId,
  sortOrder: r.sortOrder,
});

export type RuleInput = {
  name: string;
  isActive?: boolean;
  minNetKg?: number | null;
  cargoTypes?: string[];
  regions?: string[];
  docTypeCodes: string[];
  handlerRoleId?: string | null;
  handlerUserId?: string | null;
  sortOrder?: number;
};

/** تنظیمات ماژول، نوع‌های سند، قوانین اسناد و ساخت وظیفه‌ی «ثبت بارنامه/قرنطینه». */
@Injectable()
export class DispatchRulesService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── تنظیمات ─────────────────────────────────────────────────────────
  async getSettings(db: TenantRequestContext['tenantDb']): Promise<DispatchSettings> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: DISPATCH_MODULE, key: SETTINGS_KEY } } });
    return mergeSettings(row?.value);
  }

  async saveSettings(ctx: TenantRequestContext, input: unknown): Promise<DispatchSettings> {
    const prev = await this.getSettings(ctx.tenantDb);
    const next = mergeSettings({ ...(input as object), defaultsSeeded: prev.defaultsSeeded });
    const value = next as unknown as Record<string, never>;
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: DISPATCH_MODULE, key: SETTINGS_KEY } },
      update: { value },
      create: { moduleCode: DISPATCH_MODULE, key: SETTINGS_KEY, value },
    });
    return next;
  }

  /** یک‌بار: نوع‌های سند پیش‌فرض + قانون «۱۰ تن» با مسئول نقش کنترل کیفیت (اگر چنین نقشی وجود دارد). */
  async ensureDefaults(ctx: TenantRequestContext): Promise<void> {
    const settings = await this.getSettings(ctx.tenantDb);
    if (settings.defaultsSeeded) return;
    for (const t of DEFAULT_DOC_TYPES) {
      await ctx.tenantDb.dispatchDocType.upsert({ where: { code: t.code }, update: {}, create: { code: t.code, name: t.name, isSystem: true, sortOrder: t.sortOrder } });
    }
    const ruleCount = await ctx.tenantDb.dispatchDocRule.count();
    if (ruleCount === 0) {
      const roles = await ctx.tenantDb.role.findMany({ select: { id: true, name: true } });
      const qc = roles.find((r) => r.name.includes('کنترل کیفیت')) ?? roles.find((r) => r.name.includes('کیفیت'));
      await ctx.tenantDb.dispatchDocRule.create({ data: defaultRuleDraft(qc?.id ?? null) });
    }
    const value = { ...settings, defaultsSeeded: true } as unknown as Record<string, never>;
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: DISPATCH_MODULE, key: SETTINGS_KEY } },
      update: { value },
      create: { moduleCode: DISPATCH_MODULE, key: SETTINGS_KEY, value },
    });
  }

  // ── نوع‌های سند ─────────────────────────────────────────────────────
  async listDocTypes(ctx: TenantRequestContext, includeInactive = false) {
    await this.ensureDefaults(ctx);
    return ctx.tenantDb.dispatchDocType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async createDocType(ctx: TenantRequestContext, input: { name: string; code?: string }) {
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException('نام نوع سند باید حداقل ۲ نویسه باشد');
    const code = (input.code?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || `CUSTOM_${Date.now().toString(36).toUpperCase()}`).slice(0, 40);
    if (await ctx.tenantDb.dispatchDocType.findUnique({ where: { code } })) throw new ConflictException('این کد قبلاً استفاده شده است');
    const max = await ctx.tenantDb.dispatchDocType.aggregate({ _max: { sortOrder: true } });
    return ctx.tenantDb.dispatchDocType.create({ data: { code, name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  }

  async updateDocType(ctx: TenantRequestContext, id: string, input: { name?: string; isActive?: boolean }) {
    const t = await ctx.tenantDb.dispatchDocType.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('نوع سند یافت نشد');
    if (input.name !== undefined && input.name.trim().length < 2) throw new BadRequestException('نام نوع سند باید حداقل ۲ نویسه باشد');
    return ctx.tenantDb.dispatchDocType.update({ where: { id }, data: { name: input.name?.trim(), isActive: input.isActive } });
  }

  // ── قوانین ──────────────────────────────────────────────────────────
  async listRules(ctx: TenantRequestContext) {
    await this.ensureDefaults(ctx);
    return ctx.tenantDb.dispatchDocRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  private async validateRule(ctx: TenantRequestContext, input: RuleInput) {
    if (input.name.trim().length < 2) throw new BadRequestException('نام قانون باید حداقل ۲ نویسه باشد');
    if (!input.docTypeCodes?.length) throw new BadRequestException('حداقل یک نوع سند برای قانون انتخاب کنید');
    const types = await ctx.tenantDb.dispatchDocType.findMany({ where: { code: { in: input.docTypeCodes } }, select: { code: true } });
    if (types.length !== new Set(input.docTypeCodes).size) throw new BadRequestException('نوع سند نامعتبر است');
    if (input.minNetKg != null && !(input.minNetKg >= 0)) throw new BadRequestException('حداقل وزن خالص نامعتبر است');
    if (input.handlerRoleId && !(await ctx.tenantDb.role.findUnique({ where: { id: input.handlerRoleId } }))) throw new BadRequestException('نقش مسئول یافت نشد');
    if (input.handlerUserId && !(await ctx.tenantDb.user.findUnique({ where: { id: input.handlerUserId } }))) throw new BadRequestException('کاربر مسئول یافت نشد');
    if (input.handlerRoleId && input.handlerUserId) throw new BadRequestException('مسئول را یا نقش یا کاربر مشخص کنید، نه هر دو');
  }

  async createRule(ctx: TenantRequestContext, input: RuleInput) {
    await this.validateRule(ctx, input);
    return ctx.tenantDb.dispatchDocRule.create({
      data: {
        name: input.name.trim(),
        isActive: input.isActive ?? true,
        minNetKg: input.minNetKg ?? null,
        cargoTypes: (input.cargoTypes ?? []).map((s) => s.trim()).filter(Boolean),
        regions: (input.regions ?? []).map((s) => s.trim()).filter(Boolean),
        docTypeCodes: dedupe(input.docTypeCodes),
        handlerRoleId: input.handlerRoleId ?? null,
        handlerUserId: input.handlerUserId ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateRule(ctx: TenantRequestContext, id: string, input: RuleInput) {
    if (!(await ctx.tenantDb.dispatchDocRule.findUnique({ where: { id } }))) throw new NotFoundException('قانون یافت نشد');
    await this.validateRule(ctx, input);
    return ctx.tenantDb.dispatchDocRule.update({
      where: { id },
      data: {
        name: input.name.trim(),
        isActive: input.isActive ?? true,
        minNetKg: input.minNetKg ?? null,
        cargoTypes: (input.cargoTypes ?? []).map((s) => s.trim()).filter(Boolean),
        regions: (input.regions ?? []).map((s) => s.trim()).filter(Boolean),
        docTypeCodes: dedupe(input.docTypeCodes),
        handlerRoleId: input.handlerRoleId ?? null,
        handlerUserId: input.handlerUserId ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async deleteRule(ctx: TenantRequestContext, id: string) {
    if (!(await ctx.tenantDb.dispatchDocRule.findUnique({ where: { id } }))) throw new NotFoundException('قانون یافت نشد');
    await ctx.tenantDb.dispatchDocRule.delete({ where: { id } });
    return { success: true };
  }

  // ── ارزیابی و ساخت وظیفه ─────────────────────────────────────────────
  async evaluate(ctx: TenantRequestContext, facts: { netKg: number | null; cargoType: string; region: string | null }): Promise<RuleEvaluation> {
    await this.ensureDefaults(ctx);
    const rules = await ctx.tenantDb.dispatchDocRule.findMany({ where: { isActive: true } });
    return evaluateRules(rules.map(toRule), facts);
  }

  /** کاربران مسئول: کاربرهای صریح + اعضای نقش‌ها؛ اگر هیچ‌کس نبود، مدیران. حداکثر ۱۰ نفر. */
  async resolveHandlers(ctx: TenantRequestContext, ev: Pick<RuleEvaluation, 'handlerRoleIds' | 'handlerUserIds'>): Promise<string[]> {
    const fromRoles = ev.handlerRoleIds.length
      ? (await ctx.tenantDb.userRole.findMany({ where: { roleId: { in: ev.handlerRoleIds } }, select: { userId: true } })).map((r) => r.userId)
      : [];
    let ids = dedupe([...ev.handlerUserIds, ...fromRoles]);
    if (ids.length) {
      const existing = await ctx.tenantDb.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      ids = existing.map((u) => u.id);
    }
    if (ids.length === 0) ids = (await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId)).map((m) => m.tenantUserId);
    return ids.slice(0, 10);
  }

  /**
   * قانون(ها) را روی وزن خالص ارزیابی و اسناد لازم را روی بار می‌نویسد؛ اگر قانونی فعال شد و وظیفه‌ای نیست،
   * دقیقاً یک وظیفه برای مسئول(ها) می‌سازد. وظیفه relatedModule='Shipment' دارد.
   */
  async applyToShipment(ctx: TenantRequestContext, shipmentId: string, actor: Actor): Promise<{ required: string[]; taskId: string | null; created: boolean }> {
    const shipment = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { loading: true } });
    const loading = shipment.loading;
    if (!loading) return { required: [], taskId: null, created: false };
    const ev = await this.evaluate(ctx, { netKg: loading.netKg, cargoType: shipment.cargoType, region: shipment.region });
    const required = ev.requiredDocTypes;
    if (required.length === 0) {
      await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId }, data: { requiredDocTypes: [], matchedRuleIds: [] } });
      return { required: [], taskId: loading.docsTaskId, created: false };
    }
    const types = await ctx.tenantDb.dispatchDocType.findMany({ where: { code: { in: required } } });
    const docNames = required.map((c) => types.find((t) => t.code === c)?.name ?? c);
    const text = buildDocsTaskText({
      shipmentNo: shipment.shipmentNo,
      customerName: loading.customerName,
      uniqueId: loading.uniqueId,
      nationalId: loading.nationalId,
      postalCode: loading.postalCode,
      postalAddress: loading.postalAddress,
      netKg: loading.netKg,
      cargoType: shipment.cargoType,
      docNames,
    });

    let taskId = loading.docsTaskId;
    let created = false;
    if (taskId && (await ctx.tenantDb.task.findUnique({ where: { id: taskId }, select: { id: true } }))) {
      await ctx.tenantDb.task.update({ where: { id: taskId }, data: { title: text.title, description: text.description } });
    } else {
      const handlerIds = await this.resolveHandlers(ctx, ev);
      const now = new Date();
      const task = await ctx.tenantDb.task.create({
        data: {
          title: text.title,
          description: text.description,
          priority: 'MEDIUM',
          assignedUserId: handlerIds[0] ?? null,
          createdByUserId: actor.userId,
          relatedModule: 'Shipment',
          relatedEntityId: shipmentId,
          isPublished: true,
          publishedAt: now,
          assignees: { create: handlerIds.map((userId) => ({ userId })) },
          events: {
            create: [
              { type: 'created', actorUserId: actor.userId, toStatus: 'NEW', createdAt: now },
              { type: 'sent', actorUserId: actor.userId, createdAt: new Date(now.getTime() + 1) },
            ],
          },
        },
      });
      taskId = task.id;
      created = true;
      for (const userId of handlerIds) {
        await this.notifications
          .notify(ctx.tenantDb, {
            userId,
            type: 'dispatch.docs_task',
            title: `وظیفه‌ی جدید: ${text.title}`,
            body: `اسناد لازم: ${docNames.join('، ')}`,
            link: taskLink(task.id),
          })
          .catch(() => undefined);
      }
    }
    await ctx.tenantDb.shipmentLoading.update({
      where: { shipmentId },
      data: { requiredDocTypes: required, matchedRuleIds: ev.matched.map((r) => r.id), docsTaskId: taskId },
    });
    return { required, taskId, created };
  }
}
