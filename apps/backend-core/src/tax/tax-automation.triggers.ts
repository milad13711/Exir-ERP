import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import type { TriggerPayloadField } from '../automation/types.js';

const FIELDS: TriggerPayloadField[] = [
  { key: 'invoiceNo', label: 'شماره فاکتور', type: 'NUMBER' },
  { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
  { key: 'amount', label: 'مبلغ فاکتور (تومان)', type: 'NUMBER' },
  { key: 'taxid', label: 'شماره منحصر به فرد مالیاتی', type: 'STRING' },
  { key: 'errorSummary', label: 'خلاصه‌ی خطاها', type: 'STRING' },
  { key: 'ownerUserId', label: 'درخواست‌دهنده', type: 'USER_ID' },
];

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts. */
@Injectable()
export class TaxAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({ code: 'tax.invoice.accepted', moduleCode: 'tax', label: 'پذیرش صورتحساب توسط سامانه مودیان', description: 'وقتی سازمان امور مالیاتی صورتحساب ارسالی را می‌پذیرد.', payloadFields: FIELDS });
    this.registry.register({ code: 'tax.invoice.rejected', moduleCode: 'tax', label: 'رد صورتحساب توسط سامانه مودیان', description: 'وقتی سامانه مودیان صورتحساب را رد می‌کند و باید اصلاح شود.', payloadFields: FIELDS });
  }
}
