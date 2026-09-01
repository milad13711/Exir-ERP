import type { TenantRole } from '../../generated/control-client/index.js';

/** Issued after OTP verification, scoped to one tenant. */
export type TenantJwtPayload = {
  type: 'tenant_user';
  sub: string; // GlobalUser.id
  tenantId: string;
  membershipId: string;
  role: TenantRole;
};

/** Issued after internal staff (management team) login — never scoped to a tenant. */
export type AdminJwtPayload = {
  sub: string; // AdminUser.id
  team: string;
  isAdmin: true;
};

/**
 * Synthesized (never actually a JWT) when a request authenticates with an
 * `exir_live_...` API key instead of a user session — REST API callers,
 * webhooks config, and MCP clients all go through this. Granted the same
 * 'OWNER' access an API key's issuer had by definition (creating a key
 * requires OWNER/ADMIN), so every existing tenant-scoped controller (guarded
 * by role, not by auth type) keeps working unmodified for API callers too.
 */
export type ApiKeyAuthPayload = {
  type: 'api_key';
  sub: string; // ApiKey.id
  tenantId: string;
  role: TenantRole;
};

export type TenantAuthPayload = TenantJwtPayload | ApiKeyAuthPayload;
