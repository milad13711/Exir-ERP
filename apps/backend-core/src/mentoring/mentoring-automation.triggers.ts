import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class MentoringAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'mentoring.session.scheduled',
      moduleCode: 'mentoring',
      label: 'ثبت نوبت جلسه‌ی مشاوره',
      description: 'وقتی یک جلسه‌ی جدید برای یک همکاری زمان‌بندی می‌شود.',
      payloadFields: [
        { key: 'engagementTitle', label: 'عنوان همکاری', type: 'STRING' },
        { key: 'contactName', label: 'نام مشتری', type: 'STRING' },
        { key: 'advisorName', label: 'نام مشاور', type: 'STRING' },
        { key: 'scheduledAt', label: 'زمان جلسه', type: 'STRING' },
        { key: 'mode', label: 'نحوه‌ی برگزاری', type: 'STRING' },
      ],
    });

    this.registry.register({
      code: 'mentoring.session.completed',
      moduleCode: 'mentoring',
      label: 'پایان جلسه‌ی مشاوره',
      description: 'وقتی یک جلسه تکمیل می‌شود — مناسب برای تعریف پیامک‌های پیگیری اجرای امور با تأخیر دلخواه.',
      payloadFields: [
        { key: 'engagementTitle', label: 'عنوان همکاری', type: 'STRING' },
        { key: 'contactName', label: 'نام مشتری', type: 'STRING' },
        { key: 'scheduledAt', label: 'زمان جلسه', type: 'STRING' },
      ],
    });
  }
}
