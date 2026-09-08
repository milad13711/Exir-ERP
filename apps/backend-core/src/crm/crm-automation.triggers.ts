import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';

@Injectable()
export class CrmAutomationTriggers implements OnModuleInit {
  constructor(private readonly registry: TriggerRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'crm.contact.converted_to_customer',
      moduleCode: 'crm',
      label: 'تبدیل خودکار سرنخ به مشتری',
      description: 'وقتی یک سرنخ اولین خرید خود را ثبت می‌کند و به‌صورت خودکار مشتری می‌شود.',
      payloadFields: [
        { key: 'contactId', label: 'شناسه مخاطب', type: 'STRING' },
        { key: 'contactName', label: 'نام مخاطب', type: 'STRING' },
        { key: 'contactPhone', label: 'شماره موبایل مخاطب', type: 'PHONE' },
      ],
    });

    this.registry.register({
      code: 'crm.contact.became_ambassador',
      moduleCode: 'crm',
      label: 'مخاطب سفیر برند شد',
      description: 'وقتی مخاطبی برای اولین بار به‌عنوان معرف یک سرنخ/مشتری جدید ثبت می‌شود.',
      payloadFields: [
        { key: 'contactId', label: 'شناسه مخاطب', type: 'STRING' },
        { key: 'contactName', label: 'نام مخاطب', type: 'STRING' },
        { key: 'contactPhone', label: 'شماره موبایل مخاطب', type: 'PHONE' },
      ],
    });

    this.registry.register({
      code: 'crm.contact.churn_risk',
      moduleCode: 'crm',
      label: 'هشدار ریسک غیرفعال‌شدن مشتری',
      description: 'وقتی مشتری از موعد پیش‌بینی‌شده‌ی خرید بعدی‌اش گذشته و هنوز خرید نکرده — فرصت مناسب برای یادآوری/تخفیف.',
      payloadFields: [
        { key: 'contactId', label: 'شناسه مخاطب', type: 'STRING' },
        { key: 'contactName', label: 'نام مخاطب', type: 'STRING' },
        { key: 'contactPhone', label: 'شماره موبایل مخاطب', type: 'PHONE' },
      ],
    });

    this.registry.register({
      code: 'crm.contact.churned',
      moduleCode: 'crm',
      label: 'مشتری غیرفعال شد',
      description: 'وقتی مدت زیادی از موعد پیش‌بینی‌شده‌ی خرید بعدی مشتری گذشته و همچنان خریدی ثبت نشده است.',
      payloadFields: [
        { key: 'contactId', label: 'شناسه مخاطب', type: 'STRING' },
        { key: 'contactName', label: 'نام مخاطب', type: 'STRING' },
        { key: 'contactPhone', label: 'شماره موبایل مخاطب', type: 'PHONE' },
      ],
    });
  }
}
