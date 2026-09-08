import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/** Unauthenticated by design — same rationale as PublicSurveyService (fleet delivery survey): the link's own token is the credential, sent only to the client via SMS right after the session. */
@Injectable()
export class PublicMentoringSurveyService {
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
    const survey = await tenantDb.mentoringSessionSurvey.findUnique({
      where: { publicToken: token },
      include: { session: { include: { engagement: { select: { title: true, advisor: { select: { name: true } } } } } } },
    });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    return survey;
  }

  async submit(slug: string, token: string, data: { rating?: number; note?: string }) {
    const tenantDb = await this.resolveTenantDb(slug);
    const survey = await tenantDb.mentoringSessionSurvey.findUnique({ where: { publicToken: token } });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    if (survey.submittedAt) throw new BadRequestException('نظر شما قبلاً ثبت شده است');

    return tenantDb.mentoringSessionSurvey.update({
      where: { id: survey.id },
      data: { rating: data.rating, note: data.note, submittedAt: new Date() },
    });
  }
}
