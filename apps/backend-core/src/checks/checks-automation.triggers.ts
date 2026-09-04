import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's trigger into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class ChecksAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'checks.check.bounced',
      moduleCode: 'checks',
      label: 'برگشت خوردن چک',
      description: 'وقتی یک چک (دریافتی یا پرداختی) برگشت می‌خورد — علاوه بر هشدار اجباری فعلی، برای اقدام‌های سفارشی (مثلاً پیامک به یک مسئول دیگر یا ثبت وظیفه‌ی پیگیری حقوقی).',
      payloadFields: [
        { key: 'sayadId', label: 'شناسه صیادی چک', type: 'STRING' },
        { key: 'amount', label: 'مبلغ چک', type: 'NUMBER' },
        { key: 'contactName', label: 'نام طرف حساب', type: 'STRING' },
        { key: 'direction', label: 'جهت چک (دریافتی/پرداختی)', type: 'STRING' },
      ],
    });
  }
}
