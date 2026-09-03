import { Injectable, OnModuleInit } from '@nestjs/common';
import { TriggerRegistryService } from '../automation/trigger-registry.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TriggerPayload } from '../automation/types.js';

/** Registers this module's triggers into the shared automation catalog at boot — see automation/trigger-registry.service.ts for the contract. */
@Injectable()
export class SalesAutomationTriggers implements OnModuleInit {
  constructor(
    private readonly registry: TriggerRegistryService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'sales.invoice.payment_recorded',
      moduleCode: 'sales',
      label: 'ثبت پرداخت روی فاکتور فروش',
      description: 'وقتی مشتری پرداختی (کامل یا جزئی) روی یک فاکتور ثبت می‌شود.',
      payloadFields: [
        { key: 'invoiceNo', label: 'شماره فاکتور', type: 'NUMBER' },
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'customerPhone', label: 'تلفن مشتری', type: 'PHONE' },
        { key: 'amount', label: 'مبلغ این پرداخت', type: 'NUMBER' },
        { key: 'remaining', label: 'باقی‌مانده‌ی فاکتور', type: 'NUMBER' },
      ],
    });

    this.registry.register({
      code: 'sales.quotation.created',
      moduleCode: 'sales',
      label: 'صدور پیش‌فاکتور',
      description: 'وقتی یک پیش‌فاکتور جدید برای مشتری ثبت می‌شود — برای ارسال لینک تأیید به مشتری.',
      payloadFields: [
        { key: 'quotationNo', label: 'شماره پیش‌فاکتور', type: 'NUMBER' },
        { key: 'customerName', label: 'نام مشتری', type: 'STRING' },
        { key: 'customerPhone', label: 'تلفن مشتری', type: 'PHONE' },
        { key: 'total', label: 'مبلغ کل', type: 'NUMBER' },
        { key: 'publicLink', label: 'لینک عمومی پیش‌فاکتور', type: 'STRING' },
      ],
      resolvePayload: async (ctx, entityId) => {
        const quotation = await ctx.tenantDb.salesQuotation.findUniqueOrThrow({
          where: { id: entityId },
          include: { contact: { select: { name: true, phone: true } } },
        });
        const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { slug: true } });
        return quotationCreatedPayload(quotation, tenant.slug);
      },
    });
  }
}

export function quotationCreatedPayload(
  quotation: { quotationNo: number; total: number; publicToken: string; contact: { name: string; phone: string | null } },
  tenantSlug: string,
): TriggerPayload {
  const base = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
  return {
    quotationNo: quotation.quotationNo,
    customerName: quotation.contact.name,
    customerPhone: quotation.contact.phone,
    total: quotation.total,
    publicLink: `${base}/q/${tenantSlug}/${quotation.publicToken}`,
  };
}
