export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
export const TENANT_SLUG = process.env.NEXT_PUBLIC_TENANT_SLUG ?? "exir-demo";

const TOKEN_KEY = "exir_access_token";

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

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Whether the "افلاین" module is installed for this tenant — plain
 * module-level state (not React), set by WorkspaceProvider once /modules
 * resolves, and read here so apiFetch (a non-component function) can decide
 * whether a network failure should queue for later or just fail normally.
 * Defaults to false: until the real value is known, a tenant that hasn't
 * paid for offline sync shouldn't get it by accident during the loading
 * window.
 */
let offlineModuleInstalled = false;
export function setOfflineModuleInstalled(installed: boolean): void {
  offlineModuleInstalled = installed;
}

/** Best-effort human label for a queued offline request, shown in the pending-sync list. */
function describeQueuedRequest(method: string, path: string): string {
  const segment = path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
  const labels: Record<string, string> = {
    crm: "مشتریان (CRM)",
    accounting: "حسابداری",
    warehouse: "انبار",
    hr: "منابع انسانی",
    tasks: "وظایف",
    support: "پشتیبانی",
    users: "کاربران",
  };
  const label = labels[segment] ?? segment;
  return `${method === "DELETE" ? "حذف" : method === "POST" ? "ثبت" : "ویرایش"} در ${label || "سیستم"}`;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const method = (options.method ?? "GET").toUpperCase();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (networkErr) {
    // A rejected fetch() here means genuinely no connection (DNS/TCP never
    // even completed) — a real HTTP error response would have resolved
    // normally and hit the `!res.ok` branch below instead.
    if (MUTATING_METHODS.has(method) && offlineModuleInstalled) {
      const { enqueue, OfflineQueuedError } = await import("./offline/queue");
      const description = describeQueuedRequest(method, path);
      const queueId = await enqueue(method, path, (options.body as string) ?? null, description);
      throw new OfflineQueuedError(queueId);
    }
    throw networkErr;
  }

  if (!res.ok) {
    let message = "خطایی رخ داد، دوباره تلاش کنید";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      // response had no JSON body — keep the default message
    }
    if (res.status === 401 && typeof window !== "undefined") {
      clearToken();
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export function requestOtp(phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyOtp(phone: string, code: string) {
  return apiFetch<{
    accessToken: string;
    user: { name: string | null; phone: string };
    tenant: { name: string; slug: string };
    role: string;
  }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code, tenantSlug: TENANT_SLUG }),
  });
}

// ── Public signup (unauthenticated — no existing tenant/membership yet) ───

export type PublicIndustryTemplate = {
  code: string;
  name: string;
  description: string | null;
  suggestedThemeColor: string | null;
  defaultModules: string[];
};

export type PublicPlan = {
  code: string;
  name: string;
  priceMonthly: number;
  priceYearly: number | null;
  userLimit: number;
};

export type PublicModule = {
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  isCore: boolean;
  features: string[];
  dependsOn: string[];
};

export function fetchPublicIndustryTemplates() {
  return apiFetch<PublicIndustryTemplate[]>("/public/catalog/industry-templates");
}

export function fetchPublicPlans() {
  return apiFetch<PublicPlan[]>("/public/catalog/plans");
}

export function fetchPublicModules() {
  return apiFetch<PublicModule[]>("/public/catalog/modules");
}

