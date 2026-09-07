import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

@Injectable()
export class StoreAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'online-store.order.placed',
      moduleCode: 'online-store',
      label: 'ثبت سفارش جدید در فروشگاه آنلاین',
      description: 'وقتی یک بازدیدکننده از فروشگاه آنلاین سفارشی ثبت می‌کند.',
      payloadFields: [
        { key: 'orderNo', label: 'شماره سفارش', type: 'NUMBER' },
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'subtotal', label: 'مبلغ سفارش (تومان)', type: 'NUMBER' },
      ],
    });
  }
}
