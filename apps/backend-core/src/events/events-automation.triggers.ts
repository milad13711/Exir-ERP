import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class EventsAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'events.ticket.issued',
      moduleCode: 'events',
      label: 'صدور بلیط رویداد',
      description: 'وقتی یک بلیط رویداد (بعد از پرداخت موفق یا برای رویداد رایگان) صادر می‌شود.',
      payloadFields: [
        { key: 'eventTitle', label: 'عنوان رویداد', type: 'STRING' },
        { key: 'attendeeName', label: 'نام شرکت‌کننده', type: 'STRING' },
        { key: 'ticketCode', label: 'کد بلیط', type: 'STRING' },
      ],
    });
  }
}
