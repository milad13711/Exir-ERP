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
}
