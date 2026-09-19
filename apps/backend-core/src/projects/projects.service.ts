import { ApprovalsService } from '../approvals/approvals.service.js';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';
import type { UpdateProjectDto } from './dto/update-project.dto.js';

const STAGE_INCLUDE = {
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
} as const;

const PROJECT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true } },
  manager: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  members: { include: { user: { select: { id: true, name: true } } } },
  stages: {
    orderBy: { order: 'asc' as const },
    include: STAGE_INCLUDE,
  },
} as const;

const ACTIVE_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD'] as const;

@Injectable()
export class ProjectsService implements OnModuleInit {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly approvals: ApprovalsService,
  ) {}

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

  async list(ctx: TenantRequestContext, filters: { status?: string; contactId?: string }) {
    const projects = await ctx.tenantDb.project.findMany({
      where: {
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
      },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const progress = await this.progressByProjectId(ctx, projects.map((p) => p.id));
    return projects.map((p) => ({ ...p, progress: progress.get(p.id) ?? { total: 0, done: 0 } }));
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const project = await ctx.tenantDb.project.findUnique({ where: { id }, include: PROJECT_INCLUDE });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    const progress = await this.progressByProjectId(ctx, [id]);
    return { ...project, progress: progress.get(id) ?? { total: 0, done: 0 } };
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

    return ctx.tenantDb.project.create({
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

    return ctx.tenantDb.project.update({
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
  }

  private async transition(ctx: TenantRequestContext, id: string, allowedFrom: readonly string[], status: string) {
    const existing = await ctx.tenantDb.project.findUnique({ where: { id }, include: PROJECT_INCLUDE });
    if (!existing) throw new NotFoundException('پروژه یافت نشد');
    if (!allowedFrom.includes(existing.status)) {
      throw new ConflictException('این تغییر وضعیت برای پروژه با وضعیت فعلی مجاز نیست');
    }
    return ctx.tenantDb.project.update({ where: { id }, data: { status: status as never }, include: PROJECT_INCLUDE });
  }

  start(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['PLANNING', 'ON_HOLD'], 'ACTIVE');
  }

  hold(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['ACTIVE'], 'ON_HOLD');
  }

  async complete(ctx: TenantRequestContext, id: string) {
    const project = await this.transition(ctx, id, [...ACTIVE_STATUSES], 'COMPLETED');
    await this.automation.emit(ctx, 'projects.project.completed', {
      projectNo: project.projectNo,
      name: project.name,
      managerUserId: project.managerUserId,
    });
    return project;
  }

  cancel(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, [...ACTIVE_STATUSES], 'CANCELLED');
  }

  // ── مراحل پروژه ──────────────────────────────────────────────────────

  async addStage(ctx: TenantRequestContext, projectId: string, title: string, responsibleUserId?: string) {
    const project = await ctx.tenantDb.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    const last = await ctx.tenantDb.projectStage.findFirst({ where: { projectId }, orderBy: { order: 'desc' } });
    return ctx.tenantDb.projectStage.create({
      data: { projectId, title, order: (last?.order ?? -1) + 1, responsibleUserId },
      include: STAGE_INCLUDE,
    });
  }

  /** تغییر یا حذف مسئول یک مرحله — در هر وضعیتی از مرحله قابل انجام است. */
  async assignStage(ctx: TenantRequestContext, projectId: string, stageId: string, responsibleUserId: string | undefined) {
    await this.findStage(ctx, projectId, stageId);
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { responsibleUserId: responsibleUserId ?? null },
      include: STAGE_INCLUDE,
    });
  }

  private async findStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await ctx.tenantDb.projectStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.projectId !== projectId) throw new NotFoundException('مرحله یافت نشد');
    return stage;
  }

  /** اجراکننده درخواست شروع مرحله می‌دهد — نیازمند تأیید مدیر پیش از اجرا. */
  async requestStageStart(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'PENDING' && stage.status !== 'REJECTED') {
      throw new ConflictException('این مرحله در وضعیتی نیست که بتوان درخواست شروع داد');
    }
    const requestedByUserId = await resolveTenantUserId(ctx);
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
      include: STAGE_INCLUDE,
    });
  }

  /** تأیید مدیر برای اجرای مرحله — دسترسی سطح مدیریتی (assertDelete روی ماژول projects) در کنترلر بررسی می‌شود. */
  async approveStage(ctx: TenantRequestContext, projectId: string, stageId: string, fromApprovals = false) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله منتظر تأیید نیست');
    }
    const approvedByUserId = await resolveTenantUserId(ctx);
    if (!fromApprovals) await this.approvals.closeForEntity(ctx, 'PROJECT_STAGE', stageId, 'APPROVED');
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'IN_PROGRESS', approvedAt: new Date(), approvedByUserId },
      include: STAGE_INCLUDE,
    });
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
      include: STAGE_INCLUDE,
    });
  }

  async completeStage(ctx: TenantRequestContext, projectId: string, stageId: string, report: string | undefined) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'IN_PROGRESS') {
      throw new ConflictException('فقط مرحله‌ی در حال اجرا قابل تکمیل است');
    }
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'DONE', completedAt: new Date(), completionReport: report },
      include: STAGE_INCLUDE,
    });
  }

  // ── فاکتورهای پروژه ──────────────────────────────────────────────────

  listInvoices(ctx: TenantRequestContext, projectId: string) {
    return ctx.tenantDb.salesInvoice.findMany({
      where: { projectId },
      select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true, issuedAt: true },
      orderBy: { issuedAt: 'desc' },
    });
  }
}
