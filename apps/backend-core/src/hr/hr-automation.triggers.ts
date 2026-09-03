import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class HrAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'hr.leave.approved',
      moduleCode: 'hr',
      label: 'تأیید مرخصی کارمند',
      description: 'وقتی درخواست مرخصی یک کارمند تأیید می‌شود.',
      payloadFields: [
        { key: 'employeeName', label: 'نام کارمند', type: 'STRING' },
        { key: 'employeeUserId', label: 'کاربر کارمند', type: 'USER_ID' },
        { key: 'startDate', label: 'تاریخ شروع', type: 'STRING' },
        { key: 'endDate', label: 'تاریخ پایان', type: 'STRING' },
        { key: 'daysCount', label: 'تعداد روز', type: 'NUMBER' },
      ],
    });
  }
}
