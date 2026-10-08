import { Global, Module } from '@nestjs/common';
import { SecurityEventsService } from './security-events.service.js';
import { SessionEpochService } from './session-epoch.service.js';
import { SessionVerifierService } from './session-verifier.service.js';
import { CspReportController } from './csp-report.controller.js';

/** سرویس‌های امنیتی مشترک (رویدادهای امنیتی، دوره‌ی نشست). سراسری تا گاردها بدون import مجدد استفاده کنند. */
@Global()
@Module({
  controllers: [CspReportController],
  providers: [SecurityEventsService, SessionEpochService, SessionVerifierService],
  exports: [SecurityEventsService, SessionEpochService, SessionVerifierService],
})
export class SecurityModule {}
