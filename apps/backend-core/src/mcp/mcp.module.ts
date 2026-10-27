import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { PurchasingModule } from '../purchasing/purchasing.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { CorrespondenceModule } from '../correspondence/correspondence.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { McpController } from './mcp.controller.js';
import { AiActionsController } from './ai-actions.controller.js';
import { McpToolsService } from './mcp-tools.service.js';
import { AiActionService } from './ai-action.service.js';
import { AiApprovalGateway } from './ai-approval.gateway.js';

@Module({
  imports: [ModuleGuardModule, NotificationsModule, SalesModule, PurchasingModule, TasksModule, OperationsModule, CorrespondenceModule, DispatchModule, BookingModule, CrmModule, DashboardModule],
  controllers: [McpController, AiActionsController],
  providers: [McpToolsService, AiActionService, AiApprovalGateway],
})
export class McpModule {}
