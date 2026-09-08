import { Controller, ForbiddenException, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly invoicePdf: InvoicePdfService,
  ) {}

  @Get('subscription')
  async currentSubscription(@Ctx() ctx: TenantRequestContext) {
    const subscription = await this.controlDb.subscription.findFirst({
      where: { tenantId: ctx.tenantId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { startedAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) return null;

    const msLeft = Math.max(0, subscription.currentPeriodEnd.getTime() - Date.now());
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    const hoursLeft = Math.ceil(msLeft / 3_600_000);
    return {
      planName: subscription.plan.name,
      planCode: subscription.plan.code,
      status: subscription.status,
      daysLeft,
      hoursLeft,
      currentPeriodEnd: subscription.currentPeriodEnd,
      autoRenew: subscription.autoRenew,
    };
  }

  @Get('invoices')
  invoices(@Ctx() ctx: TenantRequestContext) {
    return this.controlDb.invoice.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  @Get('invoices/:id/pdf')
  async invoicePdfDownload(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const invoice = await this.controlDb.invoice.findUnique({
      where: { id },
      include: { tenant: true, subscription: { include: { plan: true } } },
    });
    if (!invoice) throw new NotFoundException('فاکتور یافت نشد');
    if (invoice.tenantId !== ctx.tenantId) throw new ForbiddenException();

    const pdf = await this.invoicePdf.renderInvoicePdf(invoice, invoice.tenant, invoice.subscription?.plan ?? null);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  }
}
