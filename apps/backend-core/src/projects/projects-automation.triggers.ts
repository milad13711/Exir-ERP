import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class ProjectsAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'projects.project.completed',
      moduleCode: 'projects',
      label: 'اتمام پروژه',
      description: 'وقتی یک پروژه به وضعیت تکمیل‌شده تغییر می‌کند.',
      payloadFields: [
        { key: 'projectNo', label: 'شماره پروژه', type: 'NUMBER' },
        { key: 'name', label: 'نام پروژه', type: 'STRING' },
        { key: 'managerUserId', label: 'مدیر پروژه', type: 'USER_ID' },
      ],
    });

    this.registry.register({
      code: 'projects.project.overdue',
      moduleCode: 'projects',
      label: 'عقب‌افتادن پروژه از موعد',
      description: 'وقتی تاریخ پایان پروژه‌ی هنوز فعال سپری می‌شود.',
      payloadFields: [
        { key: 'projectNo', label: 'شماره پروژه', type: 'NUMBER' },
        { key: 'name', label: 'نام پروژه', type: 'STRING' },
        { key: 'endDate', label: 'تاریخ پایان برنامه‌ریزی‌شده', type: 'STRING' },
        { key: 'managerUserId', label: 'مدیر پروژه', type: 'USER_ID' },
      ],
    });
  }
}
