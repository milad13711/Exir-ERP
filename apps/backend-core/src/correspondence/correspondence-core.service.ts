import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PermissionsService, type ModuleMatrix } from '../permissions/permissions.service.js';
import { MODULE_CODE, type LetterEventType, type ParticipantRole } from './correspondence.constants.js';
import { letterVisibilityWhere, notificationText, type ScopeActor, type Where } from './letter-scope.js';
import { combineWhere } from './letter-search.js';

export type CorrActor = {
  userId: string | null;
  name: string;
  title: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  matrix: ModuleMatrix;
  scope: ScopeActor;
};

type Db = TenantPrismaClient | Prisma.TransactionClient;

export const letterLink = (id: string) => `/correspondence/${id}`;

/**
 * هسته‌ی مشترک سرویس‌های مکاتبات: هویت کاربر، دامنه‌ی دید (ACL)، بارگذاری امن نامه (۴۰۴ خارج از دامنه)،
 * مشارکت‌کنندگان، رویدادها و اعلان‌ها (متن عمومی برای نامه‌ی محرمانه).
 */
@Injectable()
export class CorrespondenceCoreService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  get controlDbRef(): ControlPrismaService {
    return this.controlDb;
  }

  async actor(ctx: TenantRequestContext): Promise<CorrActor> {
    const isOwner = ctx.auth.role === 'OWNER';
    const isAdmin = ctx.auth.role === 'ADMIN';
    const matrix = await this.permissions.getEffective(ctx, MODULE_CODE);
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    let name = isOwner || isAdmin ? 'مدیر' : 'کاربر';
    let title: string | null = null;
    if (userId) {
      const [u, emp] = await Promise.all([
        ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }),
        ctx.tenantDb.employee.findUnique({ where: { userId }, select: { position: true } }).catch(() => null),
      ]);
      if (u?.name) name = u.name;
      title = emp?.position ?? null;
    }
    return {
      userId, name, title, isOwner, isAdmin, isManager: isOwner || isAdmin, matrix,
      scope: { userId, isOwner, isAdmin, viewAll: matrix.canViewAll, viewOwn: matrix.canViewOwn },
    };
  }

  /** where دید؛ بدون هیچ دسترسی ۴۰۳. */
  visibleWhere(actor: CorrActor): Where {
    const w = letterVisibilityWhere(actor.scope);
    if (!w) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    return w;
  }

  /** نامه را فقط اگر در دامنه‌ی کاربر باشد برمی‌گرداند؛ وگرنه ۴۰۴ (نشت وجود رکورد نیست). */
  async findVisible(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const where = combineWhere({ id }, this.visibleWhere(actor)) as Prisma.CorrLetterWhereInput;
    const letter = await ctx.tenantDb.corrLetter.findFirst({ where });
    if (!letter) throw new NotFoundException('نامه یافت نشد');
    return letter;
  }

  assertCreate(actor: CorrActor): void {
    if (!actor.matrix.canCreate) throw new ForbiddenException('اجازه‌ی ایجاد نامه را ندارید');
  }

  /** ویرایش محتوای نامه: مدیر، یا سازنده/مسئولِ نامه با مجوز ایجاد/ویرایش. */
  canMutateContent(actor: CorrActor, letter: { createdByUserId: string | null; ownerUserId: string | null }): boolean {
    if (actor.isManager) return true;
    if (!actor.userId) return false;
    if (!(actor.matrix.canCreate || actor.matrix.canEdit)) return false;
    return letter.createdByUserId === actor.userId || letter.ownerUserId === actor.userId || actor.matrix.canEdit;
  }

  async addParticipant(db: Db, letterId: string, userId: string | null | undefined, role: ParticipantRole): Promise<void> {
    if (!userId) return;
    await db.corrParticipant.createMany({ data: [{ letterId, userId, role }], skipDuplicates: true });
  }

  async logEvent(db: Db, letterId: string, type: LetterEventType, actor: { userId: string | null; name: string } | null, note?: string | null, meta?: Record<string, unknown>): Promise<void> {
    await db.corrEvent.create({
      data: { letterId, type, actorUserId: actor?.userId ?? null, actorName: actor?.name ?? null, note: note ?? null, meta: (meta as Prisma.InputJsonValue) ?? undefined },
    });
  }

  async userBrief(db: Db, userId: string): Promise<{ name: string; title: string | null }> {
    const [u, emp] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { name: true } }),
      db.employee.findUnique({ where: { userId }, select: { position: true } }).catch(() => null),
    ]);
    return { name: u?.name ?? 'کاربر', title: emp?.position ?? null };
  }

  /** اعلان درون‌برنامه‌ای/پوش؛ برای نامه‌ی محرمانه متن عمومی. هرگز به خود فرستنده نمی‌رود. */
  async notify(
    ctx: TenantRequestContext,
    userIds: Array<string | null | undefined>,
    kind: string,
    type: string,
    letter: { id: string; subject: string; letterNumber: string | null; confidentiality: string },
    exceptUserId?: string | null,
  ): Promise<void> {
    const text = notificationText(kind, letter);
    const targets = [...new Set(userIds.filter((u): u is string => !!u && u !== exceptUserId))];
    for (const userId of targets) {
      await this.notifications.notify(ctx.tenantDb, { userId, type, title: text.title, body: text.body, link: letterLink(letter.id) }).catch(() => undefined);
    }
  }

  /**
   * کاربران دارای دسترسی مشاهده به ماژول (برای انتخاب امضاکننده/گیرنده‌ی ارجاع):
   * مالک/ادمین‌های فعال + کاربرانی که دسترسی دستی دارند + کاربران دارای نقشی با مشاهده‌ی همه/خودم.
   * دسترسی دستی (override) جایگزین قطعیِ نقش‌هاست (همان منطق PermissionsService).
   */
  async usersWithModuleAccess(ctx: TenantRequestContext): Promise<Set<string>> {
    const ok = new Set<string>();
    const memberships = await this.controlDb.tenantMembership.findMany({ where: { tenantId: ctx.tenantId, role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' }, select: { globalUserId: true } });
    if (memberships.length) {
      const mgrs = await ctx.tenantDb.user.findMany({ where: { globalUserId: { in: memberships.map((m) => m.globalUserId) } }, select: { id: true } });
      for (const m of mgrs) ok.add(m.id);
    }
    const [overrides, rolePerms] = await Promise.all([
      ctx.tenantDb.userModulePermission.findMany({ where: { moduleCode: MODULE_CODE }, select: { userId: true, canViewAll: true, canViewOwn: true } }),
      ctx.tenantDb.modulePermission.findMany({ where: { moduleCode: MODULE_CODE, OR: [{ canViewAll: true }, { canViewOwn: true }] }, select: { roleId: true } }),
    ]);
    const overridden = new Set(overrides.map((o) => o.userId));
    for (const o of overrides) if (o.canViewAll || o.canViewOwn) ok.add(o.userId);
    if (rolePerms.length) {
      const ur = await ctx.tenantDb.userRole.findMany({ where: { roleId: { in: rolePerms.map((r) => r.roleId) } }, select: { userId: true } });
      for (const u of ur) if (!overridden.has(u.userId)) ok.add(u.userId);
    }
    return ok;
  }
}
