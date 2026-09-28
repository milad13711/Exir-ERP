import { Global, Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';
import { SchedulableJobRegistryService } from './schedulable-job-registry.service.js';

/**
 * @Global() so any cron service anywhere in the app can inject
 * SchedulableJobRegistryService/SchedulingService straight from its own
 * constructor without also having to import SchedulingModule — the same
 * choice ApprovalsModule makes for ApprovalsService.registerHandler.
 */
@Global()
@Module({
  controllers: [SchedulingController],
  providers: [SchedulableJobRegistryService, SchedulingService],
  exports: [SchedulableJobRegistryService, SchedulingService],
})
export class SchedulingModule {}
