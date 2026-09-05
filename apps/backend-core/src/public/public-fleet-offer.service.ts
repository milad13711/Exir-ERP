import { Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ShipmentsService } from '../fleet/shipments.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * Unauthenticated by design — a driver reaches this straight from the SMS
 * offer, no OTP layer. The link's own unguessable token (ShipmentOffer.
 * publicToken) is the entire access control; this operational scenario
 * doesn't warrant the extra OTP round-trip the customer-facing public flows
 * (booking/tracking/contract-sign) use.
 */
@Injectable()
export class PublicFleetOfferService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly shipments: ShipmentsService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const fleetModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'fleet' } },
    });
    if (!fleetModule) throw new NotFoundException('این لینک دیگر معتبر نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async view(slug: string, token: string) {
    const ctx = await this.resolveCtx(slug);
    return this.shipments.viewOfferByToken(ctx, token);
  }

  async accept(slug: string, token: string) {
    const ctx = await this.resolveCtx(slug);
    return this.shipments.acceptOfferByToken(ctx, token);
  }
}
