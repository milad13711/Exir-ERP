import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class FormsAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'forms.submission.received',
      moduleCode: 'forms',
      label: 'ثبت پاسخ فرم',
      description: 'وقتی یک نظرسنجی، آزمون، پرسش‌نامه یا فرم ثبت‌نام پاسخ داده می‌شود.',
      payloadFields: [
        { key: 'formTitle', label: 'عنوان فرم', type: 'STRING' },
        { key: 'respondentName', label: 'نام پاسخ‌دهنده', type: 'STRING' },
        { key: 'respondentPhone', label: 'شماره پاسخ‌دهنده', type: 'STRING' },
      ],
    });
  }
}
