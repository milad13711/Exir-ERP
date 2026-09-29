import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantAuthPayload, AdminJwtPayload, VaultTicketPayload } from '../auth/jwt-payload.type.js';

/** Attached to the request by JwtAuthGuard once a tenant-scoped token (or API key) is verified. */
export type TenantRequestContext = {
  auth: TenantAuthPayload;
  tenantId: string;
  tenantSlug: string;
  tenantDb: TenantPrismaClient;
};

/** Attached to the request by AdminJwtAuthGuard for internal staff endpoints. */
export type AdminRequestContext = {
  auth: AdminJwtPayload;
};

declare module 'express' {
  interface Request {
    ctx?: TenantRequestContext;
    adminCtx?: AdminRequestContext;
    /** Attached by VaultTicketGuard once a valid X-Vault-Ticket header is verified (confidential-archive module). */
    vaultTicket?: VaultTicketPayload;
  }
}
