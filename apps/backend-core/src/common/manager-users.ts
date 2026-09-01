import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';

export type ManagerContact = { tenantUserId: string; name: string; phone: string; email: string | null };

/**
 * Resolves "the manager(s)" for urgent/cross-cutting alerts (bounced check,
 * overdue receivable) to the tenant owner/admin — the same control-plane
 * authority already used to gate official-invoice signing and PO approval —
 * rather than a tenant-local Role name, which an admin could rename or
 * reassign. Returns tenant-scoped User rows (for in-app/email notification)
 * paired with the phone number from the control plane (for SMS).
 */
export async function getManagerUsers(
  controlDb: ControlPrismaService,
  tenantDb: TenantPrismaClient,
  tenantId: string,
): Promise<ManagerContact[]> {
  const memberships = await controlDb.tenantMembership.findMany({
    where: { tenantId, role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
    include: { globalUser: true },
  });
  if (memberships.length === 0) return [];

  const tenantUsers = await tenantDb.user.findMany({
    where: { globalUserId: { in: memberships.map((m) => m.globalUserId) } },
  });

  const byGlobalId = new Map(memberships.map((m) => [m.globalUserId, m.globalUser]));
  return tenantUsers.map((u) => ({
    tenantUserId: u.id,
    name: u.name,
    phone: byGlobalId.get(u.globalUserId)?.phone ?? u.phone,
    email: u.email,
  }));
}
