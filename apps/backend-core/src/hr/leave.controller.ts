import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto.js';

/**
 * Walks the manager chain upward from `employeeId` and returns true if
 * `candidateManagerEmployeeId` appears anywhere above it — i.e. is the
 * employee's direct manager OR any manager further up the org chart, not
 * just the immediate one. Bounded to a sane depth as a guard against a
 * corrupted/cyclic managerId chain.
 */
async function isInManagerChain(
  tenantDb: TenantRequestContext['tenantDb'],
  employeeId: string,
  candidateManagerEmployeeId: string,
): Promise<boolean> {
  let currentId: string | null = employeeId;
  for (let depth = 0; depth < 20 && currentId; depth++) {
    const current: { managerId: string | null } | null = await tenantDb.employee.findUnique({
      where: { id: currentId },
      select: { managerId: true },
    });
    if (!current?.managerId) return false;
    if (current.managerId === candidateManagerEmployeeId) return true;
    currentId = current.managerId;
  }
  return false;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Controller('hr/leave')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class LeaveController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'hr');
    return ctx.tenantDb.leaveRequest.findMany({
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateLeaveRequestDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد');

    await ctx.tenantDb.employee.findUniqueOrThrow({ where: { id: dto.employeeId } });
    const daysCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;

    return ctx.tenantDb.leaveRequest.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        startDate: start,
        endDate: end,
        daysCount,
        reason: dto.reason,
      },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    });
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.review(id, 'APPROVED', ctx);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.review(id, 'REJECTED', ctx);
  }

  private async review(id: string, status: 'APPROVED' | 'REJECTED', ctx: TenantRequestContext) {
    const request = await ctx.tenantDb.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('درخواست مرخصی یافت نشد');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('این درخواست قبلاً بررسی شده است');
    }

    // OWNER/ADMIN can always review. Otherwise, only a manager somewhere
    // above the requester in the org chart may approve/reject their leave —
    // enforced via each employee's own linked userId, since that's the only
    // way to map "the logged-in account" back to a position in the chart.
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      const reviewerUserId = await resolveTenantUserId(ctx);
      const reviewerEmployee = reviewerUserId
        ? await ctx.tenantDb.employee.findUnique({ where: { userId: reviewerUserId } })
        : null;
      const isManager =
        reviewerEmployee && (await isInManagerChain(ctx.tenantDb, request.employeeId, reviewerEmployee.id));
      if (!isManager) {
        throw new ForbiddenException('فقط مدیر بالادستی این کارمند می‌تواند این درخواست را بررسی کند');
      }
    }

    const reviewedByUserId = await resolveTenantUserId(ctx);
    const updated = await ctx.tenantDb.leaveRequest.update({
      where: { id },
      data: { status, reviewedByUserId, reviewedAt: new Date() },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true, userId: true } } },
    });

    if (updated.employee.userId) {
      const statusFa = status === 'APPROVED' ? 'تأیید شد' : 'رد شد';
      await this.notifications.notify(ctx.tenantDb, {
        userId: updated.employee.userId,
        type: 'leave.reviewed',
        title: `درخواست مرخصی شما ${statusFa}`,
        body: `درخواست مرخصی شما از ${updated.startDate.toLocaleDateString('fa-IR')} تا ${updated.endDate.toLocaleDateString('fa-IR')} ${statusFa}.`,
        link: '/hr',
      });
    }

    return updated;
  }
}
