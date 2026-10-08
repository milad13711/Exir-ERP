import { ConflictException, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { BackupDrService } from './backup-dr.service.js';

/** Platform-owner-only backup health + manual triggers. SUPER_ADMIN only — backups contain every tenant's data. */
@Controller('admin/backups')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
@AdminTeams('SUPER_ADMIN')
export class AdminBackupsController {
  constructor(private readonly backups: BackupDrService) {}

  @Get('status')
  status() {
    return this.backups.getStatus();
  }

  @Post('run')
  @HttpCode(202)
  run() {
    if (this.backups.isRunning()) throw new ConflictException('یک عملیات بکاپ/آزمون بازیابی در حال اجراست');
    void this.backups.runAll().catch(() => {}); // failures are recorded in status + alerts
    return { started: true };
  }

  @Post('restore-test')
  @HttpCode(202)
  restoreTest() {
    if (this.backups.isRunning()) throw new ConflictException('یک عملیات بکاپ/آزمون بازیابی در حال اجراست');
    void this.backups.runRestoreTests().catch(() => {});
    return { started: true };
  }
}
