import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { signLicense, type LicensePayload } from './license-token.js';
import type { License } from '../../generated/control-client/index.js';

/**
 * Issues on-premise licenses. Only the Control Plane (this cloud instance)
 * holds LICENSE_SIGNING_PRIVATE_KEY_PEM — an on-premise deployment only ever
 * verifies a license, never signs one.
 */
@Injectable()
export class LicenseIssuerService {
  constructor(private readonly controlDb: ControlPrismaService) {}

  async issue(
    input: { orgName: string; modules: string[]; seats?: number; validityDays: number; tenantId?: string },
    issuedByAdminId: string,
  ): Promise<License> {
    const privateKeyPem = process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM;
    if (!privateKeyPem) {
      throw new InternalServerErrorException(
        'کلید امضای لایسنس پیکربندی نشده است — ابتدا npm run license:keygen را اجرا کنید',
      );
    }

    // Created first (without signedKey) to get a stable id to embed in the
    // signed payload itself, then updated with the real signed key.
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setDate(expiresAt.getDate() + input.validityDays);

    const placeholder = await this.controlDb.license.create({
      data: {
        tenantId: input.tenantId,
        orgName: input.orgName,
        allowedModules: input.modules,
        seats: input.seats ?? 10,
        issuedAt,
        expiresAt,
        signedKey: '', // filled in immediately below
        issuedByAdminId,
      },
    });

    const payload: LicensePayload = {
      licenseId: placeholder.id,
      orgName: input.orgName,
      modules: input.modules,
      seats: input.seats ?? 10,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const signedKey = signLicense(payload, privateKeyPem.replace(/\\n/g, '\n'));

    return this.controlDb.license.update({ where: { id: placeholder.id }, data: { signedKey } });
  }

  list() {
    return this.controlDb.license.findMany({ orderBy: { issuedAt: 'desc' } });
  }

  async revoke(id: string, reason: string): Promise<License> {
    return this.controlDb.license.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
    });
  }
}
