import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';

/** Unauthenticated by design — same rationale as PublicMentoringSurveyService: the link's own token is the credential, sent only to the referred customer via SMS. */
@Injectable()
export class PublicReferralSurveyService {
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
    const survey = await tenantDb.referralNpsSurvey.findUnique({
      where: { publicToken: token },
      include: { referralConversion: { include: { resellerProfile: { select: { contact: { select: { name: true } } } } } } },
    });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    return survey;
  }

  async submit(slug: string, token: string, data: { rating?: number; note?: string }) {
    const tenantDb = await this.resolveTenantDb(slug);
    const survey = await tenantDb.referralNpsSurvey.findUnique({ where: { publicToken: token } });
    if (!survey) throw new NotFoundException('این لینک معتبر نیست');
    if (survey.submittedAt) throw new BadRequestException('نظر شما قبلاً ثبت شده است');

    const conversion = await tenantDb.referralConversion.findUniqueOrThrow({ where: { id: survey.referralConversionId } });
    const updated = await tenantDb.referralNpsSurvey.update({
      where: { id: survey.id },
      data: { rating: data.rating, note: data.note, submittedAt: new Date() },
    });

    if (data.rating != null) {
      const ratedSurveys = await tenantDb.referralNpsSurvey.findMany({
        where: { rating: { not: null }, referralConversion: { resellerProfileId: conversion.resellerProfileId } },
        select: { rating: true },
      });
      const avg = ratedSurveys.reduce((sum, s) => sum + (s.rating ?? 0), 0) / ratedSurveys.length;
      await tenantDb.resellerProfile.update({ where: { id: conversion.resellerProfileId }, data: { npsAvgScore: avg } });
    }

    return updated;
  }
}
