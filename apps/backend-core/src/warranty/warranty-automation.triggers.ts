import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class WarrantyAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'warranty.code.activated',
      moduleCode: 'warranty',
      label: 'فعال‌سازی گارانتی',
      description: 'وقتی مشتری یک کد گارانتی را از طریق فرم عمومی فعال می‌کند.',
      payloadFields: [
        { key: 'code', label: 'کد گارانتی', type: 'STRING' },
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'customerPhone', label: 'موبایل مشتری', type: 'STRING' },
      ],
    });

    this.registry.register({
      code: 'warranty.service.requested',
      moduleCode: 'warranty',
      label: 'ثبت درخواست خدمات پس از فروش',
      description: 'وقتی مشتری برای یک گارانتی فعال، درخواست خدمات پس از فروش ثبت می‌کند.',
      payloadFields: [
        { key: 'code', label: 'کد گارانتی', type: 'STRING' },
        { key: 'description', label: 'شرح مشکل', type: 'STRING' },
      ],
    });
  }
}
