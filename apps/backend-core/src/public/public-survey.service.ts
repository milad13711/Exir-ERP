import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/** Unauthenticated by design — the survey link's own token is sent only to the customer via SMS right after delivery; no OTP needed for a satisfaction survey. */
@Injectable()
export class PublicSurveyService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  private async resolveTenantDb(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    return this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
  }

  async view(slug: string, token: string) {
    const tenantDb = await this.resolveTenantDb(slug);
    const survey = await tenantDb.deliverySurvey.findUnique({
      where: { publicToken: token },
      include: { shipment: { include: { driver: { select: { name: true } } } } },
    });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    return survey;
  }

  async submit(slug: string, token: string, data: { driverRating?: number; productRating?: number; note?: string }) {
    const tenantDb = await this.resolveTenantDb(slug);
    const survey = await tenantDb.deliverySurvey.findUnique({ where: { publicToken: token } });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    if (survey.submittedAt) throw new BadRequestException('نظر شما قبلاً ثبت شده است');

    return tenantDb.deliverySurvey.update({
      where: { id: survey.id },
      data: {
        driverRating: data.driverRating,
        productRating: data.productRating,
        note: data.note,
        submittedAt: new Date(),
      },
    });
  }
}
