import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

@Controller('admin/logs')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
@AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
export class AdminLogsController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('audit')
  audit(@Query('tenantId') tenantId?: string) {
    return this.controlDb.auditLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true, slug: true } } },
    });
  }

  @Get('errors')
  errors(@Query('tenantId') tenantId?: string) {
    return this.controlDb.errorLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true, slug: true } } },
    });
  }

  @Get('sms')
  sms(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.controlDb.smsLog.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(status === 'success' ? { success: true } : status === 'failed' ? { success: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true, slug: true } } },
    });
  }
}
