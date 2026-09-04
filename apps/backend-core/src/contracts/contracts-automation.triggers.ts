import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class ContractsAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'contracts.contract.signed',
      moduleCode: 'contracts',
      label: 'امضای قرارداد',
      description: 'وقتی یک قرارداد از پیش‌نویس به فعال تغییر وضعیت می‌دهد.',
      payloadFields: [
        { key: 'contractNo', label: 'شماره قرارداد', type: 'NUMBER' },
        { key: 'title', label: 'عنوان قرارداد', type: 'STRING' },
        { key: 'contactName', label: 'طرف قرارداد', type: 'STRING' },
        { key: 'value', label: 'ارزش قرارداد', type: 'NUMBER' },
      ],
    });

    this.registry.register({
      code: 'contracts.contract.expiring_soon',
      moduleCode: 'contracts',
      label: 'نزدیک شدن به پایان قرارداد',
      description: 'وقتی یک قرارداد فعال به بازه‌ی یادآوری پیش از پایان می‌رسد.',
      payloadFields: [
        { key: 'contractNo', label: 'شماره قرارداد', type: 'NUMBER' },
        { key: 'title', label: 'عنوان قرارداد', type: 'STRING' },
        { key: 'contactName', label: 'طرف قرارداد', type: 'STRING' },
        { key: 'endDate', label: 'تاریخ پایان', type: 'STRING' },
      ],
    });

    this.registry.register({
      code: 'contracts.contract.terminated',
      moduleCode: 'contracts',
      label: 'فسخ قرارداد',
      description: 'وقتی یک قرارداد فعال فسخ می‌شود.',
      payloadFields: [
        { key: 'contractNo', label: 'شماره قرارداد', type: 'NUMBER' },
        { key: 'title', label: 'عنوان قرارداد', type: 'STRING' },
        { key: 'contactName', label: 'طرف قرارداد', type: 'STRING' },
        { key: 'reason', label: 'دلیل فسخ', type: 'STRING' },
      ],
    });
  }
}
