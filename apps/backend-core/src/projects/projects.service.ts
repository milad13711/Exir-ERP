import { ApprovalsService } from '../approvals/approvals.service.js';
import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';
import type { UpdateProjectDto } from './dto/update-project.dto.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { computeProjectProgress } from './project-progress.js';
import { ProjectSmsService } from './project-sms.service.js';
import type { SmsEventKey } from './project-sms.template.js';

const STAGE_INCLUDE = {
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
} as const;

const STAGE_FULL_INCLUDE = {
  ...STAGE_INCLUDE,
  links: { orderBy: { createdAt: 'asc' as const } },
} as const;

const PROJECT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true } },
  manager: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  members: { include: { user: { select: { id: true, name: true } } } },
  stages: {
    orderBy: { order: 'asc' as const },
    include: STAGE_FULL_INCLUDE,
  },
} as const;

/** توکن عمومی هرگز در پاسخ‌های پنل نمی‌آید (فقط از endpoint لینک عمومی با دسترسی ویرایش)؛ درصد پیشرفت از مراحل. */
export function presentProject<P extends { publicToken?: string; stages: Array<{ status: string }> }>(project: P) {
  const { publicToken: _omit, ...rest } = project;
  void _omit;
  const pr = computeProjectProgress(project.stages);
  return { ...rest, progressPercent: pr.progressPercent, stageProgress: { done: pr.doneStages, total: pr.totalStages } };
}

const ACTIVE_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD'] as const;

