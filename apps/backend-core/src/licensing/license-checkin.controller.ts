import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsString, MinLength } from 'class-validator';
import { clientIp } from '../security/client-ip.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

class CheckInDto {
  @IsString()
  @MinLength(10)
  licenseKey!: string;
}

/**
 * Optional online check-in for on-premise deployments that DO have outbound
 * connectivity: catches a revocation before the offline token's own expiry
 * would. An on-premise instance calls this periodically (e.g. daily) on a
 * best-effort basis and falls back to pure offline signature+expiry
 * verification when it can't reach us — see docs/ON_PREMISE.md.
 *
 * No auth: an on-premise deployment has no Control Plane credentials, only
 * the opaque signed key itself, which functions as the bearer credential here.
 *
 * Every check-in — valid or not — updates lastCheckInAt/lastCheckInIp, so
 * admin-panel's licenses page can show "این سرور آخرین بار چه زمانی وصل شده"
 * (a best-effort liveness signal, not a guarantee — see LicenseRuntimeService's
 * own comment about staying offline-first).
 */
@Controller('licenses')
export class LicenseCheckinController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Post('check-in')
  async checkIn(@Body() dto: CheckInDto, @Req() req: Request) {
    const license = await this.controlDb.license.findUnique({ where: { signedKey: dto.licenseKey } });
    if (!license) return { valid: false, reason: 'لایسنس یافت نشد' };

    await this.controlDb.license.update({
      where: { id: license.id },
      data: { lastCheckInAt: new Date(), lastCheckInIp: clientIp(req) },
    });

    if (license.status === 'REVOKED') {
      return { valid: false, reason: license.revokedReason ?? 'لایسنس ابطال شده است' };
    }
    if (license.expiresAt < new Date()) {
      return { valid: false, reason: 'لایسنس منقضی شده است' };
    }
    return { valid: true };
  }
}
