import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { TrackingTicketPayload } from '../auth/jwt-payload.type.js';

const TRACKING_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Unauthenticated "پیگیری پروژه" page a tenant shares with its own
 * customers — enter phone, verify via OTP, see the live stage progress of
 * every project tied to a CRM contact with that phone number. No project
 * budget/value or internal task detail is ever returned here, only what a
 * customer should see: stage names and their status.
 */
@Injectable()
export class PublicTrackingService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenantDb(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const projectsModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'projects' } },
    });
    if (!projectsModule) throw new NotFoundException('پیگیری پروژه برای این کسب‌وکار فعال نیست');
    return this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
  }

  async requestOtp(slug: string, phone: string) {
    await this.resolveTenantDb(slug);
    return this.auth.requestOtp(phone, 'TRACKING');
  }

  async verifyOtp(slug: string, phone: string, code: string): Promise<{ trackingToken: string; expiresInSeconds: number }> {
    await this.resolveTenantDb(slug);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'TRACKING', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= 5) {
      throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const payload: TrackingTicketPayload = { type: 'tracking_ticket', phone, tenantSlug: slug };
    const trackingToken = await this.jwt.signAsync(payload, { expiresIn: TRACKING_TOKEN_TTL_SECONDS });
    return { trackingToken, expiresInSeconds: TRACKING_TOKEN_TTL_SECONDS };
  }

  private async resolveTrackingPhone(slug: string, trackingToken: string): Promise<string> {
    let payload: TrackingTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TrackingTicketPayload>(trackingToken);
    } catch {
      throw new UnauthorizedException('نشست پیگیری منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'tracking_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست پیگیری نامعتبر است');
    }
    return payload.phone;
  }

  async listProjects(slug: string, trackingToken: string) {
    const tenantDb = await this.resolveTenantDb(slug);
    const phone = await this.resolveTrackingPhone(slug, trackingToken);

    const contacts = await tenantDb.crmContact.findMany({ where: { phone }, select: { id: true } });
    if (contacts.length === 0) return [];

    const projects = await tenantDb.project.findMany({
      where: { contactId: { in: contacts.map((c) => c.id) } },
      select: {
        projectNo: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        stages: {
          orderBy: { order: 'asc' },
          select: { title: true, status: true, completedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects;
  }
}
