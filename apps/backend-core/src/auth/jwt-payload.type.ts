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

/**
 * Short-lived proof that a phone number was OTP-verified for the public
 * self-signup wizard — issued by PublicSignupController after OTP verify,
 * consumed by the tenant-creation step so it never has to trust a raw
 * phone number the client just typed in.
 */
export type SignupTicketPayload = {
  type: 'signup_ticket';
  phone: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for a public
 * booking wizard — issued after OTP verify, consumed by the create-
 * appointment step, scoped to one tenant so it can't be replayed against
 * a different tenant's booking endpoint.
 */
export type BookingTicketPayload = {
  type: 'booking_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for public event
 * ticket purchase — issued after OTP verify, consumed by the booking-create
 * step, scoped to one tenant. Real money moves through this flow (ticket
 * payment), so it's kept OTP-gated like booking rather than the OTP-free
 * online-store order flow.
 */
export type EventBookingTicketPayload = {
  type: 'event_booking_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for a public
 * single-product (book) purchase — same rationale as EventBookingTicketPayload,
 * real money moves through this flow.
 */
export type BookOrderTicketPayload = {
  type: 'book_order_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for the public
 * online-store checkout's online-payment path — same rationale as
 * BookOrderTicketPayload (real money moves through this flow), ported from
 * book-store into online-store so it applies to any multi-product order,
 * not just a single flagship product. The cash/pay-later checkout
 * (PublicStoreService.placeOrder) is unaffected and still doesn't require this.
 */
export type StoreOrderTicketPayload = {
  type: 'store_order_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for the public
 * "track my project" page — issued after OTP verify, consumed by the
 * project-listing endpoint, scoped to one tenant.
 */
export type TrackingTicketPayload = {
  type: 'tracking_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified against the
 * RationLabReviewer whitelist for one tenant — issued after OTP verify,
 * consumed by the sample-search/report-submit endpoints of the public
 * "آزمایشگاه جیره" lab portal. Longer TTL than tracking (60 min, not 15)
 * since filling out a lab report takes real time.
 */
export type LabReviewTicketPayload = {
  type: 'lab_review_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for the public
 * "نتیجه‌ی آزمایش جیره" farmer-facing result page — same shape/rationale
 * as TrackingTicketPayload, just a distinct OTP purpose/ticket type so the
 * two public portals never accept each other's codes.
 */
export type RationResultTicketPayload = {
  type: 'ration_result_ticket';
  phone: string;
  tenantSlug: string;
};

/**
 * Short-lived proof that a phone number was OTP-verified for the public
 * contract e-signature page — issued after OTP verify, scoped to one
 * contract's publicToken so it can't be replayed against a different
 * contract, and carries which side of the contract that phone resolved to
 * (matched against the contract's party phone numbers at verify time).
 */
/**
 * Short-lived proof that a phone number was OTP-verified for login, issued
 * when that phone belongs to MORE THAN ONE active tenant and the client
 * omitted a tenantSlug — the login page shows a workspace picker built
 * from the accompanying tenant list, then exchanges this ticket + the
 * chosen slug for a real tenant-scoped access token (AuthController's
 * "select-tenant" route) without re-sending the OTP code, which was
 * already consumed the moment this ticket was issued.
 */
export type TenantSelectionTicketPayload = {
  type: 'tenant_selection_ticket';
  phone: string;
};

export type ContractSignTicketPayload = {
  type: 'contract_sign_ticket';
  phone: string;
  tenantSlug: string;
  contractId: string;
  side: 'PARTY_A' | 'PARTY_B' | 'WITNESS';
  /** فقط وقتی side==='WITNESS' — کدام رکورد ContractWitness. */
  witnessId?: string;
};

/**
 * Short-lived "vault ticket" — issued after an ALREADY-AUTHENTICATED staff
 * member (a normal tenant_user/api_key session already exists) re-verifies
 * their own on-file phone with a step-up OTP to enter the confidential
 * document archive. Unlike the other tickets above, this never carries a
 * phone — it's not proof of who the phone belongs to, it's proof that the
 * currently logged-in user (identified by `sub`, the same GlobalUser.id as
 * their normal session) just passed the step-up check. Sent back on every
 * subsequent archive list/detail/edit/delete call via the X-Vault-Ticket
 * header (see VaultTicketGuard) and re-checked against the caller's own
 * session (`sub`/`tenantId` must match) so it can't be replayed by a
 * different user or a different tenant. `canEdit` is resolved once, at
 * issuance time, from the caller's ConfidentialArchiveAccess grant (or
 * `true` outright for OWNER/ADMIN) — not re-read on every request, exactly
 * like BookOrderTicketPayload snapshots its own authorization at issuance.
 */
export type VaultTicketPayload = {
  type: 'vault_ticket';
  sub: string; // GlobalUser.id — must match the caller's normal session ctx.auth.sub
  tenantId: string;
  canEdit: boolean;
};
