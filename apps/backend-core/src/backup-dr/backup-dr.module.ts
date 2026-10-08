import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { AdminBackupsController } from './admin-backups.controller.js';
import { BackupDrService } from './backup-dr.service.js';

// JwtModule is global (AppModule), so AdminJwtAuthGuard resolves here without extra imports.
@Module({
  imports: [SmsModule],
  controllers: [AdminBackupsController],
  providers: [BackupDrService],
  exports: [BackupDrService],
})
export class BackupDrModule {}
