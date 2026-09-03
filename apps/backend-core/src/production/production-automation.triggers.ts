import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import type { TriggerPayload } from '../automation/types.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class ProductionAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'production.order.created',
      moduleCode: 'production',
      label: 'ثبت دستور تولید جدید',
      description: 'وقتی یک دستور تولید تازه (پیش‌نویس) ثبت می‌شود — پیش از تأیید مواد اولیه.',
      payloadFields: [
        { key: 'orderNo', label: 'شماره دستور تولید', type: 'NUMBER' },
        { key: 'productName', label: 'نام محصول', type: 'STRING' },
        { key: 'quantityPlanned', label: 'مقدار برنامه‌ریزی‌شده', type: 'NUMBER' },
        { key: 'warehouseName', label: 'نام انبار', type: 'STRING' },
      ],
      resolvePayload: async (ctx, entityId) => {
        const order = await ctx.tenantDb.productionOrder.findUniqueOrThrow({
          where: { id: entityId },
          include: { bom: { include: { outputProduct: true } }, warehouse: true },
        });
        return orderCreatedPayload(order);
      },
    });

    this.registry.register({
      code: 'production.stage.completed',
      moduleCode: 'production',
      label: 'پایان یک مرحله‌ی تولید',
      description: 'وقتی یک مرحله از خط تولید به «انجام‌شده» تغییر می‌کند — برای اطلاع‌رسانی به مسئول مرحله‌ی بعد.',
      payloadFields: [
        { key: 'orderNo', label: 'شماره دستور تولید', type: 'NUMBER' },
        { key: 'productName', label: 'نام محصول', type: 'STRING' },
        { key: 'stageName', label: 'نام مرحله‌ی تمام‌شده', type: 'STRING' },
        { key: 'nextStageName', label: 'نام مرحله‌ی بعدی', type: 'STRING' },
        { key: 'nextStageAssigneeUserId', label: 'مسئول مرحله‌ی بعد', type: 'USER_ID' },
      ],
    });
  }
}

export function orderCreatedPayload(order: {
  orderNo: number;
  quantityPlanned: number;
  bom: { outputProduct: { name: string } };
  warehouse: { name: string };
}): TriggerPayload {
  return {
    orderNo: order.orderNo,
    productName: order.bom.outputProduct.name,
    quantityPlanned: order.quantityPlanned,
    warehouseName: order.warehouse.name,
  };
}
