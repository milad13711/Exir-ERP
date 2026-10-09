import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { MonitoringService } from './monitoring.service.js';

/** وضعیت پایش و هشدار — فقط SUPER_ADMIN (جزئیات زیرساخت و آدرس‌های داخلی را نشان می‌دهد). */
@Controller('admin/monitoring')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
@AdminTeams('SUPER_ADMIN')
export class AdminMonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('status')
  status() {
    return this.monitoring.getStatus();
  }

  /** اجرای فوری همه‌ی چک‌ها (بدون ارسال هشدار تکراری؛ dedupe همچنان برقرار است). */
  @Post('run')
  @HttpCode(202)
  run() {
    void this.monitoring.runChecks().catch(() => {});
    return { started: true };
  }

  @Post('test-alert')
  @HttpCode(200)
  testAlert() {
    return this.monitoring.sendTestAlert();
  }
}
