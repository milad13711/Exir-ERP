import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AcceptPublicQuotationDto } from './dto/accept-public-quotation.dto.js';

/**
 * Unauthenticated customer-facing view of a sales quotation — reached via a
 * link shared outside the app (SMS/WhatsApp/email), not a tenant login.
 * Security is the `token` alone (an unguessable random UUID stored on the
 * row, see `SalesQuotation.publicToken`); the tenant slug in the URL just
 * makes the link legible and picks which tenant DB to query — it grants no
 * access by itself. Only a narrow, customer-safe subset of fields is ever
 * returned (no internal ids, no other customers' data, nothing beyond one
 * quotation).
 */
@Controller('public/tenants/:slug/quotations')
export class PublicQuotationsController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveTenantDb(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    return {
      tenant,
      tenantDb: this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName }),
    };
  }

  @Get(':token')
  async view(@Param('slug') slug: string, @Param('token') token: string) {
    const { tenant, tenantDb } = await this.resolveTenantDb(slug);
    const quotation = await tenantDb.salesQuotation.findFirst({
      where: { publicToken: token },
      include: {
        contact: { select: { name: true, company: true } },
        lines: { select: { description: true, quantity: true, unitPrice: true, lineTotal: true } },
      },
    });
    if (!quotation) throw new NotFoundException('پیش‌فاکتور یافت نشد');

    if (!quotation.firstViewedAt) {
      await tenantDb.salesQuotation.update({ where: { id: quotation.id }, data: { firstViewedAt: new Date() } });
      if (quotation.createdByUserId) {
        await this.notifications.notify(tenantDb, {
          userId: quotation.createdByUserId,
          type: 'sales.quotation.viewed',
          title: `مشتری پیش‌فاکتور #${quotation.quotationNo} را مشاهده کرد`,
          body: quotation.contact.company || quotation.contact.name,
          link: '/sales',
        });
      }
    }

    return {
      orgName: tenant.name,
      quotationNo: quotation.quotationNo,
      status: quotation.status,
      issuedAt: quotation.issuedAt,
      validUntil: quotation.validUntil,
      subtotal: quotation.subtotal,
      discount: quotation.discount,
      total: quotation.total,
      notes: quotation.notes,
      contact: quotation.contact,
      lines: quotation.lines,
      acceptedByName: quotation.acceptedByName,
    };
  }

  @Post(':token/accept')
  async accept(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: AcceptPublicQuotationDto) {
    const { tenantDb } = await this.resolveTenantDb(slug);
    const quotation = await tenantDb.salesQuotation.findFirst({ where: { publicToken: token } });
    if (!quotation) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (quotation.status !== 'SENT') {
      throw new ForbiddenException('این پیش‌فاکتور دیگر قابل پذیرش نیست');
    }
    if (dto.name.trim().length < 2) throw new BadRequestException('نام نامعتبر است');

    await tenantDb.salesQuotation.update({
      where: { id: quotation.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
        acceptedByName: dto.name.trim(),
        acceptedSignatureDataUrl: dto.signatureDataUrl,
      },
    });

    if (quotation.createdByUserId) {
      await this.notifications.notify(tenantDb, {
        userId: quotation.createdByUserId,
        type: 'sales.quotation.accepted',
        title: `پیش‌فاکتور #${quotation.quotationNo} توسط مشتری پذیرفته شد`,
        body: `پذیرفته‌شده توسط ${dto.name.trim()}`,
        link: '/sales',
      });
    }

    return { success: true };
  }
}