export function requestSignupOtp(phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>("/public/signup/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifySignupOtp(phone: string, code: string) {
  return apiFetch<{ signupToken: string; expiresInSeconds: number }>("/public/signup/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function checkSlugAvailable(slug: string) {
  return apiFetch<{ available: boolean }>(`/public/signup/check-slug?slug=${encodeURIComponent(slug)}`);
}

export function createPublicTenant(input: {
  signupToken: string;
  businessName: string;
  slug: string;
  ownerName: string;
  planCode: string;
  industryTemplateCode?: string;
}) {
  return apiFetch<{
    tenant: { name: string; slug: string; status: string };
    requiresPayment: boolean;
    accessToken?: string;
  }>("/public/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── Workspace ────────────────────────────────────────────────────────────

export type Me = {
  user: { name: string | null; phone: string; roleTitle: string | null; membershipRole: string };
  tenant: { name: string; slug: string; themeColor: string | null };
};

export function fetchMe() {
  return apiFetch<Me>("/me");
}

export function updateBranding(data: { themeColor?: string }) {
  return apiFetch<{ themeColor: string | null }>("/me/branding", { method: "PATCH", body: JSON.stringify(data) });
}

// ── Billing ──────────────────────────────────────────────────────────────

export type Subscription = {
  planName: string;
  planCode: string;
  status: string;
  daysLeft: number;
  currentPeriodEnd: string;
  autoRenew: boolean;
} | null;

export type LicenseStatus =
  | { mode: "cloud" }
  | {
      mode: "on_premise";
      state: "valid" | "grace";
      daysLeft: number;
      payload: { orgName: string; modules: string[]; seats: number; expiresAt: string };
    }
  | { mode: "on_premise"; state: "invalid" | "expired"; reason: string };

/** Only meaningful for on-premise deployments — a cloud tenant always gets {mode:"cloud"}. */
export function fetchLicenseStatus() {
  return apiFetch<LicenseStatus>("/license/status");
}

export function fetchSubscription() {
  return apiFetch<Subscription>("/billing/subscription");
}

export type Invoice = {
  id: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
};

export function fetchInvoices() {
  return apiFetch<Invoice[]>("/billing/invoices");
}

// ── Module marketplace ───────────────────────────────────────────────────

export type ModuleCatalogItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  isCore: boolean;
  version: string;
  dependsOn: string[];
  installStatus: "INSTALLED" | "TRIAL" | "DISABLED" | null;
};

export function fetchModules() {
  return apiFetch<ModuleCatalogItem[]>("/modules");
}

export function installModule(code: string) {
  return apiFetch<ModuleCatalogItem>(`/modules/${code}/install`, { method: "POST" });
}

export function uninstallModule(code: string) {
  return apiFetch<ModuleCatalogItem>(`/modules/${code}/uninstall`, { method: "POST" });
}

// ── Users & roles ────────────────────────────────────────────────────────

export type TenantUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  roles: string[];
};

export function fetchUsers() {
  return apiFetch<TenantUser[]>("/users");
}

export type TenantRoleOption = { id: string; name: string };

export function fetchRoles() {
  return apiFetch<TenantRoleOption[]>("/roles");
}

export function inviteUser(name: string, phone: string, roleId: string) {
  return apiFetch<TenantUser>("/users/invite", {
    method: "POST",
    body: JSON.stringify({ name, phone, roleId }),
  });
}

// ── Access matrix (per role, per module) ───────────────────────────────

export const PERMISSION_MODULES = [
  { code: "crm", label: "مشتریان (CRM)" },
  { code: "accounting", label: "حسابداری" },
  { code: "warehouse", label: "انبار" },
  { code: "hr", label: "منابع انسانی" },
  { code: "tasks", label: "وظایف" },
] as const;

export type ModulePermissionEntry = {
  moduleCode: string;
  canViewAll: boolean;
  canViewOwn: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type TenantRoleWithPermissions = TenantRoleOption & {
  isSystem: boolean;
  modulePermissions: ModulePermissionEntry[];
};

export function fetchRolesWithPermissions() {
  return apiFetch<TenantRoleWithPermissions[]>("/roles");
}

export function updateRolePermissions(roleId: string, entries: ModulePermissionEntry[]) {
  return apiFetch<ModulePermissionEntry[]>(`/roles/${roleId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────

export type ApiTask = {
  id: string;
  title: string;
  dueAt: string | null;
  priority: "NORMAL" | "MEDIUM" | "URGENT";
  status: "OPEN" | "DONE";
  createdAt: string;
  completedAt: string | null;
  assignedUserId?: string | null;
  assignee?: { name: string } | null;
  relatedModule?: string | null;
  relatedEntityId?: string | null;
};

export function fetchTasks(filter?: { relatedModule: string; relatedEntityId: string }) {
  const qs = filter ? `?relatedModule=${filter.relatedModule}&relatedEntityId=${filter.relatedEntityId}` : "";
  return apiFetch<ApiTask[]>(`/tasks${qs}`);
}

export function createTask(data: {
  title: string;
  priority?: ApiTask["priority"];
  dueAt?: string;
  assignedUserId?: string;
  relatedModule?: string;
  relatedEntityId?: string;
}) {
  return apiFetch<ApiTask>("/tasks", { method: "POST", body: JSON.stringify(data) });
}

export function toggleTask(id: string) {
  return apiFetch<ApiTask>(`/tasks/${id}/toggle`, { method: "POST" });
}

export function updateTask(
  id: string,
  data: Partial<{ title: string; priority: ApiTask["priority"]; dueAt: string | null; assignedUserId: string }>,
) {
  return apiFetch<ApiTask>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteTask(id: string) {
  return apiFetch<{ success: boolean }>(`/tasks/${id}`, { method: "DELETE" });
}

// ── Activity feed ────────────────────────────────────────────────────────

export type ActivityEntry = {
  id: string;
  action: string;
  entityType: string;
  userName: string | null;
  createdAt: string;
};

export function fetchActivity() {
  return apiFetch<ActivityEntry[]>("/activity");
}

// ── داشبورد یکپارچه‌ی مدیریتی ────────────────────────────────────────────

export type DashboardSummary = {
  cashBalance: number;
  monthInvoiceCount: number;
  overdueReceivables: {
    total: number;
    count: number;
    items: Array<{
      id: string;
      invoiceNo: number;
      total: number;
      paidAmount: number;
      dueAt: string;
      contact: { name: string; company: string | null };
    }>;
  };
  checksDueSoon: {
    total: number;
    count: number;
    items: Array<{
      id: string;
      direction: "RECEIVED" | "ISSUED";
      sayadId: string;
      amount: number;
      dueDate: string;
      contact: { name: string; company: string | null } | null;
    }>;
  };
  lowStockCount: number;
  producibleCapacity: Array<{
    productId: string;
    productName: string;
    unit: string;
    producibleQty: number;
    bottleneckMaterial: string | null;
  }>;
  salesTrend: Array<{ label: string; value: number }>;
  productionTrend: Array<{ label: string; value: number; valueLastYear: number }>;
  customerFollowUps: Array<{
    contactId: string;
    contactName: string;
    productId: string;
    productName: string;
    avgIntervalDays: number;
    lastPurchaseAt: string;
    daysSinceLastPurchase: number;
    daysOverdue: number;
  }>;
};

export function fetchDashboardSummary() {
  return apiFetch<DashboardSummary>("/dashboard/summary");
}

// ── Logs (Settings → لاگ فعالیت‌ها و خطاها) ─────────────────────────────

export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export type ActivityLogEntry = ActivityEntry & { entityId: string | null; metadata: unknown };

export type ErrorLogEntry = {
  id: string;
  service: string;
  level: "INFO" | "WARNING" | "ERROR" | "FATAL";
  message: string;
  stackTrace: string | null;
  context: unknown;
  createdAt: string;
};

export function fetchActivityLogs(params: {
  module?: string;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return apiFetch<PagedResult<ActivityLogEntry>>(`/logs/activity?${qs.toString()}`);
}

export function fetchActivityModules() {
  return apiFetch<string[]>("/logs/activity/modules");
}

export function fetchErrorLogs(params: { from?: string; to?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return apiFetch<PagedResult<ErrorLogEntry>>(`/logs/errors?${qs.toString()}`);
}

// ── Settings → General ──────────────────────────────────────────────────

export type GeneralSettings = {
  orgName: string;
  logoUrl: string | null;
  timezone: string;
  address: string | null;
  economicCode: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
  phone: string | null;
};

export function fetchGeneralSettings() {
  return apiFetch<GeneralSettings>("/settings/general");
}

export function updateGeneralSettings(data: Partial<GeneralSettings>) {
  return apiFetch<GeneralSettings>("/settings/general", { method: "PUT", body: JSON.stringify(data) });
}

// ── Notifications ────────────────────────────────────────────────────────

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function fetchNotifications() {
  return apiFetch<{ unreadCount: number; items: AppNotification[] }>("/notifications");
}

export function markNotificationRead(id: string) {
  return apiFetch<unknown>(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return apiFetch<unknown>("/notifications/read-all", { method: "POST" });
}

export type NotificationPreferences = { emailEnabled: boolean; smsEnabled: boolean };

export function fetchNotificationPreferences() {
  return apiFetch<NotificationPreferences>("/notifications/preferences");
}

export function updateNotificationPreferences(data: Partial<NotificationPreferences>) {
  return apiFetch<NotificationPreferences>("/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Support ──────────────────────────────────────────────────────────────

export type SupportTicket = {
  id: string;
  subject: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "URGENT";
  createdAt: string;
  assignedAdmin: { name: string } | null;
  messages: SupportMessage[];
};

export type SupportMessage = {
  id: string;
  senderType: "TENANT_USER" | "ADMIN" | "SYSTEM";
  senderId: string | null;
  body: string;
  createdAt: string;
};

export function fetchTickets() {
  return apiFetch<SupportTicket[]>("/support/tickets");
}

export function createTicket(subject: string, message: string) {
  return apiFetch<SupportTicket & { messages: SupportMessage[] }>("/support/tickets", {
    method: "POST",
    body: JSON.stringify({ subject, message }),
  });
}

export function fetchTicketMessages(ticketId: string) {
  return apiFetch<{ ticket: SupportTicket; messages: SupportMessage[] }>(
    `/support/tickets/${ticketId}/messages`,
  );
}

export function addTicketMessage(ticketId: string, body: string) {
  return apiFetch<SupportMessage>(`/support/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// ── CRM ──────────────────────────────────────────────────────────────────

export type CrmDealStage = "NEW" | "CONTACTED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
export type CrmActivityType = "NOTE" | "CALL" | "MEETING" | "EMAIL" | "STAGE_CHANGE";

export type CrmContact = {
  id: string;
  type: "INDIVIDUAL" | "COMPANY";
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  nationalId: string | null;
  economicCode: string | null;
  legalId: string | null;
  registrationNumber: string | null;
  hasBouncedChecks: boolean;
  bankAvgMonthlyTurnover: number | null;
  creditLimitOverride: number | null;
  tags: string[];
  isCustomer: boolean;
  isSupplier: boolean;
  createdAt: string;
  _count?: { deals: number };
};

export type CreditAssessment = {
  score: number;
  creditLimit: number;
  basis: "new" | "history";
  totalOutstanding: number;
  reasons: string[];
};

export type SupplierRiskAssessment = {
  score: number;
  basis: "new" | "history";
  totalOutstanding: number;
  reasons: string[];
};

export type CrmActivity = {
  id: string;
  type: CrmActivityType;
  body: string | null;
  createdAt: string;
  user: { name: string } | null;
};

export type CrmContactDetail = CrmContact & {
  deals: CrmDeal[];
  activities: CrmActivity[];
};

export type CrmDeal = {
  id: string;
  title: string;
  contactId: string;
  value: number;
  stage: CrmDealStage;
  expectedCloseAt: string | null;
  createdAt: string;
  closedAt: string | null;
  contact?: { id: string; name: string; company: string | null };
};

export type CrmDealDetail = CrmDeal & {
  contact: CrmContact;
  activities: CrmActivity[];
};

export function fetchCrmContacts(q?: string) {
  return apiFetch<CrmContact[]>(`/crm/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchCrmContact(id: string) {
  return apiFetch<CrmContactDetail>(`/crm/contacts/${id}`);
}

export function createCrmContact(data: {
  type?: "INDIVIDUAL" | "COMPANY";
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  nationalId?: string;
  economicCode?: string;
  legalId?: string;
  registrationNumber?: string;
  tags?: string[];
}) {
  return apiFetch<CrmContact>("/crm/contacts", { method: "POST", body: JSON.stringify(data) });
}

export function updateCrmContact(
  id: string,
  data: Partial<{
    type: "INDIVIDUAL" | "COMPANY";
    name: string;
    company: string;
    phone: string;
    email: string;
    address: string;
    nationalId: string;
    economicCode: string;
    legalId: string;
    registrationNumber: string;
    tags: string[];
    isCustomer: boolean;
    isSupplier: boolean;
  }>,
) {
  return apiFetch<CrmContact>(`/crm/contacts/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export type StatementLine = {
  date: string;
  kind:
    | "SALES_INVOICE"
    | "SALES_PAYMENT"
    | "SALES_RETURN"
    | "PURCHASE_ORDER"
    | "PURCHASE_PAYMENT"
    | "PURCHASE_RETURN"
    | "PARTY_RECEIPT"
    | "PARTY_PAYMENT"
    | "CHECK_RECEIVED"
    | "CHECK_ISSUED";
  description: string;
  arDelta: number;
  apDelta: number;
  refId: string;
};

export type PartyStatement = {
  lines: StatementLine[];
  arBalance: number;
  apBalance: number;
};

export function fetchPartyStatement(id: string) {
  return apiFetch<PartyStatement>(`/crm/contacts/${id}/statement`);
}

export function createPartyTransaction(
  id: string,
  data: { type: "RECEIPT" | "PAYMENT"; amount: number; accountCode?: string; note?: string },
) {
  return apiFetch<{ id: string }>(`/crm/contacts/${id}/transactions`, { method: "POST", body: JSON.stringify(data) });
}

export function createPartyTransfer(data: {
  fromContactId: string;
  toContactId: string;
  amount: number;
  note?: string;
}) {
  return apiFetch<{ success: boolean }>("/crm/contacts/transfers", { method: "POST", body: JSON.stringify(data) });
}

export function fetchContactCredit(id: string) {
  return apiFetch<CreditAssessment>(`/crm/contacts/${id}/credit`);
}

export function fetchSupplierRisk(id: string) {
  return apiFetch<SupplierRiskAssessment>(`/crm/contacts/${id}/supplier-risk`);
}

export function updateContactCreditInputs(
  id: string,
  data: { hasBouncedChecks?: boolean; bankAvgMonthlyTurnover?: number | null; creditLimitOverride?: number | null },
) {
  return apiFetch<CreditAssessment>(`/crm/contacts/${id}/credit-inputs`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function addCrmContactActivity(contactId: string, type: CrmActivityType, body?: string) {
  return apiFetch<CrmActivity>(`/crm/contacts/${contactId}/activities`, {
    method: "POST",
    body: JSON.stringify({ type, body }),
  });
}

export function fetchCrmDeals() {
  return apiFetch<CrmDeal[]>("/crm/deals");
}

export function fetchCrmDeal(id: string) {
  return apiFetch<CrmDealDetail>(`/crm/deals/${id}`);
}

export function createCrmDeal(data: {
  title: string;
  contactId: string;
  value?: number;
  expectedCloseAt?: string;
}) {
  return apiFetch<CrmDeal>("/crm/deals", { method: "POST", body: JSON.stringify(data) });
}

export function updateCrmDealStage(id: string, stage: CrmDealStage) {
  return apiFetch<CrmDeal>(`/crm/deals/${id}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}

export function updateCrmDeal(
  id: string,
  data: Partial<{ title: string; contactId: string; value: number; expectedCloseAt: string | null }>,
) {
  return apiFetch<CrmDeal>(`/crm/deals/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteCrmDeal(id: string) {
  return apiFetch<{ success: boolean }>(`/crm/deals/${id}`, { method: "DELETE" });
}

export function addCrmDealActivity(dealId: string, type: CrmActivityType, body?: string) {
  return apiFetch<CrmActivity>(`/crm/deals/${dealId}/activities`, {
    method: "POST",
    body: JSON.stringify({ type, body }),
  });
}

// ── Accounting ───────────────────────────────────────────────────────────

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isCashAccount: boolean;
  isSystem: boolean;
  balance: number;
};

export function fetchAccounts() {
  return apiFetch<Account[]>("/accounting/accounts");
}

export function createAccount(data: {
  code: string;
  name: string;
  type: AccountType;
  isCashAccount?: boolean;
}) {
  return apiFetch<Account>("/accounting/accounts", { method: "POST", body: JSON.stringify(data) });
}

export type LedgerRow = {
  id: string;
  entryNumber: number;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

export function fetchAccountLedger(accountId: string) {
  return apiFetch<{ account: Account; rows: LedgerRow[] }>(`/accounting/accounts/${accountId}/ledger`);
}

// ── مغایرت‌گیری بانکی ────────────────────────────────────────────────────

export type BankStatementLine = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  reference: string | null;
  matchedJournalLineId: string | null;
  reconciledAt: string | null;
  matchedJournalLine?: { id: string; debit: number; credit: number; entry: { number: number; date: string } } | null;
};

export type UnreconciledJournalLine = {
  id: string;
  entryNumber: number;
  date: string;
  description: string | null;
  amount: number;
};

export type ReconciliationOverview = {
  account: Account;
  bookBalance: number;
  statementBalance: number;
  reconciledBalance: number;
  difference: number;
  unreconciledStatementLines: BankStatementLine[];
  reconciledStatementLines: BankStatementLine[];
  unreconciledJournalLines: UnreconciledJournalLine[];
};

export function fetchReconciliation(accountId: string) {
  return apiFetch<ReconciliationOverview>(`/accounting/reconciliation/${accountId}`);
}

export function addStatementLines(
  accountId: string,
  lines: Array<{ date: string; description: string; amount: number; reference?: string }>,
) {
  return apiFetch<{ success: boolean; count: number }>(`/accounting/reconciliation/${accountId}/statement-lines`, {
    method: "POST",
    body: JSON.stringify({ lines }),
  });
}

export function deleteStatementLine(id: string) {
  return apiFetch<{ success: boolean }>(`/accounting/reconciliation/statement-lines/${id}`, { method: "DELETE" });
}

export function matchStatementLine(statementLineId: string, journalLineId: string) {
  return apiFetch<BankStatementLine>("/accounting/reconciliation/match", {
    method: "POST",
    body: JSON.stringify({ statementLineId, journalLineId }),
  });
}

export function unmatchStatementLine(statementLineId: string) {
  return apiFetch<BankStatementLine>(`/accounting/reconciliation/unmatch/${statementLineId}`, { method: "POST" });
}

export function autoMatchReconciliation(accountId: string) {
  return apiFetch<{ matched: number }>(`/accounting/reconciliation/${accountId}/auto-match`, { method: "POST" });
}

// ── بودجه‌بندی ────────────────────────────────────────────────────────────

export type BudgetLine = {
  id: string;
  accountId: string;
  amount: number;
  account: { id: string; code: string; name: string; type: AccountType };
};

export type BudgetLineWithActual = BudgetLine & { actual: number; variance: number };

export type Budget = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};

export type BudgetDetail = Budget & { lines: BudgetLineWithActual[] };

export function fetchBudgets() {
  return apiFetch<Budget[]>("/accounting/budgets");
}

export function fetchBudget(id: string) {
  return apiFetch<BudgetDetail>(`/accounting/budgets/${id}`);
}

export function createBudget(data: {
  name: string;
  periodStart: string;
  periodEnd: string;
  lines: Array<{ accountId: string; amount: number }>;
}) {
  return apiFetch<BudgetDetail>("/accounting/budgets", { method: "POST", body: JSON.stringify(data) });
}

export function updateBudget(
  id: string,
  data: Partial<{
    name: string;
    periodStart: string;
    periodEnd: string;
    lines: Array<{ accountId: string; amount: number }>;
  }>,
) {
  return apiFetch<BudgetDetail>(`/accounting/budgets/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteBudget(id: string) {
  return apiFetch<{ success: boolean }>(`/accounting/budgets/${id}`, { method: "DELETE" });
}

// ── دارایی‌های ثابت ──────────────────────────────────────────────────────

export type FixedAssetStatus = "ACTIVE" | "DISPOSED";

export type Depreciation = {
  monthlyDepreciation: number;
  monthsElapsed: number;
  accumulatedDepreciation: number;
  bookValue: number;
};

export type FixedAsset = {
  id: string;
  name: string;
  category: string | null;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  status: FixedAssetStatus;
  disposedAt: string | null;
  disposalAmount: number | null;
  postedDepreciation: number;
  notes: string | null;
  depreciation: Depreciation;
};

export function fetchFixedAssets() {
  return apiFetch<FixedAsset[]>("/accounting/fixed-assets");
}

export function fetchFixedAsset(id: string) {
  return apiFetch<FixedAsset>(`/accounting/fixed-assets/${id}`);
}

export function createFixedAsset(data: {
  name: string;
  category?: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  notes?: string;
}) {
  return apiFetch<FixedAsset>("/accounting/fixed-assets", { method: "POST", body: JSON.stringify(data) });
}

export function postFixedAssetDepreciation(id: string) {
  return apiFetch<{ posted: number }>(`/accounting/fixed-assets/${id}/post-depreciation`, { method: "POST" });
}

export function disposeFixedAsset(id: string, data: { disposedAt?: string; disposalAmount?: number }) {
  return apiFetch<FixedAsset>(`/accounting/fixed-assets/${id}/dispose`, { method: "POST", body: JSON.stringify(data) });
}

export type JournalEntryStatus = "DRAFT" | "POSTED";

export type JournalLine = {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string | null;
  account: { id: string; code: string; name: string };
};

export type JournalEntry = {
  id: string;
  number: number;
  date: string;
  description: string | null;
  status: JournalEntryStatus;
  createdAt: string;
  postedAt: string | null;
  lines: JournalLine[];
  createdBy: { name: string } | null;
};

export function fetchJournalEntries() {
  return apiFetch<JournalEntry[]>("/accounting/entries");
}

export function fetchJournalEntry(id: string) {
  return apiFetch<JournalEntry>(`/accounting/entries/${id}`);
}

export function createJournalEntry(data: {
  date: string;
  description?: string;
  lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }>;
}) {
  return apiFetch<JournalEntry>("/accounting/entries", { method: "POST", body: JSON.stringify(data) });
}

export function postJournalEntry(id: string) {
  return apiFetch<JournalEntry>(`/accounting/entries/${id}/post`, { method: "POST" });
}

export type AccountingSummary = {
  cashBalance: number;
  monthRevenue: number;
  monthExpense: number;
  draftCount: number;
};

export function fetchAccountingSummary() {
  return apiFetch<AccountingSummary>("/accounting/summary");
}

// ── Financial reports: تراز آزمایشی، سود و زیان، ترازنامه ─────────────

export type TrialBalanceRow = { accountId: string; code: string; name: string; type: AccountType; debit: number; credit: number; balance: number };
export type TrialBalance = { asOf: string; rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number };

export function fetchTrialBalance(asOf?: string) {
  return apiFetch<TrialBalance>(`/accounting/reports/trial-balance${asOf ? `?asOf=${asOf}` : ""}`);
}

export type IncomeStatementRow = { accountId: string; code: string; name: string; amount: number };
export type IncomeStatement = {
  from: string;
  to: string;
  revenueRows: IncomeStatementRow[];
  expenseRows: IncomeStatementRow[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
};

export function fetchIncomeStatement(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiFetch<IncomeStatement>(`/accounting/reports/income-statement${qs ? `?${qs}` : ""}`);
}

export type BalanceSheet = {
  asOf: string;
  assetRows: IncomeStatementRow[];
  liabilityRows: IncomeStatementRow[];
  equityRows: IncomeStatementRow[];
  retainedEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balances: boolean;
};

export function fetchBalanceSheet(asOf?: string) {
  return apiFetch<BalanceSheet>(`/accounting/reports/balance-sheet${asOf ? `?asOf=${asOf}` : ""}`);
}

// ── ارزها ────────────────────────────────────────────────────────────────

export type Currency = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  rate: string; // Decimal از سرور به‌صورت رشته می‌آید
  isActive: boolean;
  autoUpdate: boolean;
  lastAutoRateAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchCurrencies() {
  return apiFetch<Currency[]>("/settings/currencies");
}

export function createCurrency(data: { code: string; name: string; symbol?: string; rate: number; isActive?: boolean }) {
  return apiFetch<Currency>("/settings/currencies", { method: "POST", body: JSON.stringify(data) });
}

export function updateCurrency(
  id: string,
  data: Partial<{ name: string; symbol: string; rate: number; isActive: boolean; autoUpdate: boolean }>,
) {
  return apiFetch<Currency>(`/settings/currencies/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteCurrency(id: string) {
  return apiFetch<{ success: boolean }>(`/settings/currencies/${id}`, { method: "DELETE" });
}

// ── Warehouse ────────────────────────────────────────────────────────────

export type StockMovementType = "RECEIPT" | "ISSUE" | "ADJUSTMENT";

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  costPrice: number;
  salePrice: number;
  reorderPoint: number;
  isActive: boolean;
  createdAt: string;
  stock: number;
  isLowStock: boolean;
  currencyId: string | null;
  costPriceFx: string | null;
  salePriceFx: string | null;
  currency?: Currency | null;
};

export type StockMovement = {
  id: string;
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  quantityDelta: number;
  unitCost: number | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  createdBy: { name: string } | null;
  warehouse?: { id: string; name: string };
};

export type WarehouseStockEntry = { warehouseId: string; warehouseName: string; quantity: number };

export type ProductDetail = Product & { movements: StockMovement[]; stockByWarehouse: WarehouseStockEntry[] };

export function fetchProducts(q?: string) {
  return apiFetch<Product[]>(`/warehouse/products${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchProduct(id: string) {
  return apiFetch<ProductDetail>(`/warehouse/products/${id}`);
}

export function createProduct(data: {
  sku: string;
  name: string;
  unit?: string;
  category?: string;
  costPrice?: number;
  salePrice?: number;
  reorderPoint?: number;
  currencyId?: string;
  costPriceFx?: number;
  salePriceFx?: number;
}) {
  return apiFetch<Product>("/warehouse/products", { method: "POST", body: JSON.stringify(data) });
}

export function updateProduct(
  id: string,
  data: Partial<{
    sku: string;
    name: string;
    unit: string;
    category: string;
    costPrice: number;
    salePrice: number;
    reorderPoint: number;
    currencyId: string; // "" یعنی حذف ارز
    costPriceFx: number;
    salePriceFx: number;
  }>,
) {
  return apiFetch<Product>(`/warehouse/products/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteProduct(id: string) {
  return apiFetch<{ success: boolean }>(`/warehouse/products/${id}`, { method: "DELETE" });
}

export function createStockMovement(data: {
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  quantity: number;
  unitCost?: number;
  reference?: string;
  note?: string;
}) {
  return apiFetch<StockMovement>("/warehouse/movements", { method: "POST", body: JSON.stringify(data) });
}

export function createStockTransfer(data: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  note?: string;
}) {
  return apiFetch<StockMovement>("/warehouse/movements/transfer", { method: "POST", body: JSON.stringify(data) });
}

export type Warehouse = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  stockOnHand: number;
};

export function fetchWarehouses() {
  return apiFetch<Warehouse[]>("/warehouse/warehouses");
}

export function createWarehouse(data: { name: string; code?: string; address?: string }) {
  return apiFetch<Warehouse>("/warehouse/warehouses", { method: "POST", body: JSON.stringify(data) });
}

export function updateWarehouse(id: string, data: Partial<{ name: string; code: string; address: string }>) {
  return apiFetch<Warehouse>(`/warehouse/warehouses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function setDefaultWarehouse(id: string) {
  return apiFetch<Warehouse>(`/warehouse/warehouses/${id}/set-default`, { method: "POST" });
}

export function deleteWarehouse(id: string) {
  return apiFetch<{ success: boolean; softDeleted: boolean }>(`/warehouse/warehouses/${id}`, { method: "DELETE" });
}

export type WarehouseSummary = {
  totalProducts: number;
  lowStockCount: number;
  inventoryValue: number;
  movementsThisMonth: number;
};

export function fetchWarehouseSummary() {
  return apiFetch<WarehouseSummary>("/warehouse/summary");
}

export type CostingMethod = "LAST_COST" | "WEIGHTED_AVERAGE" | "FIFO";

export function fetchCostingMethod() {
  return apiFetch<{ method: CostingMethod }>("/warehouse/settings/costing-method");
}

export function updateCostingMethod(method: CostingMethod) {
  return apiFetch<{ method: CostingMethod }>("/warehouse/settings/costing-method", {
    method: "PUT",
    body: JSON.stringify({ method }),
  });
}

// ── تولید (Production) ──────────────────────────────────────────────────

export type BomLine = {
  id: string;
  rawMaterialProductId: string;
  quantityPerBatch: number;
  rawMaterial: { id: string; name: string; unit: string };
};

export type Bom = {
  id: string;
  outputProductId: string;
  batchOutputQty: number;
  version: number;
  isActive: boolean;
  createdAt: string;
  outputProduct: { id: string; name: string; unit: string; sku: string };
  lines: BomLine[];
};

export function fetchBoms() {
  return apiFetch<Bom[]>("/production/boms");
}

export function fetchBom(id: string) {
  return apiFetch<Bom>(`/production/boms/${id}`);
}

export function createBom(data: {
  outputProductId: string;
  batchOutputQty: number;
  lines: Array<{ rawMaterialProductId: string; quantityPerBatch: number }>;
}) {
  return apiFetch<Bom>("/production/boms", { method: "POST", body: JSON.stringify(data) });
}

export type WorkCenter = { id: string; name: string; sequenceOrder: number; isActive: boolean };

export function fetchWorkCenters() {
  return apiFetch<WorkCenter[]>("/production/work-centers");
}

export function createWorkCenter(data: { name: string; sequenceOrder?: number }) {
  return apiFetch<WorkCenter>("/production/work-centers", { method: "POST", body: JSON.stringify(data) });
}

export type ProductionOrderStatus =
  | "DRAFT"
  | "RAW_MATERIAL_APPROVED"
  | "IN_PROGRESS"
  | "QC_PENDING"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export type ProductionOrderStage = {
  id: string;
  sequenceOrder: number;
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  startedAt: string | null;
  endedAt: string | null;
  report: string | null;
  workCenter: WorkCenter;
  assignedUser: { id: string; name: string } | null;
};

export type ProductionOrder = {
  id: string;
  orderNo: number;
  status: ProductionOrderStatus;
  quantityPlanned: number;
  quantityProduced: number | null;
  relatedInvoiceId: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  rawMaterialApprovedAt: string | null;
  rawMaterialApprovalNotes: string | null;
  qualityApprovedAt: string | null;
  createdAt: string;
  bom: Bom;
  warehouse: { id: string; name: string };
  stages: ProductionOrderStage[];
};

export function fetchProductionOrders(status?: ProductionOrderStatus) {
  return apiFetch<ProductionOrder[]>(`/production/orders${status ? `?status=${status}` : ""}`);
}

export function fetchProductionOrder(id: string) {
  return apiFetch<ProductionOrder>(`/production/orders/${id}`);
}

export function createProductionOrder(data: {
  bomId: string;
  warehouseId: string;
  quantityPlanned: number;
  relatedInvoiceId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  stages?: Array<{ workCenterId: string; assignedUserId?: string }>;
}) {
  return apiFetch<ProductionOrder>("/production/orders", { method: "POST", body: JSON.stringify(data) });
}

export function approveRawMaterials(id: string, notes?: string) {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/approve-raw-materials`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export function startProductionOrder(id: string) {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/start`, { method: "POST" });
}

export function updateProductionStage(
  orderId: string,
  stageId: string,
  data: { status?: "PENDING" | "IN_PROGRESS" | "DONE"; report?: string; assignedUserId?: string },
) {
  return apiFetch<ProductionOrderStage>(`/production/orders/${orderId}/stages/${stageId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function completeProductionOrder(id: string, quantityProduced?: number) {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ quantityProduced }),
  });
}

export function rejectProductionOrder(id: string, reason: string) {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ── کنترل کیفیت (Quality Control) ───────────────────────────────────────

export type QualityTestType = {
  id: string;
  name: string;
  unit: string;
  acceptableMin: string | null;
  acceptableMax: string | null;
  description: string | null;
};

export function fetchTestTypes() {
  return apiFetch<QualityTestType[]>("/quality-control/test-types");
}

export function createTestType(data: { name: string; unit: string; acceptableMin?: number; acceptableMax?: number; description?: string }) {
  return apiFetch<QualityTestType>("/quality-control/test-types", { method: "POST", body: JSON.stringify(data) });
}

export type QualityVerdict = "PENDING" | "PASS" | "FAIL";

export type QualitySampleResult = {
  id: string;
  measuredValue: string;
  verdict: QualityVerdict;
  testedAt: string;
  testType: QualityTestType;
  testedBy: { id: string; name: string } | null;
};

export type QualitySample = {
  id: string;
  productionOrderId: string;
  source: "IN_PROCESS" | "FINAL_PRODUCT";
  sampledAt: string;
  note: string | null;
  verdict: QualityVerdict;
  sampledBy: { id: string; name: string } | null;
  productionOrderStage: { workCenter: { name: string } } | null;
  productionOrder: { orderNo: number; bom: { outputProduct: { name: string } } };
  results: QualitySampleResult[];
};

export function fetchSamples(productionOrderId?: string) {
  return apiFetch<QualitySample[]>(`/quality-control/samples${productionOrderId ? `?productionOrderId=${productionOrderId}` : ""}`);
}

export function createSample(data: { productionOrderId: string; productionOrderStageId?: string; source: "IN_PROCESS" | "FINAL_PRODUCT"; note?: string }) {
  return apiFetch<QualitySample>("/quality-control/samples", { method: "POST", body: JSON.stringify(data) });
}

export function addSampleResult(sampleId: string, data: { testTypeId: string; measuredValue: number }) {
  return apiFetch<QualitySample>(`/quality-control/samples/${sampleId}/results`, { method: "POST", body: JSON.stringify(data) });
}

// ── HR ───────────────────────────────────────────────────────────────────

export type EmploymentStatus = "ACTIVE" | "TERMINATED";

export type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  nationalId: string | null;
  position: string;
  department: string | null;
  phone: string | null;
  email: string | null;
  hireDate: string;
  baseSalary: number;
  status: EmploymentStatus;
  managerId: string | null;
  createdAt: string;
};

export type OrgChartEntry = {
  id: string;
  fullName: string;
  position: string;
  department: string | null;
  managerId: string | null;
  status: EmploymentStatus;
};

export type EmployeeDocumentType = "CONTRACT" | "NATIONAL_ID" | "DEGREE_CERTIFICATE" | "OTHER";

export type EmployeeDocument = {
  id: string;
  type: EmployeeDocumentType;
  title: string;
  fileUrl: string;
  uploadedAt: string;
  expiresAt: string | null;
};

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LEAVE" | "HOLIDAY";

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
};

export type LeaveType = "ANNUAL" | "SICK" | "UNPAID";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
  employee: { id: string; fullName: string; employeeCode: string };
};

export type PayrollStatus = "DRAFT" | "ISSUED" | "PAID";

export type PayrollSlip = {
  id: string;
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  baseSalary: number;
  allowances: number;
  deductions: number;
  insuranceAmount: number;
  taxAmount: number;
  status: PayrollStatus;
  issuedAt: string | null;
  paidAt: string | null;
  employee: { id: string; fullName: string; employeeCode: string; position: string };
};

export type EmployeeDetail = Employee & {
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  payrollSlips: PayrollSlip[];
  documents: EmployeeDocument[];
  manager: { id: string; fullName: string; position: string } | null;
  directReports: Array<{ id: string; fullName: string; position: string }>;
};

export function fetchEmployees(q?: string) {
  return apiFetch<Employee[]>(`/hr/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function fetchOrgChart() {
  return apiFetch<OrgChartEntry[]>("/hr/employees/org-chart");
}

export function fetchEmployee(id: string) {
  return apiFetch<EmployeeDetail>(`/hr/employees/${id}`);
}

export function createEmployee(data: {
  employeeCode: string;
  fullName: string;
  position: string;
  department?: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  hireDate: string;
  baseSalary?: number;
  managerId?: string;
}) {
  return apiFetch<Employee>("/hr/employees", { method: "POST", body: JSON.stringify(data) });
}

export function assignManager(employeeId: string, managerId: string | null) {
  return apiFetch<Employee>(`/hr/employees/${employeeId}/manager`, {
    method: "POST",
    body: JSON.stringify({ managerId }),
  });
}

export function updateEmployee(
  id: string,
  data: Partial<{
    employeeCode: string;
    fullName: string;
    position: string;
    department: string;
    nationalId: string;
    phone: string;
    email: string;
    hireDate: string;
    baseSalary: number;
  }>,
) {
  return apiFetch<Employee>(`/hr/employees/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function terminateEmployee(id: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/terminate`, { method: "POST" });
}

export function reactivateEmployee(id: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/reactivate`, { method: "POST" });
}

export function addEmployeeDocument(
  employeeId: string,
  data: { type: EmployeeDocumentType; title: string; fileUrl: string; expiresAt?: string },
) {
  return apiFetch<EmployeeDocument>(`/hr/employees/${employeeId}/documents`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchAttendance(date: string) {
  return apiFetch<Array<{ employee: Employee; record: AttendanceRecord | null }>>(
    `/hr/attendance?date=${date}`,
  );
}

export function markAttendance(data: {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
}) {
  return apiFetch<AttendanceRecord>("/hr/attendance", { method: "POST", body: JSON.stringify(data) });
}

export function fetchLeaveRequests() {
  return apiFetch<LeaveRequest[]>("/hr/leave");
}

export function createLeaveRequest(data: {
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}) {
  return apiFetch<LeaveRequest>("/hr/leave", { method: "POST", body: JSON.stringify(data) });
}

export function approveLeaveRequest(id: string) {
  return apiFetch<LeaveRequest>(`/hr/leave/${id}/approve`, { method: "POST" });
}

export function rejectLeaveRequest(id: string) {
  return apiFetch<LeaveRequest>(`/hr/leave/${id}/reject`, { method: "POST" });
}

export function fetchPayroll(year: number, month: number) {
  return apiFetch<PayrollSlip[]>(`/hr/payroll?year=${year}&month=${month}`);
}

export function generatePayroll(year: number, month: number) {
  return apiFetch<PayrollSlip[]>("/hr/payroll/generate", {
    method: "POST",
    body: JSON.stringify({ year, month }),
  });
}

export function updatePayrollSlip(id: string, allowances: number, deductions: number) {
  return apiFetch<PayrollSlip>(`/hr/payroll/${id}`, {
    method: "POST",
    body: JSON.stringify({ allowances, deductions }),
  });
}

export function issuePayrollSlip(id: string) {
  return apiFetch<PayrollSlip>(`/hr/payroll/${id}/issue`, { method: "POST" });
}

export function payPayrollSlip(id: string) {
  return apiFetch<PayrollSlip>(`/hr/payroll/${id}/pay`, { method: "POST" });
}

export function openPayrollSlipPdf(id: string): Promise<void> {
  return fetchAndOpenPdf(`/hr/payroll/${id}/pdf`);
}

export type PayrollTaxSettings = {
  insuranceEmployeeRate: number;
  taxExemptionMonthly: number;
  taxRate: number;
};

export function fetchPayrollTaxSettings() {
  return apiFetch<PayrollTaxSettings>("/hr/payroll/settings/tax-insurance");
}

export function updatePayrollTaxSettings(data: PayrollTaxSettings) {
  return apiFetch<PayrollTaxSettings>("/hr/payroll/settings/tax-insurance", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export type HrSummary = {
  totalEmployees: number;
  presentToday: number;
  pendingLeaveCount: number;
  monthlyPayrollTotal: number;
};

export function fetchHrSummary() {
  return apiFetch<HrSummary>("/hr/summary");
}

// ── API keys, webhooks, MCP (Settings → API) ────────────────────────────

export type ApiKeyEntry = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function fetchApiKeys() {
  return apiFetch<ApiKeyEntry[]>("/settings/api-keys");
}

export function createApiKey(name: string) {
  return apiFetch<ApiKeyEntry & { rawKey: string }>("/settings/api-keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(id: string) {
  return apiFetch<ApiKeyEntry>(`/settings/api-keys/${id}/revoke`, { method: "POST" });
}

export type WebhookSubscription = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  event: string;
  status: "SUCCESS" | "FAILED";
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
};

export function fetchWebhookEvents() {
  return apiFetch<string[]>("/settings/webhooks/events");
}

export function fetchWebhooks() {
  return apiFetch<WebhookSubscription[]>("/settings/webhooks");
}

export function createWebhook(url: string, events: string[]) {
  return apiFetch<WebhookSubscription>("/settings/webhooks", {
    method: "POST",
    body: JSON.stringify({ url, events }),
  });
}

export function toggleWebhook(id: string) {
  return apiFetch<WebhookSubscription>(`/settings/webhooks/${id}/toggle`, { method: "POST" });
}

export function deleteWebhook(id: string) {
  return apiFetch<{ success: boolean }>(`/settings/webhooks/${id}`, { method: "DELETE" });
}

export function fetchWebhookDeliveries(id: string) {
  return apiFetch<WebhookDelivery[]>(`/settings/webhooks/${id}/deliveries`);
}

// ── Sales: سفارش فروش → فاکتور → پرداخت ────────────────────────────────

export type SalesInvoiceStatus = "DRAFT" | "CONFIRMED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type SalesPaymentMethod = "CASH" | "BANK_TRANSFER" | "CHECK" | "POS";

export type SalesInvoiceLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: { id: string; name: string; sku: string } | null;
  currencyId: string | null;
  unitPriceFx: string | null;
  exchangeRateFx: string | null;
  currency?: { code: string; symbol: string | null } | null;
};

export type SalesPayment = {
  id: string;
  amount: number;
  method: SalesPaymentMethod;
  paidAt: string;
  note: string | null;
};

export type SalesInvoice = {
  id: string;
  invoiceNo: number;
  officialInvoiceNo: number | null;
  status: SalesInvoiceStatus;
  issuedAt: string;
  dueAt: string | null;
  subtotal: number;
  discount: number;
  taxRate: number | null;
  taxAmount: number;
  total: number;
  paidAmount: number;
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  isOfficial: boolean;
  signedByName: string | null;
  signatureDataUrl: string | null;
  signedAt: string | null;
  deliveryConfirmedAt: string | null;
  deliveryConfirmedName: string | null;
  deliverySignatureDataUrl: string | null;
  deliveryCodeSentAt: string | null;
  contact: { id: string; name: string; company: string | null };
};

export type SalesInvoiceDetail = SalesInvoice & {
  contact: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
    type: "INDIVIDUAL" | "COMPANY";
    address: string | null;
    nationalId: string | null;
    economicCode: string | null;
    legalId: string | null;
    registrationNumber: string | null;
  };
  deal: { id: string; title: string } | null;
  lines: SalesInvoiceLine[];
  payments: SalesPayment[];
  creditWarning: string | null;
};

export function fetchSalesInvoices() {
  return apiFetch<SalesInvoice[]>("/sales/invoices");
}

export function fetchSalesInvoice(id: string) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}`);
}

export function createSalesInvoice(data: {
  contactId: string;
  dealId?: string;
  dueAt?: string;
  discount?: number;
  notes?: string;
  isOfficial?: boolean;
  taxRate?: number;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    currencyId?: string;
    unitPriceFx?: number;
    exchangeRateFx?: number;
  }>;
}) {
  return apiFetch<SalesInvoiceDetail>("/sales/invoices", { method: "POST", body: JSON.stringify(data) });
}

export function confirmSalesInvoice(id: string) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}/confirm`, { method: "POST" });
}

export function recordSalesPayment(
  id: string,
  data: {
    amount: number;
    method?: SalesPaymentMethod;
    note?: string;
    checkSayadId?: string;
    checkDueDate?: string;
    checkBankName?: string;
  },
) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}/payments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function signSalesInvoice(id: string, signatureDataUrl: string) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}/sign`, {
    method: "POST",
    body: JSON.stringify({ signatureDataUrl }),
  });
}

export function sendDeliveryCode(id: string) {
  return apiFetch<{ expiresInSeconds: number; smsSent: boolean; devCode?: string }>(
    `/sales/invoices/${id}/delivery/code`,
    { method: "POST" },
  );
}

export function confirmDelivery(
  id: string,
  data: { method: "CODE" | "SIGNATURE"; code?: string; signatureDataUrl?: string; confirmerName: string },
) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}/delivery/confirm`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchDeliverySmsTemplate() {
  return apiFetch<{ template: string }>("/sales/invoices/settings/delivery-sms-template");
}

export function setDeliverySmsTemplate(template: string) {
  return apiFetch<{ template: string }>("/sales/invoices/settings/delivery-sms-template", {
    method: "PUT",
    body: JSON.stringify({ template }),
  });
}

export function fetchPaymentReminderDays() {
  return apiFetch<{ days: number }>("/sales/invoices/settings/payment-reminder-days");
}

export function setPaymentReminderDays(days: number) {
  return apiFetch<{ days: number }>("/sales/invoices/settings/payment-reminder-days", {
    method: "PUT",
    body: JSON.stringify({ days }),
  });
}

export async function downloadBackupExport(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/settings/backup/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("دریافت فایل پشتیبان ناموفق بود", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `exir-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function uploadBackupImport(file: File): Promise<{ success: boolean }> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("فایل انتخاب‌شده یک JSON معتبر نیست", 400);
  }
  return apiFetch<{ success: boolean }>("/settings/backup/import", {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

// ── ورود/خروج اکسل (Excel import/export) ─────────────────────────────────
// عمومی برای هر ماژول: هر صفحه‌ی لیست فقط export/import path خودش را
// می‌دهد؛ دانلود/آپلود فایل و رمزگشایی base64 اینجا یک‌بار پیاده شده.

export type ExcelImportRowResult = { row: number; status: "CREATED" | "UPDATED" | "SKIPPED"; reason?: string };
export type ExcelImportSummary = { created: number; updated: number; skipped: number; details: ExcelImportRowResult[] };

export async function downloadExcelFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("دریافت فایل اکسل ناموفق بود", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",").pop() ?? "");
    reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود"));
    reader.readAsDataURL(file);
  });
}

export async function uploadExcelImport(path: string, file: File): Promise<ExcelImportSummary> {
  const fileBase64 = await fileToBase64(file);
  return apiFetch<ExcelImportSummary>(path, { method: "POST", body: JSON.stringify({ fileBase64 }) });
}

/**
 * Fetches a PDF with the auth header (a plain link can't carry it) and opens
 * it via a same-document anchor click rather than window.open() into a
 * separate tab — on iOS/Android mobile browsers, a blob: URL assigned to a
 * pre-opened popup tab frequently fails to render (WebKit doesn't reliably
 * hand the blob across the window boundary), while an in-page anchor click
 * opens/downloads it reliably everywhere.
 */
async function fetchAndOpenPdf(path: string): Promise<void> {
  // Mobile browsers only allow window.open()/target="_blank" as a direct,
  // synchronous result of the click — opening it AFTER an awaited fetch()
  // (even a fast one) is no longer considered gesture-triggered and gets
  // silently popup-blocked, unlike on most desktop browsers. So we open a
  // blank tab synchronously first, on the click itself, then point it at
  // the PDF once it's fetched (needs a Bearer header a plain nav can't send).
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = "در حال بارگذاری...";
  }
  try {
    const token = getToken();
    const res = await fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError("دریافت فایل PDF ناموفق بود", res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      // Popup was blocked or the tab never opened (older WebViews) — fall
      // back to a same-tab navigation, which mobile browsers render inline.
      window.location.href = url;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export function openSalesInvoicePdf(id: string): Promise<void> {
  return fetchAndOpenPdf(`/sales/invoices/${id}/pdf`);
}

// ── پیش‌فاکتور (Quotation) — پیشنهاد قیمت قبل از صدور فاکتور ─────────────

export type SalesQuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CONVERTED";

export type SalesQuotationLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: { id: string; name: string; sku: string } | null;
  currencyId: string | null;
  unitPriceFx: string | null;
  exchangeRateFx: string | null;
  currency?: { code: string; symbol: string | null } | null;
};

export type SalesQuotation = {
  id: string;
  quotationNo: number;
  status: SalesQuotationStatus;
  issuedAt: string;
  validUntil: string | null;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  createdAt: string;
  respondedAt: string | null;
  convertedInvoiceId: string | null;
  contact: { id: string; name: string; company: string | null };
};

export type SalesQuotationDetail = SalesQuotation & {
  contact: { id: string; name: string; company: string | null; phone: string | null; email: string | null };
  deal: { id: string; title: string } | null;
  lines: SalesQuotationLine[];
  publicToken: string;
};

export function fetchSalesQuotations() {
  return apiFetch<SalesQuotation[]>("/sales/quotations");
}

export function fetchSalesQuotation(id: string) {
  return apiFetch<SalesQuotationDetail>(`/sales/quotations/${id}`);
}

export function createSalesQuotation(data: {
  contactId: string;
  dealId?: string;
  validUntil?: string;
  discount?: number;
  notes?: string;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    currencyId?: string;
    unitPriceFx?: number;
    exchangeRateFx?: number;
  }>;
}) {
  return apiFetch<SalesQuotationDetail>("/sales/quotations", { method: "POST", body: JSON.stringify(data) });
}

export function updateSalesQuotation(
  id: string,
  data: Partial<{
    contactId: string;
    dealId: string;
    validUntil: string | null;
    discount: number;
    notes: string;
    lines: Array<{
      productId?: string;
      description: string;
      quantity: number;
      unitPrice: number;
      currencyId?: string;
      unitPriceFx?: number;
      exchangeRateFx?: number;
    }>;
  }>,
) {
  return apiFetch<SalesQuotationDetail>(`/sales/quotations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function sendSalesQuotation(id: string) {
  return apiFetch<SalesQuotationDetail>(`/sales/quotations/${id}/send`, { method: "POST" });
}

export function acceptSalesQuotation(id: string) {
  return apiFetch<SalesQuotationDetail>(`/sales/quotations/${id}/accept`, { method: "POST" });
}

export function rejectSalesQuotation(id: string) {
  return apiFetch<SalesQuotationDetail>(`/sales/quotations/${id}/reject`, { method: "POST" });
}

export function convertSalesQuotation(id: string) {
  return apiFetch<SalesInvoiceDetail>(`/sales/quotations/${id}/convert`, { method: "POST" });
}

export function deleteSalesQuotation(id: string) {
  return apiFetch<{ success: boolean }>(`/sales/quotations/${id}`, { method: "DELETE" });
}

// ── لینک عمومی پیش‌فاکتور (بدون نیاز به ورود، برای مشتری) ───────────────

export type PublicQuotation = {
  orgName: string;
  quotationNo: number;
  status: SalesQuotationStatus;
  issuedAt: string;
  validUntil: string | null;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
  contact: { name: string; company: string | null };
  lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  acceptedByName: string | null;
};

/** No auth token involved — this runs on the customer's own device, reached via a shared link. */
async function publicFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message?.toString() ?? "خطایی رخ داد", res.status);
  }
  return res.json();
}

export function fetchPublicQuotation(slug: string, token: string) {
  return publicFetch<PublicQuotation>(`/public/tenants/${slug}/quotations/${token}`);
}

export function acceptPublicQuotation(slug: string, token: string, data: { name: string; signatureDataUrl: string }) {
  return publicFetch<{ success: boolean }>(`/public/tenants/${slug}/quotations/${token}/accept`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── پرداخت آنلاین فاکتور (Zarinpal) ───────────────────────────────────────

export type PublicInvoice = {
  id: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  dueAt: string;
  tenantName: string;
  gatewayAvailable: boolean;
};

export function fetchPublicInvoice(id: string) {
  return publicFetch<PublicInvoice>(`/public/invoices/${id}`);
}

export function payPublicInvoice(id: string) {
  return publicFetch<{ paymentUrl?: string; error?: string }>(`/public/invoices/${id}/pay`, { method: "POST" });
}

// ── فاکتور تکرارشونده (Recurring Invoice) ────────────────────────────────

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export type RecurringInvoiceLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  product: { id: string; name: string; sku: string } | null;
};

export type RecurringInvoiceTemplate = {
  id: string;
  contactId: string;
  dealId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  nextRunAt: string;
  isActive: boolean;
  discount: number;
  isOfficial: boolean;
  taxRate: number | null;
  notes: string | null;
  lastRunAt: string | null;
  lastGeneratedInvoiceId: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null };
};

export type RecurringInvoiceDetail = RecurringInvoiceTemplate & {
  deal: { id: string; title: string } | null;
  lines: RecurringInvoiceLine[];
};

export function fetchRecurringInvoices() {
  return apiFetch<RecurringInvoiceTemplate[]>("/sales/recurring-invoices");
}

export function fetchRecurringInvoice(id: string) {
  return apiFetch<RecurringInvoiceDetail>(`/sales/recurring-invoices/${id}`);
}

export function createRecurringInvoice(data: {
  contactId: string;
  dealId?: string;
  frequency: RecurrenceFrequency;
  intervalCount?: number;
  nextRunAt: string;
  discount?: number;
  isOfficial?: boolean;
  taxRate?: number;
  notes?: string;
  lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number }>;
}) {
  return apiFetch<RecurringInvoiceDetail>("/sales/recurring-invoices", { method: "POST", body: JSON.stringify(data) });
}

export function updateRecurringInvoice(
  id: string,
  data: Partial<{
    contactId: string;
    dealId: string;
    frequency: RecurrenceFrequency;
    intervalCount: number;
    nextRunAt: string;
    isActive: boolean;
    discount: number;
    isOfficial: boolean;
    taxRate: number;
    notes: string;
    lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number }>;
  }>,
) {
  return apiFetch<RecurringInvoiceDetail>(`/sales/recurring-invoices/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteRecurringInvoice(id: string) {
  return apiFetch<{ success: boolean }>(`/sales/recurring-invoices/${id}`, { method: "DELETE" });
}

// ── مرجوعی فروش (Sales Return) ──────────────────────────────────────────

export type SalesReturnLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  product: { id: string; name: string; sku: string } | null;
};

export type SalesReturn = {
  id: string;
  returnNo: number;
  reason: string | null;
  subtotal: number;
  total: number;
  notes: string | null;
  createdAt: string;
  invoice: { id: string; invoiceNo: number; contact: { id: string; name: string; company: string | null } };
};

export type SalesReturnDetail = Omit<SalesReturn, "invoice"> & {
  invoice: { id: string; invoiceNo: number; contactId: string };
  lines: SalesReturnLine[];
};

export function fetchSalesReturns() {
  return apiFetch<SalesReturn[]>("/sales/returns");
}

export function fetchSalesReturn(id: string) {
  return apiFetch<SalesReturnDetail>(`/sales/returns/${id}`);
}

export function createSalesReturn(data: {
  invoiceId: string;
  reason?: string;
  notes?: string;
  lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number }>;
}) {
  return apiFetch<SalesReturnDetail>("/sales/returns", { method: "POST", body: JSON.stringify(data) });
}

// ── Purchasing: تأمین‌کننده → سفارش خرید → رسید انبار → سند بدهی ────────

export type Supplier = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
};

export function fetchSuppliers(q?: string) {
  return apiFetch<Supplier[]>(`/purchasing/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function createSupplier(data: { name: string; company?: string; phone?: string; email?: string; address?: string }) {
  return apiFetch<Supplier>("/purchasing/suppliers", { method: "POST", body: JSON.stringify(data) });
}

export function fetchSupplier(id: string) {
  return apiFetch<Supplier>(`/purchasing/suppliers/${id}`);
}

export function updateSupplier(
  id: string,
  data: Partial<{ name: string; company: string; phone: string; email: string; address: string }>,
) {
  return apiFetch<Supplier>(`/purchasing/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteSupplier(id: string) {
  return apiFetch<{ success: boolean }>(`/purchasing/suppliers/${id}`, { method: "DELETE" });
}

export type PurchaseOrderStatus = "DRAFT" | "RECEIVED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type ApprovalStatus = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";

export type PurchaseOrderLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  product: { id: string; name: string; sku: string } | null;
  currencyId: string | null;
  unitCostFx: string | null;
  exchangeRateFx: string | null;
  currency?: { code: string; symbol: string | null } | null;
};

export type PurchasePayment = {
  id: string;
  amount: number;
  method: SalesPaymentMethod;
  paidAt: string;
  note: string | null;
};

export type PurchaseOrder = {
  id: string;
  orderNo: number;
  status: PurchaseOrderStatus;
  issuedAt: string;
  expectedAt: string | null;
  subtotal: number;
  total: number;
  paidAmount: number;
  notes: string | null;
  createdAt: string;
  receivedAt: string | null;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  rejectionReason: string | null;
  supplier: { id: string; name: string; company: string | null };
};

export type PurchaseOrderDetail = PurchaseOrder & {
  supplier: { id: string; name: string; company: string | null; phone: string | null; email: string | null };
  lines: PurchaseOrderLine[];
  payments: PurchasePayment[];
};

export function fetchPurchaseOrders() {
  return apiFetch<PurchaseOrder[]>("/purchasing/orders");
}

export function fetchPurchaseOrder(id: string) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}`);
}

export function createPurchaseOrder(data: {
  supplierId: string;
  expectedAt?: string;
  notes?: string;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitCost: number;
    currencyId?: string;
    unitCostFx?: number;
    exchangeRateFx?: number;
  }>;
}) {
  return apiFetch<PurchaseOrderDetail>("/purchasing/orders", { method: "POST", body: JSON.stringify(data) });
}

export function receivePurchaseOrder(id: string) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}/receive`, { method: "POST" });
}

export function approvePurchaseOrder(id: string) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}/approve`, { method: "POST" });
}

export function rejectPurchaseOrder(id: string, reason?: string) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function fetchPurchaseApprovalThreshold() {
  return apiFetch<{ threshold: number | null }>("/purchasing/orders/settings/approval-threshold");
}

export function setPurchaseApprovalThreshold(threshold: number | null) {
  return apiFetch<{ threshold: number | null }>("/purchasing/orders/settings/approval-threshold", {
    method: "PUT",
    body: JSON.stringify({ threshold }),
  });
}

export function recordPurchasePayment(
  id: string,
  data: {
    amount: number;
    method?: SalesPaymentMethod;
    note?: string;
    checkSayadId?: string;
    checkDueDate?: string;
    checkBankName?: string;
  },
) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}/payments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── مرجوعی خرید (Purchase Return) ───────────────────────────────────────

