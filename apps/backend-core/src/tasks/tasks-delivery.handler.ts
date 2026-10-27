import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationDeliveryService, type DeliveryEvent } from '../notifications/notification-delivery.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TasksService } from './tasks.service.js';

/**
 * پل «تحویل اعلان» ⇒ تیک خاکستری وظیفه: وقتی اعلانِ مربوط به یک وظیفه به دستگاه/برنامه‌ی ارجاع‌گیرنده رسید
 * (ack پوش / زنگوله / سوکت)، همان وظیفه برای همان کاربر «دریافت‌شد» می‌شود. فقط ردیف خودِ کاربر اعلان.
 */
@Injectable()
export class TasksDeliveryHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TasksDeliveryHandler');
  private unregister: (() => void) | null = null;

  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit(): void {
    this.unregister = this.delivery.registerHandler((evt) => this.handle(evt));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  async handle(evt: DeliveryEvent): Promise<void> {
    if (!evt.tenantId || (evt.entityType && evt.entityType.toLowerCase() !== 'task' && !evt.link)) return;
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: evt.tenantId } });
    if (!tenant) return;
    const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    const n = await this.tasks.handleNotificationDelivered(db, evt);
    if (n > 0) this.logger.debug(`task delivered via notification ${evt.notificationId}`);
  }
}
