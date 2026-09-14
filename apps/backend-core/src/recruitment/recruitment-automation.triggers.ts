import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import { RECRUITMENT_MODULE_CODE } from './recruitment.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class RecruitmentAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'recruitment.applicant.hired',
      moduleCode: RECRUITMENT_MODULE_CODE,
      label: 'جذب نهایی متقاضی',
      description: 'وقتی یک متقاضی پس از تأیید مدیریت و امضای شرایط همکاری، به‌عنوان کارمند جذب می‌شود.',
      payloadFields: [
        { key: 'applicantName', label: 'نام متقاضی', type: 'STRING' },
        { key: 'jobTitle', label: 'عنوان شغلی', type: 'STRING' },
      ],
    });
  }
}
