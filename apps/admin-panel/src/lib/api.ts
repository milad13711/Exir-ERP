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

export function adminLogin(email: string, password: string) {
  return apiFetch<{
    accessToken: string;
    admin: { id: string; name: string; team: string };
  }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// ── Tenants ──────────────────────────────────────────────────────────────

export type AdminTenant = {
  id: string;
  slug: string;
  name: string;
  status: "PENDING_PROVISION" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
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

export function fetchIndustryTemplates() {
  return apiFetch<IndustryTemplate[]>("/admin/catalog/industry-templates");
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
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
};

export function fetchTenantInvoices(id: string) {
  return apiFetch<TenantInvoice[]>(`/admin/tenants/${id}/invoices`);
}

export function createTenantInvoice(id: string, data: { amount: number; dueAt: string }) {
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
  isCore: boolean;
  features: string[];
  version: string;
  dependsOn: string[];
};

export function fetchCatalogModules() {
  return apiFetch<CatalogModule[]>("/admin/catalog/modules");
}

export function upsertCatalogModule(data: {
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  isCore?: boolean;
  features?: string[];
  version?: string;
  dependsOn?: string[];
}) {
  return apiFetch<CatalogModule>("/admin/catalog/modules", { method: "POST", body: JSON.stringify(data) });
}

export type CatalogPlan = {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
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
};

export function fetchInternalTasks() {
  return apiFetch<InternalTask[]>("/admin/internal/tasks");
}

export function createInternalTask(data: {
  title: string;
  description?: string;
  dueAt?: string;
  assignedToId?: string;
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