export type PurchaseReturnLine = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  product: { id: string; name: string; sku: string } | null;
};

export type PurchaseReturn = {
  id: string;
  returnNo: number;
  reason: string | null;
  subtotal: number;
  total: number;
  notes: string | null;
  createdAt: string;
  order: { id: string; orderNo: number; supplier: { id: string; name: string; company: string | null } };
};

export type PurchaseReturnDetail = Omit<PurchaseReturn, "order"> & {
  order: { id: string; orderNo: number; supplierId: string };
  lines: PurchaseReturnLine[];
};

export function fetchPurchaseReturns() {
  return apiFetch<PurchaseReturn[]>("/purchasing/returns");
}

export function fetchPurchaseReturn(id: string) {
  return apiFetch<PurchaseReturnDetail>(`/purchasing/returns/${id}`);
}

export function createPurchaseReturn(data: {
  orderId: string;
  reason?: string;
  notes?: string;
  lines: Array<{ productId?: string; description: string; quantity: number; unitCost: number }>;
}) {
  return apiFetch<PurchaseReturnDetail>("/purchasing/returns", { method: "POST", body: JSON.stringify(data) });
}

// ── چک‌ها: دریافتی و صادرشده، با یادآوری خودکار پیش از سررسید ──────────

export type CheckDirection = "RECEIVED" | "ISSUED";
export type CheckStatus = "PENDING" | "DEPOSITED" | "CLEARED" | "BOUNCED" | "CANCELLED" | "ENDORSED";

