import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';
import type { UpdateProjectDto } from './dto/update-project.dto.js';

const PROJECT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true } },
  manager: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  stages: {
    orderBy: { order: 'asc' as const },
    include: {
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  },
} as const;

const ACTIVE_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD'] as const;

@Injectable()
export class ProjectsService {
  constructor(private readonly automation: AutomationEngineService) {}

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

  async addStage(ctx: TenantRequestContext, projectId: string, title: string) {
    const project = await ctx.tenantDb.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('پروژه یافت نشد');
    const last = await ctx.tenantDb.projectStage.findFirst({ where: { projectId }, orderBy: { order: 'desc' } });
    return ctx.tenantDb.projectStage.create({
      data: { projectId, title, order: (last?.order ?? -1) + 1 },
      include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
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
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'AWAITING_APPROVAL', requestedAt: new Date(), requestedByUserId, rejectionReason: null },
      include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });
  }

  /** تأیید مدیر برای اجرای مرحله — دسترسی سطح مدیریتی (assertDelete روی ماژول projects) در کنترلر بررسی می‌شود. */
  async approveStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله منتظر تأیید نیست');
    }
    const approvedByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'IN_PROGRESS', approvedAt: new Date(), approvedByUserId },
      include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });
  }

  async rejectStage(ctx: TenantRequestContext, projectId: string, stageId: string, reason: string | undefined) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new ConflictException('این مرحله منتظر تأیید نیست');
    }
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'REJECTED', rejectionReason: reason },
      include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });
  }

  async completeStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await this.findStage(ctx, projectId, stageId);
    if (stage.status !== 'IN_PROGRESS') {
      throw new ConflictException('فقط مرحله‌ی در حال اجرا قابل تکمیل است');
    }
    return ctx.tenantDb.projectStage.update({
      where: { id: stageId },
      data: { status: 'DONE', completedAt: new Date() },
      include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
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
