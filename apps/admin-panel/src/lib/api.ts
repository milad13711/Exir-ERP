const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const TOKEN_KEY = "exir_admin_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = "خطایی رخ داد، دوباره تلاش کنید";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      // no JSON body — keep the default message
    }
    if (res.status === 401 && typeof window !== "undefined") clearToken();
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export type AdminLoginSuccess = { accessToken: string; admin: { id: string; name: string; team: string } };
export type AdminLoginResult = AdminLoginSuccess | { requiresTotp: true; challengeToken: string };

export function adminLogin(email: string, password: string) {
  return apiFetch<AdminLoginResult>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** گام دوم ورود وقتی 2FA فعال است: کد ۶ رقمی برنامه‌ی احراز هویت یا یک کد بازیابی. */
export function adminLoginTotp(challengeToken: string, code: string) {
  return apiFetch<AdminLoginSuccess>("/admin/auth/login/totp", {
    method: "POST",
    body: JSON.stringify({ challengeToken, code }),
  });
}

// ── 2FA و امنیت ───────────────────────────────────────────────────────────

export const fetchTwoFaStatus = () => apiFetch<{ enabled: boolean; recoveryCodesLeft: number; required: boolean }>("/admin/auth/2fa/status");
export const beginTwoFaSetup = () => apiFetch<{ secret: string; otpauthUrl: string }>("/admin/auth/2fa/setup", { method: "POST" });
export const enableTwoFa = (code: string) => apiFetch<{ recoveryCodes: string[] }>("/admin/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
export const disableTwoFa = (password: string, code: string) => apiFetch<{ enabled: boolean }>("/admin/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code }) });

export type SecurityEventRow = { id: string; level: "INFO" | "WARNING" | "ERROR" | "FATAL"; message: string; createdAt: string; tenantId: string | null; context: Record<string, unknown> | null };
export const fetchSecurityEvents = (limit = 100) => apiFetch<SecurityEventRow[]>(`/admin/security/events?limit=${limit}`);
export const invalidateAllSessions = () => apiFetch<{ sessionEpoch: number }>("/admin/security/sessions/invalidate-all", { method: "POST" });
export const invalidateTenantSessions = (tenantId: string) => apiFetch<{ tokenVersion: number }>(`/admin/security/tenants/${encodeURIComponent(tenantId)}/sessions/invalidate`, { method: "POST" });
export const revokeTenantApiKeys = (tenantId: string) => apiFetch<{ revoked: number }>(`/admin/security/tenants/${encodeURIComponent(tenantId)}/api-keys/revoke-all`, { method: "POST" });

// ── Tenants ──────────────────────────────────────────────────────────────

export type AdminTenant = {
  id: string;
  slug: string;
  name: string;
  status: "PENDING_PROVISION" | "PENDING_PAYMENT" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  deploymentType: "SHARED_CLOUD" | "DEDICATED_ON_PREMISE";
  dbName: string;
  dbHost: string;
  createdAt: string;
  provisionedAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  subscriptions: Array<{
    plan: { name: string; code: string; priceMonthly: number };
    status: string;
    currentPeriodEnd: string;
  }>;
  _count: { memberships: number; supportTickets: number };
};

export function fetchTenants() {
  return apiFetch<AdminTenant[]>("/admin/tenants");
}

export function fetchTenant(id: string) {
  return apiFetch<AdminTenant>(`/admin/tenants/${id}`);
}

export function createTenant(data: {
  name: string;
  slug: string;
  ownerPhone: string;
  ownerName: string;
  planCode: string;
  industryTemplateCode?: string;
}) {
  return apiFetch<AdminTenant>("/admin/tenants", { method: "POST", body: JSON.stringify(data) });
}

export type IndustryTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
};

export type IndustryTemplateDetail = IndustryTemplate & {
  roles: Array<{ name: string; permissionCodes: string[]; modulePermissions: Record<string, unknown> }>;
  chartOfAccounts: Array<{ code: string; name: string; type: string; isCashAccount?: boolean }>;
  productCategories: string[];
  orgChart: Array<{ position: string; reportsTo: string | null; department: string }>;
  suggestedThemeColor: string | null;
  defaultModules: string[];
  createdAt: string;
};

export function fetchIndustryTemplates() {
  return apiFetch<IndustryTemplate[]>("/admin/catalog/industry-templates");
}

export function fetchIndustryTemplate(code: string) {
  return apiFetch<IndustryTemplateDetail>(`/admin/catalog/industry-templates/${code}`);
}

export function upsertIndustryTemplate(data: {
  code: string;
  name: string;
  description?: string;
  roles: unknown[];
  chartOfAccounts: unknown[];
  productCategories: string[];
  orgChart: unknown[];
  suggestedThemeColor?: string;
  defaultModules?: string[];
}) {
  return apiFetch<IndustryTemplateDetail>("/admin/catalog/industry-templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function saveIndustryTemplateFromTenant(
  tenantId: string,
  data: { code: string; name: string; description?: string },
) {
  return apiFetch<IndustryTemplateDetail>(`/admin/catalog/industry-templates/from-tenant/${tenantId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function suspendTenant(id: string, reason: string) {
  return apiFetch<AdminTenant>(`/admin/tenants/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reactivateTenant(id: string) {
  return apiFetch<AdminTenant>(`/admin/tenants/${id}/reactivate`, { method: "POST" });
}

export function renewTenant(id: string, months: number) {
  return apiFetch<{ subscription: unknown; invoice: unknown }>(`/admin/tenants/${id}/renew`, {
    method: "POST",
    body: JSON.stringify({ months }),
  });
}

export function deleteTenant(id: string, confirmSlug: string) {
  return apiFetch<{ success: boolean }>(`/admin/tenants/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmSlug }),
  });
}

export type TenantStats = {
  userCount: number;
  openTaskCount: number;
  lastActivityAt: string | null;
  recentErrorCount: number;
};

export function fetchTenantStats(id: string) {
  return apiFetch<TenantStats>(`/admin/tenants/${id}/stats`);
}

export type TenantModuleEntry = {
  id: string;
  code: string;
  name: string;
  category: string;
  isCore: boolean;
  tenantModules: Array<{ status: "INSTALLED" | "DISABLED" | "TRIAL" }>;
};

export function fetchTenantModules(id: string) {
  return apiFetch<TenantModuleEntry[]>(`/admin/tenants/${id}/modules`);
}

export function setTenantModule(id: string, code: string, status: "INSTALLED" | "DISABLED") {
  return apiFetch<unknown>(`/admin/tenants/${id}/modules/${code}`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export type TenantInvoice = {
  id: string;
  items?: Array<{ moduleName: string; amount: number }> | null;
  purpose?: string | null;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
};

export function fetchTenantInvoices(id: string) {
  return apiFetch<TenantInvoice[]>(`/admin/tenants/${id}/invoices`);
}

export function updateTenantInvoice(tenantId: string, invoiceId: string, data: { amount?: number; dueAt?: string; status?: "PENDING" | "FAILED"; lines?: Array<{ name: string; amount: number }> }) {
  return apiFetch<TenantInvoice>(`/admin/tenants/${tenantId}/invoices/${invoiceId}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteTenantInvoice(tenantId: string, invoiceId: string) {
  return apiFetch<{ success: boolean }>(`/admin/tenants/${tenantId}/invoices/${invoiceId}`, { method: "DELETE" });
}

export function markInvoiceUnpaid(tenantId: string, invoiceId: string) {
  return apiFetch<TenantInvoice>(`/admin/tenants/${tenantId}/invoices/${invoiceId}/mark-unpaid`, { method: "POST" });
}

export function createTenantInvoice(id: string, data: { amount: number; dueAt: string; lines?: Array<{ name: string; amount: number }> }) {
  return apiFetch<TenantInvoice>(`/admin/tenants/${id}/invoices`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function markInvoicePaid(tenantId: string, invoiceId: string) {
  return apiFetch<TenantInvoice>(`/admin/tenants/${tenantId}/invoices/${invoiceId}/mark-paid`, {
    method: "POST",
  });
}

/**
 * Opens an invoice PDF — fetched with the auth header, since a plain link
 * can't carry it. Opened via a same-document anchor click rather than
 * window.open() into a separate tab: on iOS/Android mobile browsers, a
 * blob: URL assigned to a pre-opened popup tab frequently fails to render
 * (WebKit doesn't reliably hand the blob across the window boundary), while
 * an in-page anchor click opens it reliably everywhere.
 */
export async function openInvoicePdf(tenantId: string, invoiceId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/admin/tenants/${tenantId}/invoices/${invoiceId}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("دریافت فایل PDF ناموفق بود", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Catalog: modules & plans ────────────────────────────────────────────

export type CatalogModule = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  licenseUsd?: number;
  priceYearly: number | null;
  isCore: boolean;
  features: string[];
  version: string;
  dependsOn: string[];
  demoDescription: string | null;
  demoValueProps: string[];
  demoScreenshot1Url: string | null;
  demoScreenshot2Url: string | null;
};

export function fetchCatalogModules() {
  return apiFetch<CatalogModule[]>("/admin/catalog/modules");
}

export function syncCatalogPrices() {
  return apiFetch<{ updated: number; usdToToman: number }>("/admin/catalog/modules/sync-prices", { method: "POST" });
}

export function upsertCatalogModule(data: {
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly?: number;
  licenseUsd?: number;
  priceYearly?: number;
  isCore?: boolean;
  features?: string[];
  version?: string;
  dependsOn?: string[];
  demoDescription?: string;
  demoValueProps?: string[];
  demoScreenshot1Url?: string;
  demoScreenshot2Url?: string;
}) {
  return apiFetch<CatalogModule>("/admin/catalog/modules", { method: "POST", body: JSON.stringify(data) });
}

export type CatalogPlan = {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number | null;
  userLimit: number;
  isPubliclySold: boolean;
};

export function fetchCatalogPlans() {
  return apiFetch<CatalogPlan[]>("/admin/catalog/plans");
}

export function upsertCatalogPlan(data: {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly?: number;
  userLimit: number;
  isPubliclySold?: boolean;
}) {
  return apiFetch<CatalogPlan>("/admin/catalog/plans", { method: "POST", body: JSON.stringify(data) });
}

// ── Support tickets (live chat with tenants) ────────────────────────────

export type SupportTicket = {
  id: string;
  tenantId: string;
  subject: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "URGENT";
  createdAt: string;
  tenant: { name: string; slug: string };
  assignedAdmin: { name: string } | null;
};

export type SupportMessage = {
  id: string;
  senderType: "TENANT_USER" | "ADMIN" | "SYSTEM";
  body: string;
  createdAt: string;
};

export function fetchAdminTickets(status?: string) {
  return apiFetch<SupportTicket[]>(`/admin/support/tickets${status ? `?status=${status}` : ""}`);
}

export function fetchAdminTicket(id: string) {
  return apiFetch<SupportTicket & { messages: SupportMessage[] }>(`/admin/support/tickets/${id}`);
}

export function assignTicketToMe(id: string, adminUserId: string) {
  return apiFetch<SupportTicket>(`/admin/support/tickets/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ adminUserId }),
  });
}

export function replyToTicket(id: string, body: string) {
  return apiFetch<SupportMessage>(`/admin/support/tickets/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function resolveTicket(id: string, resolutionNote: string) {
  return apiFetch<SupportTicket>(`/admin/support/tickets/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolutionNote }),
  });
}

// ── Internal ops: staff, tasks, sales pipeline ─────────────────────────

export type StaffMember = { id: string; name: string; team: string };

export function fetchStaff() {
  return apiFetch<StaffMember[]>("/admin/staff");
}

export type InternalTask = {
  id: string;
  title: string;
  description: string | null;
  status: "OPEN" | "DONE";
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  assignedTo: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  ticket?: { id: string; subject: string } | null;
};

export function fetchInternalTasks() {
  return apiFetch<InternalTask[]>("/admin/internal/tasks");
}

export function createInternalTask(data: {
  title: string;
  description?: string;
  dueAt?: string;
  assignedToId?: string;
  ticketId?: string;
}) {
  return apiFetch<InternalTask>("/admin/internal/tasks", { method: "POST", body: JSON.stringify(data) });
}

export function toggleInternalTask(id: string) {
  return apiFetch<InternalTask>(`/admin/internal/tasks/${id}/toggle`, { method: "POST" });
}

export type LeadStage = "NEW" | "CONTACTED" | "PROPOSAL" | "WON" | "LOST";

export type InternalLead = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  stage: LeadStage;
  value: number | null;
  notes: string | null;
  requestedPlanCode: string | null;
  requestedIndustryTemplateCode: string | null;
  createdAt: string;
  owner: { id: string; name: string } | null;
};

export function fetchInternalLeads() {
  return apiFetch<InternalLead[]>("/admin/internal/leads");
}

export function createInternalLead(data: {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  value?: number;
  notes?: string;
}) {
  return apiFetch<InternalLead>("/admin/internal/leads", { method: "POST", body: JSON.stringify(data) });
}

export function updateLeadStage(id: string, stage: LeadStage) {
  return apiFetch<InternalLead>(`/admin/internal/leads/${id}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}

export function assignLead(id: string, ownerAdminId: string) {
  return apiFetch<InternalLead>(`/admin/internal/leads/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ ownerAdminId }),
  });
}

// ── درخواست‌های همکاری در فروش (نمایندگی) — از فرم عمومی eta.co.ir ──────

export type ResellerApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ResellerApplication = {
  id: string;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  websiteUrl: string | null;
  productCode: string | null;
  message: string | null;
  status: ResellerApplicationStatus;
  reviewedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
};

export function fetchResellerApplications(status?: ResellerApplicationStatus) {
  return apiFetch<ResellerApplication[]>(`/admin/reseller-applications${status ? `?status=${status}` : ""}`);
}

export type ResellerApplicationApproval = ResellerApplication & { accessGranted?: boolean; accessError?: string | null; pinnedOnMap?: boolean };

export function approveResellerApplication(id: string) {
  return apiFetch<ResellerApplicationApproval>(`/admin/reseller-applications/${id}/approve`, { method: "POST" });
}

export function fetchResellerApplication(id: string) {
  return apiFetch<ResellerApplication & { reviewedBy?: { name: string } | null }>(`/admin/reseller-applications/${id}`);
}

export function updateResellerApplication(
  id: string,
  data: Partial<{ name: string; company: string; phone: string; email: string; city: string; websiteUrl: string; productCode: string; message: string }>,
) {
  return apiFetch<ResellerApplication>(`/admin/reseller-applications/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteResellerApplication(id: string) {
  return apiFetch<{ success: boolean }>(`/admin/reseller-applications/${id}`, { method: "DELETE" });
}

export function rejectResellerApplication(id: string, rejectionNote?: string) {
  return apiFetch<ResellerApplication>(`/admin/reseller-applications/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejectionNote }),
  });
}

// ── Web Push (اعلان روی گوشی برای پیام‌های جدید پشتیبانی) ────────────────

export function fetchPushVapidKey() {
  return apiFetch<{ publicKey: string | null; configured: boolean }>("/admin/push/vapid-public-key");
}

export function subscribePush(data: { endpoint: string; p256dh: string; auth: string }) {
  return apiFetch<{ success: boolean }>("/admin/push/subscribe", { method: "POST", body: JSON.stringify(data) });
}

export function unsubscribePush(endpoint: string) {
  return apiFetch<{ success: boolean }>(`/admin/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
  });
}

// ── لایسنس‌های استقرار اختصاصی (on-premise) ──────────────────────────────

export type AdminLicense = {
  id: string;
  tenantId: string | null;
  orgName: string;
  signedKey: string;
  allowedModules: string[];
  seats: number;
  status: "ACTIVE" | "REVOKED";
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastCheckInAt: string | null;
  lastCheckInIp: string | null;
  tenant: { id: string; name: string; slug: string } | null;
};

export function fetchLicenses() {
  return apiFetch<AdminLicense[]>("/admin/licenses");
}

export function issueLicense(data: { orgName: string; modules: string[]; seats?: number; validityDays: number; tenantId?: string }) {
  return apiFetch<AdminLicense>("/admin/licenses", { method: "POST", body: JSON.stringify(data) });
}

export function revokeLicense(id: string, reason: string) {
  return apiFetch<AdminLicense>(`/admin/licenses/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
}

// ── لاگ‌های audit و خطا ───────────────────────────────────────────────────

export type AuditLogEntry = {
  id: string;
  actorType: string;
  actorId: string | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
};

export type ErrorLogEntry = {
  id: string;
  tenantId: string | null;
  service: string;
  level: "INFO" | "WARNING" | "ERROR" | "FATAL";
  message: string;
  stackTrace: string | null;
  context: unknown;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
};

export type SmsLogEntry = {
  id: string;
  tenantId: string | null;
  source: "PLATFORM" | "TENANT_OWN" | "TENANT_SYSTEM" | "TENANT_LEGACY";
  phone: string;
  message: string;
  success: boolean;
  error: string | null;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
};

export function fetchSmsLogs(tenantId?: string, status?: "success" | "failed") {
  const qs = new URLSearchParams();
  if (tenantId) qs.set("tenantId", tenantId);
  if (status) qs.set("status", status);
  const q = qs.toString();
  return apiFetch<SmsLogEntry[]>(`/admin/logs/sms${q ? `?${q}` : ""}`);
}

export function fetchAuditLogs(tenantId?: string) {
  return apiFetch<AuditLogEntry[]>(`/admin/logs/audit${tenantId ? `?tenantId=${tenantId}` : ""}`);
}

export function fetchErrorLogs(tenantId?: string) {
  return apiFetch<ErrorLogEntry[]>(`/admin/logs/errors${tenantId ? `?tenantId=${tenantId}` : ""}`);
}

// ── بسته‌های پیامکی پنل سیستمی ─────────────────────────────────────────────

export type SmsPackage = { id: string; code: string; credits: number; priceToman: number; isActive: boolean; sortOrder: number };

export function fetchSmsPackages() {
  return apiFetch<SmsPackage[]>("/admin/sms-packages");
}

export function updateSmsPackage(code: string, data: { priceToman?: number; isActive?: boolean; credits?: number }) {
  return apiFetch<SmsPackage>(`/admin/sms-packages/${code}`, { method: "PUT", body: JSON.stringify(data) });
}

// ── مشاهده/ویرایش/حذف فرصت فروش و وظیفه ─────────────────────────────────────

export function fetchInternalLead(id: string) {
  return apiFetch<InternalLead>(`/admin/internal/leads/${id}`);
}
export function updateInternalLead(id: string, data: Partial<{ name: string; company: string; phone: string; email: string; value: number; notes: string }>) {
  return apiFetch<InternalLead>(`/admin/internal/leads/${id}`, { method: "PUT", body: JSON.stringify(data) });
}
export function deleteInternalLead(id: string) {
  return apiFetch<{ success: boolean }>(`/admin/internal/leads/${id}`, { method: "DELETE" });
}
export function updateInternalTask(id: string, data: Partial<{ title: string; description: string; dueAt: string; assignedToId: string }>) {
  return apiFetch<InternalTask>(`/admin/internal/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) });
}
export function deleteInternalTask(id: string) {
  return apiFetch<{ success: boolean }>(`/admin/internal/tasks/${id}`, { method: "DELETE" });
}

// ── نمایندگان (رجیستری پلتفرم) ────────────────────────────────────────────────
export type AdminReseller = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  productCode: string | null;
  isVerified: boolean;
  hiddenFromMap: boolean;
  cooperationStatus: "ACTIVE" | "END_REQUESTED" | "ENDED";
  endReason: string | null;
  hasAccess: boolean;
  totalCommission: number;
  amountDue: number;
};
export type AdminResellerSettlement = { id: string; number: number; amountDue: number; totalCommission: number; paidCommission: number; status: "ISSUED" | "SETTLED"; issuedAt: string; note: string | null };

export function fetchAdminResellers() {
  return apiFetch<AdminReseller[]>("/admin/resellers");
}
export function setAdminResellerMapVisibility(id: string, hidden: boolean) {
  return apiFetch<{ success: boolean }>(`/admin/resellers/${id}/map-visibility`, { method: "POST", body: JSON.stringify({ hidden }) });
}
export function endAdminReseller(id: string, reason: string) {
  return apiFetch<AdminResellerSettlement>(`/admin/resellers/${id}/end`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function fetchAdminResellerSettlements(id: string) {
  return apiFetch<AdminResellerSettlement[]>(`/admin/resellers/${id}/settlements`);
}
export function createAdminResellerSettlement(id: string) {
  return apiFetch<AdminResellerSettlement>(`/admin/resellers/${id}/settlements`, { method: "POST", body: JSON.stringify({}) });
}
export function settleAdminResellerSettlement(settlementId: string) {
  return apiFetch<AdminResellerSettlement>(`/admin/resellers/settlements/${settlementId}/settle`, { method: "POST" });
}

// ── تنظیم دستی اشتراک و موجودی پیامک تننت ───────────────────────────────────
export function updateTenantSubscription(tenantId: string, data: { currentPeriodEnd?: string; status?: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED"; lifetime?: boolean; planCode?: string }) {
  return apiFetch<unknown>(`/admin/tenants/${tenantId}/subscription`, { method: "PUT", body: JSON.stringify(data) });
}
export function fetchTenantSmsWallet(tenantId: string) {
  return apiFetch<{ tenantId: string; credits: number }>(`/admin/sms-packages/tenants/${tenantId}/wallet`);
}
export function adjustTenantSmsWallet(tenantId: string, data: { credits?: number; delta?: number; note?: string }) {
  return apiFetch<{ tenantId: string; credits: number }>(`/admin/sms-packages/tenants/${tenantId}/wallet`, { method: "PUT", body: JSON.stringify(data) });
}
export function createSmsPackage(data: { credits: number; priceToman: number }) {
  return apiFetch<SmsPackage>("/admin/sms-packages", { method: "POST", body: JSON.stringify(data) });
}
export function deleteSmsPackage(code: string) {
  return apiFetch<{ success: boolean }>(`/admin/sms-packages/${code}`, { method: "DELETE" });
}

export type ModuleBillingChoice = "MONTHLY" | "YEARLY" | "LICENSE";
export function createTenantModuleInvoice(tenantId: string, data: { items: Array<{ code: string; billingMode: ModuleBillingChoice }>; dueAt?: string; note?: string }) {
  return apiFetch<TenantInvoice>(`/admin/tenants/${tenantId}/module-invoice`, { method: "POST", body: JSON.stringify(data) });
}


// ── بکاپ و بازیابی ─────────────────────────────────────────────────────────

export type BackupTargetStatus = {
  name: string;
  kind: "control" | "tenant";
  lastSuccessAt?: string;
  lastFile?: string;
  lastSize?: number;
  encrypted?: boolean;
  offsite?: boolean;
  lastError?: string;
  lastErrorAt?: string;
  fileCount: number;
  bytes: number;
  plaintextFiles: number;
};

export type RestoreTestEntry = { at: string; target: string; file: string; ok: boolean; durationMs: number; detail: string };

export type BackupStatusResponse = {
  generatedAt: string;
  running: "backup" | "restore-test" | null;
  encryption: { keyConfigured: boolean; required: boolean };
  offsite: { configured: boolean; destination: string | null; prefix: string | null; lastOkAt: string | null; lastError: string | null };
  retention: { daily: number; weekly: number; monthly: number; maxFilesPerDatabase: number };
  disk: { backupBytes: number; freeBytes: number | null; totalBytes: number | null };
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  targets: BackupTargetStatus[];
  lastRestoreTest: RestoreTestEntry | null;
  restoreTests: RestoreTestEntry[];
  warnings: string[];
};

export function fetchBackupStatus() {
  return apiFetch<BackupStatusResponse>("/admin/backups/status");
}
export function runBackupNow() {
  return apiFetch<{ started: boolean }>("/admin/backups/run", { method: "POST" });
}
export function runRestoreTestNow() {
  return apiFetch<{ started: boolean }>("/admin/backups/restore-test", { method: "POST" });
}
