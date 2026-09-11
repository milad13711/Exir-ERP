import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import { AFTER_SALES_MODULE_CODE } from './after-sales.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class AfterSalesAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'afterSales.service.requested',
      moduleCode: AFTER_SALES_MODULE_CODE,
      label: 'ثبت درخواست خدمات پس از فروش',
      description: 'وقتی مشتری برای یک گارانتی فعال، درخواست خدمات پس از فروش ثبت می‌کند.',
      payloadFields: [
        { key: 'code', label: 'کد گارانتی', type: 'STRING' },
        { key: 'description', label: 'شرح مشکل', type: 'STRING' },
      ],
    });
  }
}
