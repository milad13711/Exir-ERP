import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's trigger into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class VoipAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'voip.call.incoming',
      moduleCode: 'voip',
      label: 'تماس ورودی',
      description: 'وقتی یک تماس ورودی به داخلی یکی از کاربران می‌رسد — علاوه بر پاپ‌آپ خودکار، برای اقدام‌های سفارشی (مثلاً پیامک به یک مسئول دیگر).',
      payloadFields: [
        { key: 'fromNumber', label: 'شماره‌ی تماس‌گیرنده', type: 'PHONE' },
        { key: 'contactName', label: 'نام مخاطب (در صورت شناسایی)', type: 'STRING' },
        { key: 'calleeUserId', label: 'کاربری که تماس به او رسیده', type: 'USER_ID' },
      ],
    });
  }
}
