import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, OnModuleInit, Param, Post, UseGuards } from '@nestjs/common';
import { faDate } from '../common/persian.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto.js';
import { isInManagerChain } from './org-chain.util.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Controller('hr/leave')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class LeaveController implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
    private readonly automation: AutomationEngineService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('LEAVE_REQUEST', {
      approve: async (ctx, id) => {
        await this.review(id, 'APPROVED', ctx, true);
      },
      reject: async (ctx, id) => {
        await this.review(id, 'REJECTED', ctx, true);
      },
      describe: async (ctx, id) => {
        const l = await ctx.tenantDb.leaveRequest.findUniqueOrThrow({ where: { id }, include: { employee: true } });
        return {
          fields: [
            { label: 'پرسنل', value: `${l.employee.fullName} (${l.employee.employeeCode})` },
            { label: 'نوع مرخصی', value: l.type },
            { label: 'بازه', value: `${faDate(l.startDate)} تا ${faDate(l.endDate)} — ${l.daysCount} روز` },
            { label: 'دلیل', value: l.reason ?? '—' },
          ],
        };
      },
    });
  }

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

    const created = await ctx.tenantDb.leaveRequest.create({
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

    // تأییدکننده: مدیر مستقیم کارمند (اگر کاربر داشته باشد)، وگرنه مدیران سیستم
    const manager = await ctx.tenantDb.employee
      .findUnique({ where: { id: dto.employeeId }, select: { manager: { select: { userId: true } } } })
      .then((e) => e?.manager?.userId ?? undefined);
    await this.approvals.request(ctx, {
      moduleCode: 'hr',
      entityType: 'LEAVE_REQUEST',
      entityId: created.id,
      title: `درخواست مرخصی ${created.employee.fullName}`,
      summary: `${created.daysCount} روز — از ${faDate(created.startDate)} تا ${faDate(created.endDate)}`,
      link: '/hr',
      assigneeUserId: manager,
    });
    return created;
  }

  /** حذف درخواست مرخصی — فقط در انتظار/ردشده؛ مرخصی تأییدشده روی حقوق و حضور اثر دارد. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    const l = await ctx.tenantDb.leaveRequest.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('درخواست مرخصی یافت نشد');
    if (l.status === 'APPROVED') throw new ConflictException('مرخصی تأییدشده حذف نمی‌شود');
    await ctx.tenantDb.leaveRequest.delete({ where: { id } });
    await this.approvals.closeForEntity(ctx, 'LEAVE_REQUEST', id, 'REJECTED');
    return { success: true };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.review(id, 'APPROVED', ctx);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.review(id, 'REJECTED', ctx);
  }

  private async review(id: string, status: 'APPROVED' | 'REJECTED', ctx: TenantRequestContext, fromApprovals = false) {
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

    if (!fromApprovals) await this.approvals.closeForEntity(ctx, 'LEAVE_REQUEST', id, status);

    if (updated.employee.userId) {
      const statusFa = status === 'APPROVED' ? 'تأیید شد' : 'رد شد';
      await this.notifications.notify(ctx.tenantDb, {
        userId: updated.employee.userId,
        type: 'leave.reviewed',
        title: `درخواست مرخصی شما ${statusFa}`,
        body: `درخواست مرخصی شما از ${faDate(updated.startDate)} تا ${faDate(updated.endDate)} ${statusFa}.`,
        link: '/hr',
      });
    }

    if (status === 'APPROVED' && updated.employee.userId) {
      await this.automation.emit(ctx, 'hr.leave.approved', {
        employeeName: updated.employee.fullName,
        employeeUserId: updated.employee.userId,
        startDate: faDate(updated.startDate),
        endDate: faDate(updated.endDate),
        daysCount: updated.daysCount,
      });
    }

    return updated;
  }
}