@Injectable()
export class ProjectsService implements OnModuleInit {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly projectSms?: ProjectSmsService,
  ) {}

  /** پیامک‌های در حال ارسال (برای تست/خاموشی تمیز) */
  readonly pendingSms = new Set<Promise<unknown>>();

  /**
   * پیامک خودکار به مشتری — بعد از کامیت و بدون انتظار؛ هر خطا بلعیده می‌شود و هیچ‌وقت تغییر وضعیت را نمی‌شکند.
   * (فیلترهای فعال/غیرفعال، سقف و حذف تکراری داخل ProjectSmsService است.)
   */
  private fireSms(ctx: TenantRequestContext, projectId: string, event: SmsEventKey, stageId?: string): void {
    if (!this.projectSms) return;
    let p: Promise<unknown>;
    try {
      p = this.projectSms.notifyEvent(ctx, projectId, event, stageId).catch(() => undefined);
    } catch {
      return;
    }
    this.pendingSms.add(p);
    void p.finally(() => this.pendingSms.delete(p));
  }

  onModuleInit(): void {
    this.approvals.registerHandler('PROJECT_STAGE', {
      approve: async (ctx, stageId) => {
        const stage = await ctx.tenantDb.projectStage.findUniqueOrThrow({ where: { id: stageId } });
        await this.approveStage(ctx, stage.projectId, stageId, true);
      },
      reject: async (ctx, stageId, opts) => {
        const stage = await ctx.tenantDb.projectStage.findUniqueOrThrow({ where: { id: stageId } });
        await this.rejectStage(ctx, stage.projectId, stageId, opts.note, true);
      },
      describe: async (ctx, stageId) => {
        const s = await ctx.tenantDb.projectStage.findUniqueOrThrow({ where: { id: stageId }, include: { project: true } });
        return {
          fields: [
            { label: 'پروژه', value: `${s.project.name} (#${s.project.projectNo})` },
            { label: 'مرحله', value: s.title },
            { label: 'وضعیت', value: s.status },
          ],
        };
      },
    });
  }

  /** Task completion counts for each project, keyed by project id — a project's own "progress" is always computed from its linked tasks, never stored. */
  private async progressByProjectId(ctx: TenantRequestContext, projectIds: string[]) {
    if (projectIds.length === 0) return new Map<string, { total: number; done: number }>();
    const tasks = await ctx.tenantDb.task.findMany({
      where: { relatedModule: 'project', relatedEntityId: { in: projectIds } },
      select: { relatedEntityId: true, status: true },
    });
    const map = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      const id = t.relatedEntityId!;
      const entry = map.get(id) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (t.status === 'DONE') entry.done += 1;
      map.set(id, entry);
    }
    return map;
  }

  async list(ctx: TenantRequestContext, filters: { status?: string; contactId?: string; q?: string }, scope: Record<string, unknown> = {}) {
    const term = normalizeSearchTerm(filters.q);
    const no = term ? searchTermAsInt(term) : undefined;
    const projects = await ctx.tenantDb.project.findMany({
      where: {
        ...scope,
        ...(term
          ? {
              OR: [
                ...(no !== undefined ? [{ projectNo: no }] : []),
                { name: { contains: term, mode: 'insensitive' as const } },
                { contact: { name: { contains: term, mode: 'insensitive' as const } } },
                { contact: { company: { contains: term, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
      },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const progress = await this.progressByProjectId(ctx, projects.map((p) => p.id));
    return projects.map((p) => ({ ...presentProject(p), progress: progress.get(p.id) ?? { total: 0, done: 0 } }));
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    const project = await ctx.tenantDb.project.findFirst({ where: { id, ...scope }, include: PROJECT_INCLUDE });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    const progress = await this.progressByProjectId(ctx, [id]);
    return { ...presentProject(project), progress: progress.get(id) ?? { total: 0, done: 0 } };
  }

  async create(ctx: TenantRequestContext, dto: CreateProjectDto) {
    const createdByUserId = await resolveTenantUserId(ctx);

    let stageItems: Array<{ title: string; order: number }> = [];
    if (dto.stageTemplateId) {
      const template = await ctx.tenantDb.projectStageTemplate.findUnique({
        where: { id: dto.stageTemplateId },
        include: { items: { orderBy: { order: 'asc' } } },
      });
      if (!template) throw new NotFoundException('الگوی مراحل انتخاب‌شده یافت نشد');
      stageItems = template.items.map((i) => ({ title: i.title, order: i.order }));
    }

    const memberUserIds = [...new Set(dto.memberUserIds ?? [])];

    const created = await ctx.tenantDb.project.create({
      data: {
        name: dto.name,
        contactId: dto.contactId,
        managerUserId: dto.managerUserId,
        budget: dto.budget,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
        createdByUserId,
        ...(stageItems.length > 0 ? { stages: { create: stageItems } } : {}),
        ...(memberUserIds.length > 0 ? { members: { create: memberUserIds.map((userId) => ({ userId })) } } : {}),
      },
      include: PROJECT_INCLUDE,
    });
    return presentProject(created);
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateProjectDto) {
    const existing = await ctx.tenantDb.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('پروژه یافت نشد');
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new ConflictException('پروژه‌ی تکمیل‌شده یا لغوشده قابل ویرایش نیست');
    }

    if (dto.memberUserIds) {
      const memberUserIds = [...new Set(dto.memberUserIds)];
      await ctx.tenantDb.projectMember.deleteMany({ where: { projectId: id } });
      if (memberUserIds.length > 0) {
        await ctx.tenantDb.projectMember.createMany({ data: memberUserIds.map((userId) => ({ projectId: id, userId })) });
      }
    }

    const updated = await ctx.tenantDb.project.update({
      where: { id },
      data: {
        name: dto.name,
        contactId: dto.contactId,
        managerUserId: dto.managerUserId,
        budget: dto.budget,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
      },
      include: PROJECT_INCLUDE,
    });
    return presentProject(updated);
  }

  private async transition(ctx: TenantRequestContext, id: string, allowedFrom: readonly string[], status: string, smsEvent?: (from: string) => SmsEventKey | null) {
    const existing = await ctx.tenantDb.project.findUnique({ where: { id }, include: PROJECT_INCLUDE });
    if (!existing) throw new NotFoundException('پروژه یافت نشد');
    if (!allowedFrom.includes(existing.status)) {
      throw new ConflictException('این تغییر وضعیت برای پروژه با وضعیت فعلی مجاز نیست');
    }
    const result = presentProject(await ctx.tenantDb.project.update({ where: { id }, data: { status: status as never }, include: PROJECT_INCLUDE }));
    const ev = smsEvent?.(existing.status);
    if (ev) this.fireSms(ctx, id, ev);
    return result;
  }

  start(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['PLANNING', 'ON_HOLD'], 'ACTIVE', (from) => (from === 'ON_HOLD' ? 'projectResumed' : null));
  }

  hold(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['ACTIVE'], 'ON_HOLD', () => 'projectOnHold');
  }

  async complete(ctx: TenantRequestContext, id: string) {
    const project = await this.transition(ctx, id, [...ACTIVE_STATUSES], 'COMPLETED', () => 'projectCompleted');
    await this.automation.emit(ctx, 'projects.project.completed', {
      projectNo: project.projectNo,
      name: project.name,
      managerUserId: project.managerUserId,
    });
    return project;
  }

  cancel(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, [...ACTIVE_STATUSES], 'CANCELLED', () => 'projectCancelled');
  }

  // ── مراحل پروژه ──────────────────────────────────────────────────────

  async addStage(ctx: TenantRequestContext, projectId: string, title: string, responsibleUserId?: string, requiresManagerApproval = true) {
    const project = await ctx.tenantDb.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    const last = await ctx.tenantDb.projectStage.findFirst({ where: { projectId }, orderBy: { order: 'desc' } });
    return ctx.tenantDb.projectStage.create({
      data: { projectId, title: title.trim(), order: (last?.order ?? -1) + 1, responsibleUserId, requiresManagerApproval },
      include: STAGE_FULL_INCLUDE,
    });
  }

  /** تغییر یا حذف مسئول یک مرحله — در هر وضعیتی از مرحله قابل انجام است. */
  async assignStage(ctx: TenantRequestContext, projectId: string, stageId: string, responsibleUserId: string | undefined) {
    await this.findStage(ctx, projectId, stageId);
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { responsibleUserId: responsibleUserId ?? null },
      include: STAGE_FULL_INCLUDE,
    });
  }

  /**
   * ویرایش مرحله. تغییر «نیاز به تأیید مدیر» فقط با دسترسی ویرایش پروژه (کنترلر) و سمت سرور:
   * خاموش‌کردنِ آن وقتی مرحله درخواست تأیید در انتظار دارد رد می‌شود (ایمن‌ترین گزینه: بدون دورزدن
   * تصمیم مدیر؛ ابتدا باید درخواست تأیید/رد شود).
   */
  async updateStage(
    ctx: TenantRequestContext,
    projectId: string,
    stageId: string,
    dto: {
      title?: string;
      responsibleUserId?: string | null;
      requiresManagerApproval?: boolean;
      description?: string | null;
      descriptionVisibleToCustomer?: boolean;
    },
  ) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (dto.requiresManagerApproval === false && stage.requiresManagerApproval && stage.status === 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله یک درخواست تأیید در انتظار دارد؛ ابتدا آن را تأیید یا رد کنید، سپس نیاز به تأیید مدیر را خاموش کنید');
    }
    const description = dto.description === undefined ? undefined : (dto.description ?? '').trim() || null;
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.responsibleUserId !== undefined ? { responsibleUserId: dto.responsibleUserId || null } : {}),
        ...(dto.requiresManagerApproval !== undefined ? { requiresManagerApproval: dto.requiresManagerApproval } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(dto.descriptionVisibleToCustomer !== undefined ? { descriptionVisibleToCustomer: dto.descriptionVisibleToCustomer } : {}),
      },
      include: STAGE_FULL_INCLUDE,
    });
  }

  async removeStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    await this.findStage(ctx, projectId, stageId);
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.attachment.deleteMany({ where: { entityType: 'ProjectStage', entityId: stageId } }),
      ctx.tenantDb.projectStage.delete({ where: { id: stageId } }),
    ]);
    return { success: true };
  }

  /** حذف کامل پروژه — مراحل و اعضا خودکار پاک می‌شوند و وظایف مرتبط هم حذف می‌شوند؛ اگر فاکتوری به پروژه وصل باشد اجازه نمی‌دهد. */
  async remove(ctx: TenantRequestContext, id: string) {
    const project = await ctx.tenantDb.project.findUnique({ where: { id }, include: { _count: { select: { invoices: true } } } });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    if (project._count.invoices > 0) {
      throw new ConflictException('به این پروژه فاکتور متصل است؛ به‌جای حذف، پروژه را لغو کنید');
    }
    const stageIds = (await ctx.tenantDb.projectStage.findMany({ where: { projectId: id }, select: { id: true } })).map((st) => st.id);
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.attachment.deleteMany({ where: { entityType: 'ProjectStage', entityId: { in: stageIds } } }),
      ctx.tenantDb.task.deleteMany({ where: { relatedModule: 'project', relatedEntityId: id } }),
      ctx.tenantDb.project.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  private async findStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await ctx.tenantDb.projectStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.projectId !== projectId) throw new NotFoundException('مرحله یافت نشد');
    return stage;
  }

  /**
   * اجراکننده درخواست شروع مرحله می‌دهد. اگر مرحله «نیاز به تأیید مدیر» دارد، درخواست تأیید ساخته می‌شود؛
   * وگرنه (تأیید خاموش) مرحله مستقیم «در حال اجرا» می‌شود و فقط مدیر پروژه مطلع می‌شود.
   */
  async requestStageStart(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'PENDING' && stage.status !== 'REJECTED') {
      throw new ConflictException('این مرحله در وضعیتی نیست که بتوان درخواست شروع داد');
    }
    const requestedByUserId = await resolveTenantUserId(ctx);
    if (!stage.requiresManagerApproval) {
      const updated = await ctx.tenantDb.projectStage.update({
        where: { id: stageId },
        data: { status: 'IN_PROGRESS', requestedAt: new Date(), requestedByUserId, rejectionReason: null },
        include: STAGE_FULL_INCLUDE,
      });
      await this.notifyManager(ctx, projectId, requestedByUserId, 'projects.stage.started', `مرحله‌ی «${stage.title}» بدون نیاز به تأیید شروع شد`);
      this.fireSms(ctx, projectId, 'stageStarted', stageId);
      return updated;
    }
    await this.approvals.request(ctx, {
      moduleCode: 'projects',
      entityType: 'PROJECT_STAGE',
      entityId: stageId,
      title: `شروع مرحله‌ی «${stage.title}»`,
      summary: 'اجراکننده درخواست شروع مرحله داده و منتظر تأیید مدیر است.',
      link: '/projects',
      requestedByUserId: requestedByUserId ?? undefined,
    });
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'AWAITING_APPROVAL', requestedAt: new Date(), requestedByUserId, rejectionReason: null },
      include: STAGE_FULL_INCLUDE,
    });
  }

  /** اعلان به مدیر پروژه برای رویدادهای بدون تأیید (خودِ اقدام‌کننده اعلان نمی‌گیرد). */
  private async notifyManager(ctx: TenantRequestContext, projectId: string, actorUserId: string | null, type: string, title: string) {
    try {
      const project = await ctx.tenantDb.project.findUnique({ where: { id: projectId }, select: { managerUserId: true, name: true } });
      if (!project?.managerUserId || project.managerUserId === actorUserId) return;
      await this.notifications.notify(ctx.tenantDb, { userId: project.managerUserId, type, title, body: project.name, link: `/projects?id=${projectId}` });
    } catch {
      /* اعلان هرگز عملیات اصلی را نمی‌شکند */
    }
  }

  /** تأیید مدیر برای اجرای مرحله — دسترسی سطح مدیریتی (assertDelete روی ماژول projects) در کنترلر بررسی می‌شود. */
  async approveStage(ctx: TenantRequestContext, projectId: string, stageId: string, fromApprovals = false) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله منتظر تأیید نیست');
    }
    const approvedByUserId = await resolveTenantUserId(ctx);
    if (!fromApprovals) await this.approvals.closeForEntity(ctx, 'PROJECT_STAGE', stageId, 'APPROVED');
    const approved = await ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'IN_PROGRESS', approvedAt: new Date(), approvedByUserId },
      include: STAGE_FULL_INCLUDE,
    });
    this.fireSms(ctx, projectId, 'stageStarted', stageId);
    return approved;
  }

  async rejectStage(ctx: TenantRequestContext, projectId: string, stageId: string, reason: string | undefined, fromApprovals = false) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله منتظر تأیید نیست');
    }
    if (!fromApprovals) await this.approvals.closeForEntity(ctx, 'PROJECT_STAGE', stageId, 'REJECTED');
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'REJECTED', rejectionReason: reason },
      include: STAGE_FULL_INCLUDE,
    });
  }

  /**
   * تکمیل مرحله. مرحله‌ی «نیازمند تأیید مدیر» فقط از وضعیت «در حال اجرا» (یعنی پس از تأیید) تکمیل می‌شود.
   * مرحله‌ی بدون نیاز به تأیید را مسئول/ویرایشگر مستقیم می‌بندد (حتی بدون شروع جداگانه).
   */
  async completeStage(ctx: TenantRequestContext, projectId: string, stageId: string, report: string | undefined) {
    const stage = await this.findStage(ctx, projectId, stageId);
    const directAllowed = !stage.requiresManagerApproval && (stage.status === 'PENDING' || stage.status === 'REJECTED');
    if (stage.status !== 'IN_PROGRESS' && !directAllowed) {
      throw new ConflictException('فقط مرحله‌ی در حال اجرا قابل تکمیل است');
    }
    const actor = await resolveTenantUserId(ctx);
    const updated = await ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'DONE', completedAt: new Date(), completionReport: report, ...(directAllowed ? { requestedAt: new Date(), requestedByUserId: actor } : {}) },
      include: STAGE_FULL_INCLUDE,
    });
    if (directAllowed) {
      await this.notifyManager(ctx, projectId, actor, 'projects.stage.completed', `مرحله‌ی «${stage.title}» بدون نیاز به تأیید تکمیل شد`);
    }
    this.fireSms(ctx, projectId, 'stageCompleted', stageId);
    return updated;
  }

  // ── فاکتورهای پروژه ──────────────────────────────────────────────────

  listInvoices(ctx: TenantRequestContext, projectId: string) {
    return ctx.tenantDb.salesInvoice.findMany({
      where: { projectId },
      select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true, issuedAt: true, projectShowOnPublicLink: true },
      orderBy: { issuedAt: 'desc' },
    });
  }
}