export type Check = {
  id: string;
  direction: CheckDirection;
  sayadId: string;
  amount: number;
  dueDate: string;
  bankName: string | null;
  status: CheckStatus;
  reminderDaysBefore: number;
  reminderSentAt: string | null;
  clearedAt: string | null;
  endorsedAt: string | null;
  note: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; phone: string | null } | null;
  endorsedToContact: { id: string; name: string; company: string | null } | null;
  invoice: { id: string; invoiceNo: number } | null;
  purchaseOrder: { id: string; orderNo: number } | null;
};

export function fetchChecks(filters?: { direction?: CheckDirection; status?: CheckStatus; dueSoonDays?: number }) {
  const params = new URLSearchParams();
  if (filters?.direction) params.set("direction", filters.direction);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dueSoonDays != null) params.set("dueSoonDays", String(filters.dueSoonDays));
  const qs = params.toString();
  return apiFetch<Check[]>(`/checks${qs ? `?${qs}` : ""}`);
}

export function fetchCheck(id: string) {
  return apiFetch<Check>(`/checks/${id}`);
}

export function createCheck(data: {
  direction: CheckDirection;
  sayadId: string;
  amount: number;
  dueDate: string;
  bankName?: string;
  contactId?: string;
  supplierId?: string;
  reminderDaysBefore?: number;
  note?: string;
}) {
  return apiFetch<Check>("/checks", { method: "POST", body: JSON.stringify(data) });
}

