import { Body, Controller, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
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
 */
@Controller('licenses')
export class LicenseCheckinController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Post('check-in')
  async checkIn(@Body() dto: CheckInDto) {
    const license = await this.controlDb.license.findUnique({ where: { signedKey: dto.licenseKey } });
    if (!license) return { valid: false, reason: 'لایسنس یافت نشد' };
    if (license.status === 'REVOKED') {
      return { valid: false, reason: license.revokedReason ?? 'لایسنس ابطال شده است' };
    }
    if (license.expiresAt < new Date()) {
      return { valid: false, reason: 'لایسنس منقضی شده است' };
    }
    return { valid: true };
  }
}
