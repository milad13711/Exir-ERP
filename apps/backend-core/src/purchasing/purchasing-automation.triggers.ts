import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's trigger into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class PurchasingAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'purchasing.order.approved',
      moduleCode: 'purchasing',
      label: 'تأیید سفارش خرید',
      description: 'وقتی یک سفارش خرید توسط مدیر تأیید می‌شود — برای اطلاع‌رسانی به تأمین‌کننده یا مسئول پیگیری خرید.',
      payloadFields: [
        { key: 'orderNo', label: 'شماره سفارش خرید', type: 'NUMBER' },
        { key: 'supplierName', label: 'نام تأمین‌کننده', type: 'STRING' },
        { key: 'supplierPhone', label: 'تلفن تأمین‌کننده', type: 'PHONE' },
        { key: 'total', label: 'مبلغ کل سفارش', type: 'NUMBER' },
      ],
    });
  }
}