export function markCheckDeposited(id: string) {
  return apiFetch<Check>(`/checks/${id}/deposit`, { method: "POST" });
}

export function markCheckCleared(id: string) {
  return apiFetch<Check>(`/checks/${id}/clear`, { method: "POST" });
}

export function markCheckBounced(id: string) {
  return apiFetch<Check>(`/checks/${id}/bounce`, { method: "POST" });
}

export function cancelCheck(id: string) {
  return apiFetch<Check>(`/checks/${id}/cancel`, { method: "POST" });
}

export function endorseCheck(id: string, toContactId: string) {
  return apiFetch<Check>(`/checks/${id}/endorse`, { method: "POST", body: JSON.stringify({ toContactId }) });
}

export function updateCheckReminderDays(id: string, reminderDaysBefore: number) {
  return apiFetch<Check>(`/checks/${id}/reminder-days`, {
    method: "PUT",
    body: JSON.stringify({ reminderDaysBefore }),
  });
}

export function fetchCheckReminderChannels() {
  return apiFetch<{ sms: boolean; notification: boolean }>("/checks/settings/reminder-channels");
}

export function setCheckReminderChannels(data: { sms?: boolean; notification?: boolean }) {
  return apiFetch<{ sms: boolean; notification: boolean }>("/checks/settings/reminder-channels", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── پیوست فایل عمومی ─────────────────────────────────────────────────────

export type Attachment = {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  fileUrl: string;
  createdAt: string;
  createdBy: { name: string } | null;
};

export function fetchAttachments(entityType: string, entityId: string) {
  return apiFetch<Attachment[]>(`/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
}

export function createAttachment(data: { entityType: string; entityId: string; title: string; fileUrl: string }) {
  return apiFetch<Attachment>("/attachments", { method: "POST", body: JSON.stringify(data) });
}

export function deleteAttachment(id: string) {
  return apiFetch<{ success: boolean }>(`/attachments/${id}`, { method: "DELETE" });
}

// ── اتوماسیون (Automation) ──────────────────────────────────────────────

export type PayloadFieldType = "STRING" | "NUMBER" | "USER_ID" | "PHONE";

export type TriggerPayloadField = {
  key: string;
  label: string;
  type: PayloadFieldType;
};

export type TriggerDefinition = {
  code: string;
  moduleCode: string;
  label: string;
  description: string | null;
  payloadFields: TriggerPayloadField[];
  supportsManualTrigger: boolean;
};

export function fetchTriggers() {
  return apiFetch<TriggerDefinition[]>("/automation/triggers");
}

export type AutomationActionType = "NOTIFY_IN_APP" | "SEND_SMS" | "CREATE_TASK";

export type AutomationAction = {
  id: string;
  type: AutomationActionType;
  config: Record<string, unknown>;
  sequenceOrder: number;
};

export type AutomationRunLog = {
  id: string;
  actionType: string;
  status: "SUCCESS" | "FAILED";
  error: string | null;
  ranAt: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  triggerCode: string;
  isActive: boolean;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  actions: AutomationAction[];
  runLogs: AutomationRunLog[];
};

export function fetchAutomationRules() {
  return apiFetch<AutomationRule[]>("/automation/rules");
}

export function fetchAutomationRule(id: string) {
  return apiFetch<AutomationRule>(`/automation/rules/${id}`);
}

export function createAutomationRule(data: {
  name: string;
  triggerCode: string;
  actions: Array<{ type: AutomationActionType; config: Record<string, unknown>; sequenceOrder?: number }>;
}) {
  return apiFetch<AutomationRule>("/automation/rules", { method: "POST", body: JSON.stringify(data) });
}

export function updateAutomationRule(id: string, data: { name?: string; isActive?: boolean }) {
  return apiFetch<AutomationRule>(`/automation/rules/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteAutomationRule(id: string) {
  return apiFetch<{ success: boolean }>(`/automation/rules/${id}`, { method: "DELETE" });
}

export function fireTrigger(triggerCode: string, entityId: string) {
  return apiFetch<{ success: boolean }>("/automation/fire", { method: "POST", body: JSON.stringify({ triggerCode, entityId }) });
}

// ── VoIP ─────────────────────────────────────────────────────────────────

export type VoipProvider = {
  code: string;
  name: string;
  configFields: Array<{ key: string; label: string }>;
  supportsOriginate: boolean;
};

export type VoipConfig = { providerCode: string; config: Record<string, unknown>; webhookSecret: string } | null;

export type VoipExtension = { id: string; extension: string; user: { id: string; name: string } };

export function fetchVoipProviders() {
  return apiFetch<VoipProvider[]>("/voip/providers");
}

export function fetchVoipConfig() {
  return apiFetch<VoipConfig>("/voip/config");
}

export function saveVoipConfig(data: { providerCode: string; config: Record<string, unknown> }) {
  return apiFetch<VoipConfig>("/voip/config", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchVoipExtensions() {
  return apiFetch<VoipExtension[]>("/voip/extensions");
}

export function saveMyVoipExtension(extension: string) {
  return apiFetch<VoipExtension>("/voip/extensions/me", { method: "PUT", body: JSON.stringify({ extension }) });
}

export function originateCall(toNumber: string, contactId?: string) {
  return apiFetch<{ success: boolean }>("/voip/originate", { method: "POST", body: JSON.stringify({ toNumber, contactId }) });
}

// ── درخواست‌های دستیار هوشمند (AI Actions) ──────────────────────────────

export type AiActionStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";

export type AiActionRequest = {
  id: string;
  toolName: string;
  operationType: "CREATE" | "UPDATE" | "DELETE";
  summary: string;
  status: AiActionStatus;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; name: string } | null;
};

export function fetchAiActions() {
  return apiFetch<AiActionRequest[]>("/ai-actions");
}

export function approveAiAction(id: string) {
  return apiFetch<{ success: boolean; result: unknown }>(`/ai-actions/${id}/approve`, { method: "POST" });
}

export function rejectAiAction(id: string) {
  return apiFetch<{ success: boolean }>(`/ai-actions/${id}/reject`, { method: "POST" });
}
