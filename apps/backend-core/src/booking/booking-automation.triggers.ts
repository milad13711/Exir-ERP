import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class BookingAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'booking.appointment.created',
      moduleCode: 'booking',
      label: 'ثبت نوبت جدید',
      description: 'وقتی یک نوبت جدید برای مشتری رزرو می‌شود — برای ارسال یادآوری یا اعلان به کارشناس مربوطه.',
      payloadFields: [
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'customerPhone', label: 'تلفن مشتری', type: 'PHONE' },
        { key: 'serviceName', label: 'نوع خدمت', type: 'STRING' },
        { key: 'startAt', label: 'زمان نوبت', type: 'STRING' },
        { key: 'providerUserId', label: 'کارشناس مربوطه', type: 'USER_ID' },
      ],
    });

    this.registry.register({
      code: 'booking.appointment.cancelled',
      moduleCode: 'booking',
      label: 'لغو نوبت',
      description: 'وقتی یک نوبت رزروشده لغو می‌شود.',
      payloadFields: [
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'customerPhone', label: 'تلفن مشتری', type: 'PHONE' },
        { key: 'serviceName', label: 'نوع خدمت', type: 'STRING' },
        { key: 'startAt', label: 'زمان نوبت', type: 'STRING' },
      ],
    });

    this.registry.register({
      code: 'booking.appointment.deposit_paid',
      moduleCode: 'booking',
      label: 'پرداخت بیعانه نوبت',
      description: 'وقتی بیعانه/پیش‌پرداخت یک نوبت با موفقیت پرداخت می‌شود.',
      payloadFields: [
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'serviceName', label: 'نوع خدمت', type: 'STRING' },
        { key: 'startAt', label: 'زمان نوبت', type: 'STRING' },
        { key: 'depositAmount', label: 'مبلغ بیعانه', type: 'NUMBER' },
      ],
    });
  }
}
