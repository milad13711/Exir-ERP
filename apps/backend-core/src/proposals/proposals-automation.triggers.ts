import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import type { TriggerPayloadField } from '../automation/types.js';

const FIELDS: TriggerPayloadField[] = [
  { key: 'proposalNo', label: 'شماره پروپوزال', type: 'NUMBER' },
  { key: 'title', label: 'عنوان پروپوزال', type: 'STRING' },
  { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
  { key: 'customerPhone', label: 'تلفن مشتری', type: 'PHONE' },
  { key: 'amount', label: 'مبلغ پروژه', type: 'NUMBER' },
  { key: 'ownerUserId', label: 'کارشناس مسئول پروپوزال', type: 'USER_ID' },
];

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class ProposalsAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({ code: 'proposals.proposal.viewed', moduleCode: 'proposals', label: 'اولین مشاهده‌ی پروپوزال توسط مشتری', description: 'وقتی مشتری برای اولین بار لینک پروپوزال را باز می‌کند.', payloadFields: FIELDS });
    this.registry.register({
      code: 'proposals.proposal.accepted',
      moduleCode: 'proposals',
      label: 'پذیرش پروپوزال توسط مشتری',
      description: 'وقتی مشتری پروپوزال را با امضای الکترونیک می‌پذیرد — مناسب برای پیامک تشکر یا صدور فاکتور.',
      payloadFields: [...FIELDS, { key: 'acceptedByName', label: 'نام تأییدکننده', type: 'STRING' }],
    });
    this.registry.register({ code: 'proposals.proposal.rejected', moduleCode: 'proposals', label: 'رد پروپوزال توسط مشتری', description: 'وقتی مشتری پروپوزال را رد می‌کند.', payloadFields: FIELDS });
    this.registry.register({ code: 'proposals.proposal.revision_requested', moduleCode: 'proposals', label: 'درخواست اصلاح پروپوزال', description: 'وقتی مشتری برای پروپوزال درخواست اصلاح ثبت می‌کند.', payloadFields: FIELDS });
  }
}
