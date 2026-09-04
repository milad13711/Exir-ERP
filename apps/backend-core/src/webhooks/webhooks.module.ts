import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [ModuleGuardModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
