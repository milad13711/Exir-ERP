// Client components run in the browser and use the relative NEXT_PUBLIC_API_URL
// (baked in as "/api" — see apps/web-panel/Dockerfile — proxied same-origin by
// nginx). Server components (the public /shop storefront's generateMetadata
// and initial render, added for online-store) run inside this container and a
// relative path has no meaning to server-side fetch(); they need the backend's
// internal Docker-network address instead — same fix already proven on the
// marketing site (see apps/marketing-site/src/lib/api.ts) for the identical
// hairpin-NAT limitation.
export const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api");
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
      cache: "no-store",
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
    // ۴۰۲ یعنی تننت PENDING_PAYMENT است — نه توکن بی‌اعتبار. کاربر را از
    // حساب خارج نمی‌کنیم، به صفحه‌ی صورت‌حساب/فاکتور می‌فرستیم (safety-net
    // برای مواقعی که کاربر مستقیم به یک صفحه‌ی دیگر panel navigate کرده).
    if (res.status === 402 && typeof window !== "undefined" && !window.location.pathname.startsWith("/billing-locked")) {
      window.location.href = "/billing-locked";
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export function requestOtp(phone: string) {
  return apiFetch<{ expiresInSeconds: number; codeLength?: number; devCode?: string }>("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export type VerifyOtpResult =
  | {
      accessToken: string;
      user: { name: string | null; phone: string };
      tenant: { name: string; slug: string };
      role: string;
      /** تننت روی PENDING_PAYMENT است — ورود مجاز است اما فرانت باید مستقیم به /billing-locked ببرد. */
      billingLocked?: boolean;
      outstandingInvoiceId?: string | null;
    }
  | { requiresTenantSelection: true; verificationToken: string; tenants: TenantCard[] }
  /** کاربر 2FA (TOTP) فعال کرده: گام دوم با verifyTotpLogin. */
  | { requiresTotp: true; totpToken: string };

export type LoginSuccess = Extract<VerifyOtpResult, { accessToken: string }>;

export type TenantCard = {
  slug: string;
  name: string;
  logoUrl: string | null;
  startDate: string;
  expiresAt: string | null;
  pendingNotifications: number;
};

/**
 * tenantSlug is deliberately NOT sent here — this box hosts public
 * self-signup, so the same phone can belong to more than one tenant, and
 * the build-time TENANT_SLUG constant would silently always resolve to
 * whichever tenant this deployment happened to be bootstrapped for. The
 * backend figures out the right tenant on its own: exactly one active
 * membership logs straight in, more than one comes back as
 * requiresTenantSelection for the caller to resolve via selectTenant().
 */
export function verifyOtp(phone: string, code: string) {
  return apiFetch<VerifyOtpResult>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function selectTenant(verificationToken: string, tenantSlug: string) {
  return apiFetch<LoginSuccess | { requiresTotp: true; totpToken: string }>("/auth/otp/select-tenant", {
    method: "POST",
    body: JSON.stringify({ verificationToken, tenantSlug }),
  });
}

/** گام دوم ورود با 2FA: کد ۶ رقمی برنامه‌ی احراز هویت یا کد بازیابی. */
export function verifyTotpLogin(totpToken: string, code: string) {
  return apiFetch<LoginSuccess>("/auth/otp/verify-totp", {
    method: "POST",
    body: JSON.stringify({ totpToken, code }),
  });
}

// ── 2FA اختیاری مالک/مدیر ────────────────────────────────────────────────
export const fetchTwoFaStatus = () => apiFetch<{ enabled: boolean; recoveryCodesLeft: number }>("/auth/2fa/status");
export const beginTwoFaSetup = () => apiFetch<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" });
export const enableTwoFa = (code: string) =>
  apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
export const disableTwoFa = (code: string) =>
  apiFetch<{ enabled: boolean }>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) });

// ── Public signup (unauthenticated — no existing tenant/membership yet) ───

export type IndustryBusinessCategory = "SERVICES" | "TRADE" | "PRODUCTION";

export type PublicIndustryTemplate = {
  code: string;
  name: string;
  description: string | null;
  businessCategory: IndustryBusinessCategory | null;
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
  extraModuleCodes?: string[];
  resellerCode?: string;
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
  user: {
    name: string | null;
    phone: string;
    email: string | null;
    avatarUrl: string | null;
    roleTitle: string | null;
    membershipRole: string;
  };
  tenant: { name: string; slug: string; publicKey?: string; themeColor: string | null };
  navOrder: string[];
  permissions?: { manager: boolean; modules: Record<string, { canViewAll: boolean; canViewOwn: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> };
};

export function fetchMe() {
  return apiFetch<Me>("/me");
}

export function updateNavOrder(order: string[]) {
  return apiFetch<{ navOrder: string[] }>("/me/nav-order", { method: "PATCH", body: JSON.stringify({ order }) });
}

export function updateBranding(data: { themeColor?: string }) {
  return apiFetch<{ themeColor: string | null }>("/me/branding", { method: "PATCH", body: JSON.stringify(data) });
}

export function updateMyProfile(data: { name?: string; email?: string | null; avatarUrl?: string | null }) {
  return apiFetch<{ name: string | null; email: string | null; avatarUrl: string | null }>("/me/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type MyTenant = { slug: string; name: string };

export function fetchMyTenants() {
  return apiFetch<MyTenant[]>("/me/tenants");
}

export function switchTenant(tenantSlug: string) {
  return apiFetch<{
    accessToken: string;
    user: { name: string | null; phone: string };
    tenant: { name: string; slug: string };
    role: string;
  }>("/me/switch-tenant", { method: "POST", body: JSON.stringify({ tenantSlug }) });
}

// ── Onboarding (گیمیفیکیشن شروع کار) ────────────────────────────────────

export type OnboardingMission = {
  code: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  completed: boolean;
};

export type OnboardingStatus = {
  dismissed: boolean;
  missions: OnboardingMission[];
};

export function fetchOnboardingStatus() {
  return apiFetch<OnboardingStatus>("/onboarding/status");
}

export function dismissOnboarding() {
  return apiFetch<{ success: boolean }>("/onboarding/dismiss", { method: "POST" });
}

// ── Billing ──────────────────────────────────────────────────────────────

export type Subscription = {
  planName: string;
  planCode: string;
  status: string;
  daysLeft: number;
  hoursLeft: number;
  currentPeriodEnd: string;
  autoRenew: boolean;
  lifetime?: boolean;
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
  purpose: "TENANT_SETUP" | "PLAN_RENEWAL" | "MODULE_PURCHASE" | "MODULE_RENEWAL" | "SMS_PACKAGE" | null;
  items: { moduleCode: string; moduleName: string; billingMode: string; amount: number }[] | null;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
};

export function fetchInvoices() {
  return apiFetch<Invoice[]>("/billing/invoices");
}

// ── Module marketplace ───────────────────────────────────────────────────

export type ModuleBillingMode = "MONTHLY" | "YEARLY" | "LICENSE";

export type ModuleCatalogItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  priceMonthly: number;
  priceYearly: number | null;
  isCore: boolean;
  version: string;
  dependsOn: string[];
  features: string[];
  installStatus: "INSTALLED" | "TRIAL" | "DISABLED" | null;
  billingMode: ModuleBillingMode | null;
  currentPeriodEnd: string | null;
  demoAvailable: boolean;
  demoDescription: string | null;
  demoValueProps: string[];
  demoScreenshot1Url: string | null;
  demoScreenshot2Url: string | null;
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

export function activateModuleDemo(code: string) {
  return apiFetch<ModuleCatalogItem>(`/modules/${code}/demo/activate`, { method: "POST" });
}

export function checkoutModules(items: { code: string; billingMode: ModuleBillingMode }[]) {
  return apiFetch<{ invoiceId: string }>("/modules/checkout", { method: "POST", body: JSON.stringify({ items }) });
}

export type ModuleRenewalNotice = {
  code: string;
  name: string;
  currentPeriodEnd: string;
  daysLeft: number | null;
  invoiceId: string | null;
};

export function fetchModuleRenewals() {
  return apiFetch<ModuleRenewalNotice[]>("/me/module-renewals");
}

// ── Users & roles ────────────────────────────────────────────────────────

export type TenantUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  roles: string[];
  roleIds: string[];
  membershipRole: "OWNER" | "ADMIN" | "MEMBER";
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

export function updateUser(
  id: string,
  data: { name?: string; email?: string | null; status?: TenantUser["status"]; roleIds?: string[] },
) {
  return apiFetch<TenantUser>(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function fetchUserPermissionOverrides(id: string) {
  return apiFetch<ModulePermissionEntry[]>(`/users/${id}/permissions`);
}

/** دسترسی‌های دستیِ کاربر را کاملاً جایگزین می‌کند؛ ماژولی که در entries نباشد از نقش ارث‌بری می‌کند. */
export function saveUserPermissionOverrides(id: string, entries: ModulePermissionEntry[]) {
  return apiFetch<ModulePermissionEntry[]>(`/users/${id}/permissions`, { method: "PUT", body: JSON.stringify({ entries: toPermissionPayload(entries) }) });
}

export function deleteUser(id: string) {
  return apiFetch<{ success: boolean; pendingApproval: boolean }>(`/users/${id}`, { method: "DELETE" });
}

export function setUserManagementRole(id: string, data: { role: "OWNER" | "ADMIN" | "MEMBER"; transfer?: boolean }) {
  return apiFetch<{ success: boolean }>(`/users/${id}/management-role`, { method: "PUT", body: JSON.stringify(data) });
}

export type ModuleApprover = { moduleCode: string; userId: string; user: { id: string; name: string } };

export function fetchModuleApprovers() {
  return apiFetch<ModuleApprover[]>("/approvals/module-approvers");
}

export function setModuleApprover(moduleCode: string, userId: string | null) {
  return apiFetch<{ moduleCode: string; userId: string | null }>(`/approvals/module-approvers/${moduleCode}`, {
    method: "PUT",
    body: JSON.stringify({ userId }),
  });
}

// ── Automated send scheduling (Settings → زمان‌بندی ارسال خودکار) ──────

export type ScheduleOffsetUnit = "DAYS_BEFORE" | "SAME_DAY" | "DAYS_AFTER";

export type JobScheduleConfig = { offsetDays: number; unit: ScheduleOffsetUnit; hour: number; minute: number };

export type SchedulableJob = {
  code: string;
  label: string;
  moduleCode: string;
  defaultConfig: JobScheduleConfig;
  allowedOffsets: JobScheduleConfig[];
  behaviorWired: boolean;
  config: JobScheduleConfig;
};

export function fetchSchedulableJobs() {
  return apiFetch<SchedulableJob[]>("/scheduling/jobs");
}

export function updateSchedulableJob(code: string, config: JobScheduleConfig) {
  return apiFetch<JobScheduleConfig>(`/scheduling/jobs/${code}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

// ── Access matrix (per role, per module) ───────────────────────────────

/**
 * کد ماژول‌هایی که بک‌اند واقعاً با PermissionsService روی ماتریس نقش گیت می‌کند
 * (assertView/assertCreate/...). ماتریس دسترسی فقط همین‌ها را — به‌شرط نصب‌بودن
 * برای تننت — نشان می‌دهد؛ برچسب هر کدام از کاتالوگ ماژول‌ها خوانده می‌شود، پس
 * ماژول تازه‌نصب‌شده خودکار در ماتریس ظاهر می‌شود. ماژول جدیدی که گیت دسترسی
 * می‌گیرد باید اینجا هم اضافه شود.
 */
export const PERMISSION_GATED_MODULE_CODES = [
  "crm",
  "sales",
  "accounting",
  "warehouse",
  "purchasing",
  "hr",
  "recruitment",
  "tasks",
  "daily-checklist",
  "projects",
  "contracts",
  "booking",
  "production",
  "quality-control",
  "ration-lab",
  "mentoring",
  "events",
  "forms",
  "fleet",
  "warranty",
  "after-sales-service",
  "online-store",
  "marketing",
  "referral-marketing",
  "qr-code",
  "automation",
  "reports",
  "logs",
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

/** فقط فیلدهای مجاز DTO — ردیف‌های خوانده‌شده از سرور فیلدهای اضافه (roleId/userId) دارند که ValidationPipe رد می‌کند. */
function toPermissionPayload(entries: ModulePermissionEntry[]): ModulePermissionEntry[] {
  return entries.map((e) => ({
    moduleCode: e.moduleCode,
    canViewAll: e.canViewAll,
    canViewOwn: e.canViewOwn,
    canCreate: e.canCreate,
    canEdit: e.canEdit,
    canDelete: e.canDelete,
  }));
}

export function updateRolePermissions(roleId: string, entries: ModulePermissionEntry[]) {
  return apiFetch<ModulePermissionEntry[]>(`/roles/${roleId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ entries: toPermissionPayload(entries) }),
  });
}

export function createRole(name: string) {
  return apiFetch<TenantRoleWithPermissions>("/roles", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteRole(roleId: string) {
  return apiFetch<{ success: boolean }>(`/roles/${roleId}`, { method: "DELETE" });
}

// ── Tasks ────────────────────────────────────────────────────────────────

export type ApiTaskChecklistItem = { id: string; taskId: string; text: string; done: boolean; order: number };

export type ApiTask = {
  id: string;
  title: string;
  description?: string | null;
  checklist?: ApiTaskChecklistItem[];
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
  description?: string;
  checklist?: string[];
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
  data: Partial<{
    title: string;
    description: string | null;
    priority: ApiTask["priority"];
    dueAt: string | null;
    assignedUserId: string;
  }>,
) {
  return apiFetch<ApiTask>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function fetchTask(id: string) {
  return apiFetch<ApiTask>(`/tasks/${id}`);
}

export function addTaskChecklistItem(taskId: string, text: string) {
  return apiFetch<ApiTaskChecklistItem>(`/tasks/${taskId}/checklist`, { method: "POST", body: JSON.stringify({ text }) });
}

export function updateTaskChecklistItem(taskId: string, itemId: string, data: { text?: string; done?: boolean }) {
  return apiFetch<ApiTaskChecklistItem>(`/tasks/${taskId}/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteTaskChecklistItem(taskId: string, itemId: string) {
  return apiFetch<{ success: boolean }>(`/tasks/${taskId}/checklist/${itemId}`, { method: "DELETE" });
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
  /** فاکتورهای نزدیک به سررسید (۷ روز آینده) و معوق — daysDiff منفی یعنی معوق، مثبت یعنی روز مانده تا سررسید. */
  dueOrOverdueInvoices: Array<{
    id: string;
    invoiceNo: number;
    total: number;
    paidAmount: number;
    dueAt: string;
    daysDiff: number;
    contact: { id: string; name: string; company: string | null; phone: string | null };
  }>;
};

export function fetchDashboardSummary() {
  return apiFetch<DashboardSummary>("/dashboard/summary");
}

// ── ویجت داشبورد: تقویم ماهانه‌ی رویدادها ────────────────────────────────

export type DashboardCalendarEventType =
  | "birthday-employee"
  | "birthday-contact"
  | "task"
  | "interview"
  | "mentoring-session"
  | "invoice-due"
  | "check-due"
  | "contract-end"
  | "reminder";

export type DashboardCalendarEvent = {
  id: string;
  type: DashboardCalendarEventType;
  title: string;
  link: string | null;
};

export type DashboardCalendarDay = {
  day: number;
  isFriday: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  hasBirthday: boolean;
  events: DashboardCalendarEvent[];
};

export type DashboardCalendarMonth = {
  year: number;
  month: number;
  monthLength: number;
  days: DashboardCalendarDay[];
};

export function fetchDashboardCalendar(jalaliYear: number, jalaliMonth: number) {
  return apiFetch<DashboardCalendarMonth>(`/dashboard/calendar?year=${jalaliYear}&month=${jalaliMonth}`);
}

export function createDashboardReminder(data: { date: string; title: string; note?: string }) {
  return apiFetch<{ id: string }>("/dashboard/reminders", { method: "POST", body: JSON.stringify(data) });
}

export function deleteDashboardReminder(id: string) {
  return apiFetch<{ ok: boolean }>(`/dashboard/reminders/${id}`, { method: "DELETE" });
}

// ── ویجت داشبورد: فاکتورهای نزدیک به سررسید و معوق ──────────────────────

export function sendOverdueInvoiceReminderSms(invoiceId: string) {
  return apiFetch<{ success: boolean; error?: string }>(`/dashboard/overdue-invoices/${invoiceId}/remind-sms`, { method: "POST" });
}

export type InvoiceFollowUp = {
  id: string;
  invoiceId: string;
  note: string;
  outcome: string | null;
  createdAt: string;
  followedUpBy: { name: string } | null;
};

export function createInvoiceFollowUp(invoiceId: string, data: { note: string; outcome?: string }) {
  return apiFetch<InvoiceFollowUp>(`/dashboard/overdue-invoices/${invoiceId}/follow-up`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchInvoiceFollowUps(invoiceId: string) {
  return apiFetch<InvoiceFollowUp[]>(`/dashboard/overdue-invoices/${invoiceId}/follow-ups`);
}

// ── Logs (Settings → لاگ فعالیت‌ها و خطاها) ─────────────────────────────

export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export type ActivityLogEntry = ActivityEntry & {
  entityId: string | null;
  metadata: unknown;
  actorType?: "MANUAL" | "AUTOMATIC" | "SYSTEM";
  moduleCode?: string;
  actionType?: string | null;
  summary?: string | null;
  userId?: string | null;
  ip?: string | null;
};

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
  actorType?: string;
  actionType?: string;
  q?: string;
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

export function fetchActivityUsers() {
  return apiFetch<{ id: string; name: string }[]>("/logs/activity/users");
}

export type ActivityDailySummary = {
  date: string;
  people: {
    userId: string;
    userName: string;
    total: number;
    manual: number;
    automatic: number;
    firstAt: string | null;
    lastAt: string | null;
    modules: Record<string, number>;
    moduleLabels: Record<string, string>;
    actions: Record<string, number>;
  }[];
};

export function fetchActivityDailySummary(date: string, userId?: string) {
  const qs = new URLSearchParams({ date });
  if (userId) qs.set("userId", userId);
  return apiFetch<ActivityDailySummary>(`/logs/activity/daily-summary?${qs.toString()}`);
}

export type DailyReportSubmissionRow = {
  userId: string;
  userName: string;
  date: string;
  dateFa: string;
  submitted: boolean;
  submittedAt: string | null;
  submittedTimeFa: string | null;
  mode: "MANUAL" | "AUTO" | null;
  status: "ON_TIME" | "LATE" | "MISSING" | "PENDING";
  itemsTotal: number;
  itemsDone: number;
};

export type DailyReportSubmissionSummary = {
  userId: string;
  userName: string;
  days: number;
  onTime: number;
  late: number;
  missing: number;
  pending: number;
  manual: number;
  auto: number;
  avgManualMinutes: number | null;
};

export type DailyReportSubmissions = {
  range: { from: string; to: string };
  cutoff: { hour: number; minute: number };
  rows: DailyReportSubmissionRow[];
  summary: DailyReportSubmissionSummary[];
};

export function fetchDailyReportSubmissions(params: { from?: string; to?: string; userId?: string }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return apiFetch<DailyReportSubmissions>(`/logs/daily-reports?${qs.toString()}`);
}

export function updateDailyReportCutoff(time: string) {
  return apiFetch<{ cutoff: { hour: number; minute: number } }>("/logs/daily-reports/settings", { method: "PUT", body: JSON.stringify({ time }) });
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
  /** فقط برای مالک یا کاربری که مالک دسترسی مهر/امضا را به او ارجاع داده مقدار دارد — برای بقیه همیشه null است. */
  signatureImage: string | null;
  stampImage: string | null;
  /** true فقط برای مالک — یعنی همین کاربر می‌تواند خودِ تصویر مهر/امضا را تغییر دهد. */
  canManageStamp: boolean;
};

export function fetchGeneralSettings() {
  return apiFetch<GeneralSettings>("/settings/general");
}

export function updateGeneralSettings(data: Partial<GeneralSettings>) {
  return apiFetch<GeneralSettings>("/settings/general", { method: "PUT", body: JSON.stringify(data) });
}

/** فقط مالک — تغییر خودِ تصویر مهر/امضای رسمی شرکت. */
export function updateCompanyStamp(data: { signatureImage?: string | null; stampImage?: string | null }) {
  return apiFetch<{ signatureImage?: string; stampImage?: string }>("/settings/general/stamp", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export type StampDelegate = { delegateUserId: string | null; users: { id: string; name: string | null }[] };

/** فقط مالک — کاربری که اجازه دارد به‌جای او از طرف شرکت اسناد رسمی را امضا کند. */
export function fetchStampDelegate() {
  return apiFetch<StampDelegate>("/me/stamp-delegate");
}

export function saveStampDelegate(userId: string | null) {
  return apiFetch<{ delegateUserId: string | null }>("/me/stamp-delegate", { method: "PUT", body: JSON.stringify({ userId }) });
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

export type NotificationPreferences = { emailEnabled: boolean; smsEnabled: boolean; soundEnabled: boolean };

export function fetchNotificationPreferences() {
  return apiFetch<NotificationPreferences>("/notifications/preferences");
}

export function updateNotificationPreferences(data: Partial<NotificationPreferences>) {
  return apiFetch<NotificationPreferences>("/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function fetchPushVapidKey() {
  return apiFetch<{ publicKey: string | null; configured: boolean }>("/notifications/push/vapid-public-key");
}

export function subscribePush(data: { endpoint: string; p256dh: string; auth: string }) {
  return apiFetch<{ success: boolean }>("/notifications/push/subscribe", { method: "POST", body: JSON.stringify(data) });
}

export function unsubscribePush(endpoint: string) {
  return apiFetch<{ success: boolean }>(`/notifications/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
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
  birthDate: string | null;
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
  birthDate?: string;
  tags?: string[];
  source?: string;
  acquisitionCost?: number;
  referredById?: string;
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
    birthDate: string;
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

export function sendPartyStatementSms(id: string) {
  return apiFetch<{ success: boolean; error?: string }>(`/crm/contacts/${id}/statement/send-sms`, { method: "POST" });
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

export function updateAccount(
  id: string,
  data: Partial<{ code: string; name: string; type: AccountType; isCashAccount: boolean }>,
) {
  return apiFetch<Account>(`/accounting/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteAccount(id: string) {
  return apiFetch<{ success: boolean }>(`/accounting/accounts/${id}`, { method: "DELETE" });
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

// ── بدهکاران و بستانکاران ────────────────────────────────────────────────

export type PartyBalance = { id: string; name: string; company: string | null; phone: string | null; balance: number };

export type AccountingPartyStatement = {
  contact: { id: string; name: string; company: string | null; phone: string | null };
  lines: StatementLine[];
  arBalance: number;
  apBalance: number;
};

export function fetchReceivables() {
  return apiFetch<PartyBalance[]>("/accounting/parties/receivables");
}

export function fetchPayables() {
  return apiFetch<PartyBalance[]>("/accounting/parties/payables");
}

export function fetchAccountingPartyStatement(contactId: string) {
  return apiFetch<AccountingPartyStatement>(`/accounting/parties/${contactId}/statement`);
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

export function updateFixedAsset(
  id: string,
  data: Partial<{
    name: string;
    category: string;
    purchaseDate: string;
    purchaseCost: number;
    salvageValue: number;
    usefulLifeMonths: number;
    notes: string;
  }>,
) {
  return apiFetch<FixedAsset>(`/accounting/fixed-assets/${id}`, { method: "PUT", body: JSON.stringify(data) });
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
  voidedAt?: string | null;
  voidReason?: string | null;
  reversalOfId?: string | null;
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

// ── درگاه پرداخت ─────────────────────────────────────────────────────────

export type PaymentGatewayProvider = "ZARINPAL" | "BITPAY";

export type PaymentGatewaySettings = {
  activeProvider: PaymentGatewayProvider | null;
  zarinpal: { merchantId: string; hasMerchantId: boolean; sandbox: boolean };
  bitpay: { apiKey: string; hasApiKey: boolean; testMode: boolean };
};

export function fetchPaymentGatewaySettings() {
  return apiFetch<PaymentGatewaySettings>("/payment-gateway/settings");
}

export function savePaymentGatewaySettings(data: Partial<{
  activeProvider: PaymentGatewayProvider | null;
  zarinpalMerchantId: string;
  zarinpalSandbox: boolean;
  bitpayApiKey: string;
  bitpayTestMode: boolean;
}>) {
  return apiFetch<PaymentGatewaySettings>("/payment-gateway/settings", { method: "PUT", body: JSON.stringify(data) });
}

// ── Warehouse ────────────────────────────────────────────────────────────

export type StockMovementType = "RECEIPT" | "ISSUE" | "ADJUSTMENT";

export type SalePriceSource = "AUTO" | "MANUAL";

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
  profitMarginPercent: string | null;
  salePriceSource: SalePriceSource;
  salePriceUpdatedAt: string | null;
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

export type StockMovementRecord = {
  id: string;
  productId: string;
  warehouseId: string;
  type: string;
  quantityDelta: number;
  unitCost: number | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; unit: string };
  warehouse: { id: string; name: string };
  createdBy: { id: string; name: string } | null;
};

export function fetchStockMovements(filters: { type?: string; productId?: string; warehouseId?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<StockMovementRecord[]>(`/warehouse/movements${qs ? `?${qs}` : ""}`);
}

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
  profitMarginPercent?: number;
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
    profitMarginPercent: number; // ذخیره‌ی دوباره‌ی این فیلد = بازگشت salePriceSource به AUTO و بازمحاسبه‌ی قیمت فروش
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

// تنظیمات فروش → محاسبه خودکار قیمت فروش از درصد سود
export function fetchAutoSalePriceEnabled() {
  return apiFetch<{ enabled: boolean }>("/warehouse/settings/auto-sale-price");
}

export function updateAutoSalePriceEnabled(enabled: boolean) {
  return apiFetch<{ enabled: boolean }>("/warehouse/settings/auto-sale-price", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
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

// ── آزمایشگاه جیره (Ration Lab) ───────────────────────────────────────────

export type RationSampleStatus =
  | "COLLECTED"
  | "IN_TRANSIT"
  | "LAB_CONFIRMED"
  | "REPORT_SUBMITTED"
  | "SENT_TO_EXPERT"
  | "VIEWED_BY_FARMER";
export type RationLineKind = "CURRENT" | "PROPOSED";

export type RationFormulaLine = {
  id: string;
  kind: RationLineKind;
  ingredientName: string;
  quantityPerAnimalKg: string;
  unitCostSnapshot: number;
  lineCost: number;
};

export type RationLabReport = {
  id: string;
  reviewedByPhone: string;
  reviewedByName: string | null;
  currentRationIssues: string;
  riskIfUnchanged: string;
  newRecommendations: string;
  expectedResult: string;
  urgentWarningSigns: string;
  isKnowledge: boolean;
  submittedAt: string;
};

export type RationFollowUpCheckin = {
  id: string;
  dueOffsetDays: number;
  scheduledAt: string;
  completedAt: string | null;
  herdSize: number | null;
  totalHerdMilkYieldLiters: string | null;
  avgMilkYieldPerAnimalLiters: string | null;
  milkFatPercent: string | null;
  milkProteinPercent: string | null;
  notes: string | null;
};

export type RationSample = {
  id: string;
  sampleNo: number;
  collectedAt: string;
  herdSize: number | null;
  totalHerdMilkYieldLiters: string | null;
  avgMilkYieldPerAnimalLiters: string | null;
  milkFatPercent: string | null;
  milkProteinPercent: string | null;
  currentRationDescription: string | null;
  analysisFeeAmount: number;
  discountCode: string | null;
  discountPercent: number;
  finalFeeAmount: number;
  isIdentityVisibleToLab: boolean;
  status: RationSampleStatus;
  createdAt: string;
  contact: { id: string; name: string; phone: string | null };
  collectedBy: { id: string; name: string } | null;
  lines: RationFormulaLine[];
  labReport: RationLabReport | null;
  followUps: RationFollowUpCheckin[];
};

export function fetchRationSamples(status?: RationSampleStatus) {
  return apiFetch<RationSample[]>(`/ration-lab/samples${status ? `?status=${status}` : ""}`);
}

export function fetchRationSample(id: string) {
  return apiFetch<RationSample>(`/ration-lab/samples/${id}`);
}

export function createRationSample(data: {
  contactId: string;
  collectedAt: string;
  herdSize?: number;
  totalHerdMilkYieldLiters?: number;
  avgMilkYieldPerAnimalLiters?: number;
  milkFatPercent?: number;
  milkProteinPercent?: number;
  currentRationDescription?: string;
  currentLines?: { ingredientName: string; quantityPerAnimalKg: number; unitCostSnapshot: number }[];
  consentSignatureDataUrl: string;
  analysisFeeAmount?: number;
  discountCode?: string;
  isIdentityVisibleToLab?: boolean;
}) {
  return apiFetch<RationSample>("/ration-lab/samples", { method: "POST", body: JSON.stringify(data) });
}

export function rationSamplePdfUrl(id: string) {
  return `${API_URL}/ration-lab/samples/${id}/pdf`;
}

export function markRationSampleInTransit(id: string) {
  return apiFetch<RationSample>(`/ration-lab/samples/${id}/mark-in-transit`, { method: "POST" });
}

export function updateRationSample(
  id: string,
  data: Partial<{
    collectedAt: string;
    herdSize: number;
    totalHerdMilkYieldLiters: number;
    avgMilkYieldPerAnimalLiters: number;
    milkFatPercent: number;
    milkProteinPercent: number;
    currentRationDescription: string;
    currentLines: { ingredientName: string; quantityPerAnimalKg: number; unitCostSnapshot: number }[];
    analysisFeeAmount: number;
    discountCode: string;
  }>,
) {
  return apiFetch<RationSample>(`/ration-lab/samples/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteRationSample(id: string) {
  return apiFetch<{ success: boolean }>(`/ration-lab/samples/${id}`, { method: "DELETE" });
}

export type RationLabReviewer = { id: string; phone: string; name: string; isActive: boolean; createdAt: string };

export function fetchRationLabReviewers() {
  return apiFetch<RationLabReviewer[]>("/ration-lab/reviewers");
}

export function createRationLabReviewer(data: { phone: string; name: string }) {
  return apiFetch<RationLabReviewer>("/ration-lab/reviewers", { method: "POST", body: JSON.stringify(data) });
}

export function updateRationLabReviewer(id: string, data: { name?: string; isActive?: boolean }) {
  return apiFetch<RationLabReviewer>(`/ration-lab/reviewers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteRationLabReviewer(id: string) {
  return apiFetch<{ success: boolean }>(`/ration-lab/reviewers/${id}`, { method: "DELETE" });
}

export type RationDiscountCode = {
  id: string;
  code: string;
  percentOff: number;
  isActive: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: string;
};

export function fetchRationDiscountCodes() {
  return apiFetch<RationDiscountCode[]>("/ration-lab/discount-codes");
}

export function createRationDiscountCode(data: { code: string; percentOff: number; expiresAt?: string; maxRedemptions?: number }) {
  return apiFetch<RationDiscountCode>("/ration-lab/discount-codes", { method: "POST", body: JSON.stringify(data) });
}

export function deactivateRationDiscountCode(id: string) {
  return apiFetch<RationDiscountCode>(`/ration-lab/discount-codes/${id}/deactivate`, { method: "PATCH" });
}

export type RationFollowUpDue = RationFollowUpCheckin & {
  sample: { id: string; sampleNo: number; contact: { name: string; phone: string | null } };
};

export function fetchRationFollowUpsDue(withinDays?: number) {
  return apiFetch<RationFollowUpDue[]>(`/ration-lab/followups/due${withinDays ? `?withinDays=${withinDays}` : ""}`);
}

export function completeRationFollowUp(
  id: string,
  data: {
    herdSize?: number;
    totalHerdMilkYieldLiters?: number;
    avgMilkYieldPerAnimalLiters?: number;
    milkFatPercent?: number;
    milkProteinPercent?: number;
    notes?: string;
  },
) {
  return apiFetch<RationFollowUpCheckin>(`/ration-lab/followups/${id}/complete`, { method: "PATCH", body: JSON.stringify(data) });
}

export type RationTrendPoint = {
  label: string;
  date: string;
  totalHerdMilkYieldLiters: number | null;
  avgMilkYieldPerAnimalLiters: number | null;
  milkFatPercent: number | null;
  milkProteinPercent: number | null;
};

export function fetchRationSampleTrend(sampleId: string) {
  return apiFetch<RationTrendPoint[]>(`/ration-lab/reports/sample/${sampleId}/trend`);
}

export type RationAggregateReport = {
  sampleCount: number;
  evaluatedCount: number;
  avgChangePercent: number | null;
  perSample: { sampleNo: number; changePercent: number }[];
};

export function fetchRationAggregateReport() {
  return apiFetch<RationAggregateReport>("/ration-lab/reports/aggregate");
}

// ── HR ───────────────────────────────────────────────────────────────────

export type EmploymentStatus = "ACTIVE" | "TERMINATED";

export type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  nationalId: string | null;
  birthDate: string | null;
  position: string;
  department: { id: string; name: string } | null;
  phone: string | null;
  email: string | null;
  hireDate: string;
  baseSalary: number;
  status: EmploymentStatus;
  terminationReason: string | null;
  terminatedAt: string | null;
  managerId: string | null;
  userId?: string | null;
  createdAt: string;
};

export type OrgChartEntry = {
  id: string;
  fullName: string;
  position: string;
  department: { id: string; name: string } | null;
  managerId: string | null;
  status: EmploymentStatus;
};

export type Department = {
  id: string;
  name: string;
  managerId: string | null;
  manager: { id: string; fullName: string } | null;
  _count: { employees: number };
  createdAt: string;
};

export function fetchDepartments() {
  return apiFetch<Department[]>("/hr/departments");
}

export function createDepartment(data: { name: string; managerId?: string }) {
  return apiFetch<Department>("/hr/departments", { method: "POST", body: JSON.stringify(data) });
}

export function updateDepartment(id: string, data: { name?: string; managerId?: string | null }) {
  return apiFetch<Department>(`/hr/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteDepartment(id: string) {
  return apiFetch<{ success: boolean }>(`/hr/departments/${id}`, { method: "DELETE" });
}

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
  departmentId?: string;
  nationalId?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  hireDate: string;
  baseSalary?: number;
  managerId?: string;
  grantSystemAccess?: boolean;
  roleId?: string;
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
    departmentId: string | null;
    nationalId: string | null;
    birthDate: string | null;
    phone: string | null;
    email: string | null;
    hireDate: string;
    baseSalary: number;
  }>,
) {
  return apiFetch<Employee>(`/hr/employees/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function terminateEmployee(id: string, reason?: string) {
  return apiFetch<Employee>(`/hr/employees/${id}/terminate`, { method: "POST", body: JSON.stringify({ reason }) });
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

export function deleteEmployeeDocument(employeeId: string, documentId: string) {
  return apiFetch<{ success: boolean }>(`/hr/employees/${employeeId}/documents/${documentId}`, { method: "DELETE" });
}

// ── گواهی‌نامه‌ها (ماژول مستقل certificates) ────────────────────────────────

export type CertificateItem = { id?: string; titleFa: string; titleEn?: string | null; order?: number };

export type Certificate = {
  id: string;
  code: string;
  employeeId: string | null;
  crmContactId: string | null;
  recipientNameFa: string;
  recipientNameEn: string | null;
  nationalId: string | null;
  titleFa: string;
  titleEn: string | null;
  items: CertificateItem[];
  durationHours: number | null;
  startDate: string | null;
  endDate: string | null;
  score: number | null;
  issuedByName: string | null;
  createdAt: string;
  employee: { id: string; fullName: string; employeeCode: string } | null;
  crmContact: { id: string; name: string } | null;
  issuedBy: { id: string; name: string } | null;
  verifyUrl?: string;
};

export function fetchCertificates(params?: { employeeId?: string; crmContactId?: string; search?: string }) {
  const q = new URLSearchParams();
  if (params?.employeeId) q.set("employeeId", params.employeeId);
  if (params?.crmContactId) q.set("crmContactId", params.crmContactId);
  if (params?.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<Certificate[]>(`/certificates${qs ? `?${qs}` : ""}`);
}

export function issueCertificate(data: {
  recipientType: "EMPLOYEE" | "CONTACT";
  employeeId?: string;
  crmContactId?: string;
  recipientNameEn: string;
  nationalId?: string;
  titleFa: string;
  titleEn?: string;
  items?: { titleFa: string; titleEn?: string }[];
  durationHours?: number;
  startDate?: string;
  endDate?: string;
  score?: number;
}) {
  return apiFetch<Certificate>("/certificates", { method: "POST", body: JSON.stringify(data) });
}

export function deleteCertificate(id: string) {
  return apiFetch<{ ok: true }>(`/certificates/${id}`, { method: "DELETE" });
}

export type CertificateFieldKey =
  | "recipientName"
  | "title"
  | "body"
  | "items"
  | "nationalId"
  | "companyName"
  | "code"
  | "issueDate"
  | "qr"
  | "stamp"
  | "signature";

export type CertificateFieldPosition = {
  xPct: number;
  yPct: number;
  fontSizePx?: number;
  align?: "left" | "center" | "right";
  widthPct?: number;
  lineHeightPx?: number;
  /** false = چاپ نمی‌شود (پیش‌فرض برای nationalId/companyName) */
  visible?: boolean;
};

export type CertificateTemplateSettings = {
  backgroundImage: string | null;
  stampImage?: string | null;
  signatureImage?: string | null;
  fieldsFa: Record<CertificateFieldKey, CertificateFieldPosition>;
  fieldsEn: Record<CertificateFieldKey, CertificateFieldPosition>;
  itemsColumns: 2 | 3;
  bodyTextFa: string;
  bodyTextEn: string;
  issuerCompanyNameFa: string;
  issuerCompanyNameEn: string;
};

export function fetchCertificateTemplateSettings() {
  return apiFetch<CertificateTemplateSettings>("/certificates/template-settings");
}

export function updateCertificateTemplateSettings(data: Partial<CertificateTemplateSettings>) {
  return apiFetch<CertificateTemplateSettings>("/certificates/template-settings", { method: "PUT", body: JSON.stringify(data) });
}

/** تصویر/PDF گواهی احراز‌هویت لازم دارد، پس به Object URL تبدیل می‌شود (همان الگوی fetchQrCodeImageObjectUrl). */
export async function fetchCertificateImageObjectUrl(id: string, lang: "fa" | "en" = "fa"): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/certificates/${id}/image.png?lang=${lang}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("ساخت تصویر گواهی ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function fetchCertificatePdfObjectUrl(id: string, lang: "fa" | "en" = "fa"): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/certificates/${id}/pdf?lang=${lang}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("ساخت PDF گواهی ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export type PersonnelActionEntry = {
  id: string;
  employeeId: string;
  title: string;
  description: string | null;
  amount: number | null;
  date: string;
  createdAt: string;
  employee: { id: string; fullName: string; employeeCode: string };
  createdBy: { id: string; name: string } | null;
};

export type CreatePersonnelActionInput = { employeeId: string; title: string; description?: string; amount?: number; date?: string };

export function fetchRewards(employeeId?: string) {
  return apiFetch<PersonnelActionEntry[]>(`/hr/rewards${employeeId ? `?employeeId=${employeeId}` : ""}`);
}

export function createReward(data: CreatePersonnelActionInput) {
  return apiFetch<PersonnelActionEntry>("/hr/rewards", { method: "POST", body: JSON.stringify(data) });
}

export function deleteReward(id: string) {
  return apiFetch<{ ok: true }>(`/hr/rewards/${id}`, { method: "DELETE" });
}

export function fetchPenalties(employeeId?: string) {
  return apiFetch<PersonnelActionEntry[]>(`/hr/penalties${employeeId ? `?employeeId=${employeeId}` : ""}`);
}

export function createPenalty(data: CreatePersonnelActionInput) {
  return apiFetch<PersonnelActionEntry>("/hr/penalties", { method: "POST", body: JSON.stringify(data) });
}

export function deletePenalty(id: string) {
  return apiFetch<{ ok: true }>(`/hr/penalties/${id}`, { method: "DELETE" });
}

// ── استعلام عمومی گواهی (بدون ورود، بدون توکن — لینک دائمی) ──────────────

export type PublicCertificateLookup = {
  code: string;
  recipientNameFa: string;
  recipientNameEn: string | null;
  titleFa: string;
  titleEn: string | null;
  items: CertificateItem[];
  durationHours: number | null;
  startDate: string | null;
  endDate: string | null;
  score: number | null;
  issuedAt: string;
  issuedByName: string | null;
  organizationName: string;
  verifyUrl: string;
};

export function fetchPublicCertificate(slug: string, code: string) {
  return apiFetch<PublicCertificateLookup>(`/public/certificates/${slug}/${code}`);
}

export function publicCertificateImageUrl(slug: string, code: string, lang: "fa" | "en" = "fa"): string {
  return `${API_URL}/public/certificates/${slug}/${code}/image.png?lang=${lang}`;
}

export function publicCertificatePdfUrl(slug: string, code: string, lang: "fa" | "en" = "fa"): string {
  return `${API_URL}/public/certificates/${slug}/${code}/pdf?lang=${lang}`;
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

/** فقط فیش پیش‌نویس قابل حذف است — برای وقتی که فیش اشتباه تولید شده. */
export function deletePayrollSlip(id: string) {
  return apiFetch<{ success: boolean }>(`/hr/payroll/${id}`, { method: "DELETE" });
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
export type SalesPaymentMethod = "CASH" | "BANK_TRANSFER" | "CHECK" | "POS" | "ONLINE_GATEWAY";
/** روش پرداخت انتخابی صادرکننده روی خود فاکتور — تصمیم آگاهانه در لحظه‌ی صدور، جدا از SalesPaymentMethod هر رسید پرداخت. */
export type SalesInvoicePaymentMethod = "BANK_TRANSFER" | "ONLINE_GATEWAY" | "CASH" | "CHECK";

export type SalesInvoiceCheck = {
  id: string;
  sayadId: string;
  amount: number;
  dueDate: string;
  bankName: string | null;
  status: string;
  photoDataUrl: string | null;
  createdAt: string;
};

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
  /** آیا این فاکتور مرجوعی فروش دارد — برای نمایش برچسب «مرجوع‌شده» به‌جای «پرداخت‌شده»ی گمراه‌کننده. */
  hasReturn: boolean;
  paymentMethod: SalesInvoicePaymentMethod;
  paymentBankInfo: string | null;
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
  checks: SalesInvoiceCheck[];
  creditWarning: string | null;
};

export function fetchSalesInvoices(contactId?: string, q?: string) {
  const params = new URLSearchParams();
  if (contactId) params.set("contactId", contactId);
  if (q) params.set("q", q);
  const qs = params.toString();
  return apiFetch<SalesInvoice[]>(`/sales/invoices${qs ? `?${qs}` : ""}`);
}

export function fetchSalesInvoice(id: string) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}`);
}

export function createSalesInvoice(data: {
  contactId: string;
  dealId?: string;
  projectId?: string;
  dueAt?: string;
  discount?: number;
  notes?: string;
  paymentMethod?: SalesInvoicePaymentMethod;
  paymentBankInfo?: string;
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
    paidAt?: string;
    checkSayadId?: string;
    checkDueDate?: string;
    checkBankName?: string;
    checkPhotoDataUrl?: string;
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

/** format "sql" = پشتیبان کامل pg_dump فشرده (پیش‌فرض)؛ "json" = خروجی محدودِ قابل بازیابی از داخل برنامه. */
export async function downloadBackupExport(format: "sql" | "json" = "sql"): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/settings/backup/export${format === "json" ? "?format=json" : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("دریافت فایل پشتیبان ناموفق بود", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `exir-backup-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "sql.gz"}`;
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

export function sendSalesInvoicePaymentLink(id: string) {
  return apiFetch<{ ok: true; url: string }>(`/sales/invoices/${id}/send-payment-link`, { method: "POST" });
}

/** دکمه‌ی «پرداخت آنلاین» داخل پنل — فقط برای فاکتوری که روش پرداختش ONLINE_GATEWAY است. */
export function fetchSalesInvoiceOnlinePaymentLink(id: string) {
  return apiFetch<{ paymentUrl: string }>(`/sales/invoices/${id}/online-payment-link`, { method: "POST" });
}

export function fetchDefaultBankInfo() {
  return apiFetch<{ bankInfo: string }>(`/sales/invoices/settings/default-bank-info`);
}

export function updateDefaultBankInfo(bankInfo: string) {
  return apiFetch<{ bankInfo: string }>(`/sales/invoices/settings/default-bank-info`, {
    method: "PUT",
    body: JSON.stringify({ bankInfo }),
  });
}

// ── فاکتور فروش — نمای عمومی (بدون ورود) ──────────────────────────────────

export type PublicSalesInvoiceView = {
  invoiceNo: number;
  status: SalesInvoiceStatus;
  issuedAt: string;
  dueAt: string | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  notes: string | null;
  contact: { name: string; company: string | null; phoneMasked: string | null };
  seller: { name: string; logoUrl: string | null };
  isOfficial: boolean;
  officialInvoiceNo: number | null;
  taxRate: number | null;
  confirmedAt: string | null;
  signedAt: string | null;
  signedByName: string | null;
  deliveryConfirmedAt: string | null;
  cancelReason: string | null;
  lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  payments: Array<{ amount: number; method: SalesPaymentMethod; paidAt: string }>;
  paymentMethod: SalesInvoicePaymentMethod;
  paymentBankInfo: string | null;
  paymentInstruction: string | null;
  canPayOnline: boolean;
  gatewayAvailable: boolean;
};

export function fetchPublicSalesInvoice(tenantSlug: string, token: string) {
  return apiFetch<PublicSalesInvoiceView>(`/public/tenants/${tenantSlug}/invoices/${token}`);
}

export function payPublicSalesInvoice(tenantSlug: string, token: string) {
  return apiFetch<{ paymentUrl?: string; error?: string }>(`/public/tenants/${tenantSlug}/invoices/${token}/pay`, { method: "POST" });
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

export function fetchSalesQuotations(contactId?: string) {
  const qs = contactId ? `?contactId=${encodeURIComponent(contactId)}` : "";
  return apiFetch<SalesQuotation[]>(`/sales/quotations${qs}`);
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

export type PublicInvoiceLineItem = { moduleCode: string; moduleName: string; billingMode: string; amount: number };

export type PublicInvoice = {
  id: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  dueAt: string;
  tenantName: string;
  items: PublicInvoiceLineItem[] | null;
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

export function deleteSalesReturn(id: string) {
  return apiFetch<{ success: boolean }>(`/sales/returns/${id}`, { method: "DELETE" });
}

/** آیا برای این فاکتور هنوز چیزی برای مرجوع‌کردن باقی مانده — برای نمایش/عدم‌نمایش دکمه‌ی «ثبت مرجوعی». */
export function fetchInvoiceReturnable(invoiceId: string) {
  return apiFetch<{ hasReturnable: boolean }>(`/sales/returns/invoice/${invoiceId}/returnable`);
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
  /** آیا این سفارش مرجوعی خرید دارد — برای نمایش برچسب «مرجوع‌شده» به‌جای «پرداخت‌شده»ی گمراه‌کننده. */
  hasReturn: boolean;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  supplier: { id: string; name: string; company: string | null; phone: string | null; email: string | null };
  lines: PurchaseOrderLine[];
  payments: PurchasePayment[];
};

export function fetchPurchaseOrders(q?: string) {
  return apiFetch<PurchaseOrder[]>(`/purchasing/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`);
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
    paidAt?: string;
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

export function deletePurchaseReturn(id: string) {
  return apiFetch<{ success: boolean }>(`/purchasing/returns/${id}`, { method: "DELETE" });
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

export function fetchChecks(filters?: { direction?: CheckDirection; status?: CheckStatus; dueSoonDays?: number; contactId?: string }) {
  const params = new URLSearchParams();
  if (filters?.direction) params.set("direction", filters.direction);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.dueSoonDays != null) params.set("dueSoonDays", String(filters.dueSoonDays));
  if (filters?.contactId) params.set("contactId", filters.contactId);
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

export type ChecksSmsSettings = {
  enabled: boolean;
  dueReminderReceivedTemplate: string;
  dueReminderIssuedTemplate: string;
  bounceAlertTemplate: string;
};

export function fetchChecksSmsSettings() {
  return apiFetch<ChecksSmsSettings>("/checks/settings/sms");
}

export function updateChecksSmsSettings(data: ChecksSmsSettings) {
  return apiFetch<ChecksSmsSettings>("/checks/settings/sms", { method: "PUT", body: JSON.stringify(data) });
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
  /** اگر این پیوست کپیِ بایگانی‌شده‌ی فایل دیگری است (مثلاً فایل چک‌لیست در گزارش روزانه) */
  sourceAttachmentId?: string | null;
  sourceNote?: string | null;
};

export function fetchAttachments(entityType: string, entityId: string) {
  return apiFetch<Attachment[]>(`/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
}

export function createAttachment(data: { entityType: string; entityId: string; title: string; fileUrl: string }) {
  return apiFetch<Attachment>("/attachments", { method: "POST", body: JSON.stringify(data) });
}

export function renameAttachment(id: string, title: string) {
  return apiFetch<Attachment>(`/attachments/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export type ConfidentialCategoryValue = "PASSWORD" | "TECHNICAL_KNOWLEDGE" | "FORMULATION" | "CONFIDENTIAL_CONTRACT" | "SYSTEM_LOG" | "OTHER";

/** تبدیل فایل چک‌لیست (یا نسخه‌ی بایگانی‌شده‌اش در گزارش) به دانش سازمانی */
export function convertAttachmentToKnowledge(id: string, data: { title?: string } = {}) {
  return apiFetch<{ target: string; targetId: string; title: string }>(`/attachments/${id}/convert-to-knowledge`, { method: "POST", body: JSON.stringify(data) });
}

/** بایگانی فایل چک‌لیست در اسناد محرمانه (پیش‌فرض: فقط خودِ شما + مالک/مدیر) */
export function archiveAttachmentConfidential(id: string, data: { title?: string; category?: ConfidentialCategoryValue } = {}) {
  return apiFetch<{ target: string; targetId: string; title: string }>(`/attachments/${id}/archive-confidential`, { method: "POST", body: JSON.stringify(data) });
}

export function deleteAttachment(id: string) {
  return apiFetch<{ success: boolean }>(`/attachments/${id}`, { method: "DELETE" });
}

// ── لیست کارهای روزانه (Daily Checklist) ────────────────────────────────

export type DailyChecklistPriority = "URGENT" | "MEDIUM" | "NORMAL";

export type DailyChecklistItem = {
  id: string;
  userId: string;
  date: string;
  title: string;
  description: string | null;
  done: boolean;
  doneAt: string | null;
  taskId: string | null;
  createdByUserId: string | null;
  order: number;
  priority: DailyChecklistPriority;
  carriedOver?: boolean;
  createdAt: string;
  updatedAt: string;
  task: { id: string; status: "OPEN" | "DONE" } | null;
};

export type DailyChecklistSubordinate = { userId: string; name: string };

export function fetchDailyChecklist(date: string, forUserId?: string) {
  const qs = new URLSearchParams({ date, ...(forUserId ? { forUserId } : {}) }).toString();
  return apiFetch<DailyChecklistItem[]>(`/daily-checklist?${qs}`);
}

export function fetchDailyChecklistSubordinates() {
  return apiFetch<DailyChecklistSubordinate[]>("/daily-checklist/subordinates");
}

export function createDailyChecklistItem(data: { title: string; description?: string; date: string; forUserId?: string; priority?: DailyChecklistPriority }) {
  return apiFetch<DailyChecklistItem>("/daily-checklist", { method: "POST", body: JSON.stringify(data) });
}

export function updateDailyChecklistItem(id: string, data: { title?: string; description?: string; done?: boolean; priority?: DailyChecklistPriority }) {
  return apiFetch<DailyChecklistItem>(`/daily-checklist/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteDailyChecklistItem(id: string) {
  return apiFetch<{ success: boolean }>(`/daily-checklist/${id}`, { method: "DELETE" });
}

export function createDailyChecklistTask(id: string, data: { dueAt?: string; priority?: "NORMAL" | "MEDIUM" | "URGENT" } = {}) {
  return apiFetch<DailyChecklistItem>(`/daily-checklist/${id}/task`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchDailyChecklistDayReport(date: string, forUserId?: string) {
  const qs = new URLSearchParams({ date, ...(forUserId ? { forUserId } : {}) }).toString();
  return apiFetch<{ reportId: string | null }>(`/daily-checklist/report?${qs}`);
}

export function generateDailyChecklistReport(date: string, forUserId?: string) {
  return apiFetch<Report>("/daily-checklist/generate-report", { method: "POST", body: JSON.stringify({ date, forUserId }) });
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

export function updateAutomationRule(
  id: string,
  data: {
    name?: string;
    isActive?: boolean;
    triggerCode?: string;
    actions?: Array<{ type: AutomationActionType; config: Record<string, unknown>; sequenceOrder?: number }>;
  },
) {
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

export type MyVoipExtension = { id: string; extension: string; sipUsername: string | null; sipPassword: string | null } | null;

export function fetchVoipProviders() {
  return apiFetch<VoipProvider[]>("/voip/providers");
}

export function fetchVoipConfig() {
  return apiFetch<VoipConfig>("/voip/config");
}

export function saveVoipConfig(data: { providerCode: string; config: Record<string, unknown> }) {
  return apiFetch<VoipConfig>("/voip/config", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchVoipStatus() {
  return apiFetch<{ configured: boolean }>("/voip/status");
}

export function fetchVoipExtensions() {
  return apiFetch<VoipExtension[]>("/voip/extensions");
}

export function fetchMyVoipExtension() {
  return apiFetch<MyVoipExtension>("/voip/extensions/me");
}

export function saveMyVoipExtension(data: { extension?: string; sipUsername?: string; sipPassword?: string }) {
  return apiFetch<MyVoipExtension>("/voip/extensions/me", { method: "PUT", body: JSON.stringify(data) });
}

// ── گزارش‌های سانترال نواتل ────────────────────────────────────────────────
export type NavatelCdrItem = {
  id: string;
  caller: string;
  destination: string;
  callType: string;
  setupTime: string;
  durationSeconds: number;
  waitingSeconds: number;
  cause: string | null;
  recPath: string | null;
  didNumber: string | null;
};
export type NavatelOperatorStat = {
  operator: string;
  internalCalls: number;
  internalSeconds: number;
  externalCalls: number;
  externalSeconds: number;
  respondPercent: number;
};
export type NavatelVoicemailBox = { uuid: string; boxId: string; email: string | null; enabled: boolean };
export type NavatelVoicemailMessage = { uuid: string; createdAt: string; callerName: string | null; callerNumber: string; lengthSeconds: number };

function rangeQuery(from: string, to: string, extra: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", `${from} 00:00:00`);
  if (to) qs.set("to", `${to} 23:59:59`);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return qs.toString();
}

export function fetchNavatelCdr(from: string, to: string, offset = 0, callType = "") {
  return apiFetch<{ total: number; items: NavatelCdrItem[] }>(`/voip/navatel/cdr?${rangeQuery(from, to, { offset, limit: 20, callType })}`);
}
export function fetchNavatelStats(from: string, to: string) {
  return apiFetch<NavatelOperatorStat[]>(`/voip/navatel/stats?${rangeQuery(from, to)}`);
}
export function fetchNavatelVoicemails() {
  return apiFetch<NavatelVoicemailBox[]>("/voip/navatel/voicemails");
}
export function fetchNavatelVoicemailMessages(uuid: string) {
  return apiFetch<NavatelVoicemailMessage[]>(`/voip/navatel/voicemails/${uuid}/messages`);
}
/** فایل صوتی (ضبط مکالمه/پیام صوتی) با هدر احراز هویت — برای پخش در <audio> به blob URL تبدیل می‌شود. */
export async function fetchNavatelAudioUrl(fileName: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/voip/navatel/audio/${encodeURIComponent(fileName)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("دریافت فایل صوتی ناموفق بود", res.status);
  return URL.createObjectURL(await res.blob());
}

export function originateCall(toNumber: string, contactId?: string) {
  return apiFetch<{ success: boolean }>("/voip/originate", { method: "POST", body: JSON.stringify({ toNumber, contactId }) });
}


export type CallDirection = "INBOUND" | "OUTBOUND";
export type CallStatus = "RINGING" | "ANSWERED" | "MISSED" | "NO_ANSWER" | "FAILED";

export type CallLog = {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  contactId: string | null;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  contact: { id: string; name: string; company: string | null } | null;
  user: { id: string; name: string } | null;
};

export function fetchCallLogs(params: { contactId?: string; mine?: boolean; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.contactId) qs.set("contactId", params.contactId);
  if (params.mine) qs.set("mine", "true");
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString();
  return apiFetch<CallLog[]>(`/voip/calls${suffix ? `?${suffix}` : ""}`);
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

// ── رزرو نوبت (Booking) ──────────────────────────────────────────────────

export type ServiceType = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
  requiresDeposit: boolean;
  depositAmount: number | null;
  requiresCoordination: boolean;
  requiresFullPayment?: boolean;
  description?: string | null;
  location?: string | null;
  locationMode?: "OFFICE" | "CUSTOMER_SITE" | "ONLINE";
  linkToMentoring?: boolean;
};

export type AppointmentStatus = "PENDING_COORDINATION" | "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type AppointmentPaymentStatus = "NONE" | "PENDING" | "PAID";

export type Appointment = {
  id: string;
  serviceTypeId: string;
  contactId: string | null;
  providerUserId: string | null;
  customerName: string;
  customerPhone: string | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string | null;
  cancelReason: string | null;
  paymentStatus: AppointmentPaymentStatus;
  depositAmount: number | null;
  paymentRefId: number | null;
  paidAt: string | null;
  isFullPayment?: boolean;
  paymentMethod?: string | null;
  location?: string | null;
  mentoringSession?: { id: string; engagementId: string; status: string } | null;
  publicToken: string;
  providerToken?: string;
  serviceType: ServiceType;
  contact: { id: string; name: string; phone: string | null } | null;
  provider: { id: string; name: string; phone: string | null } | null;
};

export type AppointmentReportRow = {
  key: string;
  serviceName: string;
  providerName: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  revenue: number;
};

export type StaffAvailabilitySlot = { id: string; userId: string; weekday: number; startMinute: number; endMinute: number };
export type IranHoliday = { month: number; day: number; name: string };

export function fetchServiceTypes(includeInactive?: boolean) {
  return apiFetch<ServiceType[]>(`/booking/service-types${includeInactive ? "?includeInactive=true" : ""}`);
}

export function createServiceType(data: {
  name: string;
  durationMinutes: number;
  price?: number;
  requiresDeposit?: boolean;
  depositAmount?: number;
  requiresCoordination?: boolean;
  requiresFullPayment?: boolean;
  description?: string;
  location?: string;
  locationMode?: "OFFICE" | "CUSTOMER_SITE" | "ONLINE";
  linkToMentoring?: boolean;
}) {
  return apiFetch<ServiceType>("/booking/service-types", { method: "POST", body: JSON.stringify(data) });
}

export function updateServiceType(
  id: string,
  data: Partial<{
    name: string;
    durationMinutes: number;
    price: number;
    isActive: boolean;
    requiresDeposit: boolean;
    depositAmount: number;
    requiresCoordination: boolean;
    requiresFullPayment: boolean;
    description: string;
    location: string;
    locationMode: "OFFICE" | "CUSTOMER_SITE" | "ONLINE";
    linkToMentoring: boolean;
  }>,
) {
  return apiFetch<ServiceType>(`/booking/service-types/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deactivateServiceType(id: string) {
  return apiFetch<ServiceType>(`/booking/service-types/${id}/deactivate`, { method: "POST" });
}

export function fetchAppointments(params: { from?: string; to?: string; status?: string; contactId?: string; providerUserId?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<Appointment[]>(`/booking/appointments${qs ? `?${qs}` : ""}`);
}

export function fetchUpcomingAppointmentsThisWeek() {
  return apiFetch<Appointment[]>("/booking/appointments/upcoming-this-week");
}

export function fetchAppointmentsReport(from: string, to: string) {
  const qs = new URLSearchParams({ from, to }).toString();
  return apiFetch<AppointmentReportRow[]>(`/booking/appointments/report?${qs}`);
}

export function createAppointment(data: {
  serviceTypeId: string;
  contactId?: string;
  providerUserId?: string;
  customerName: string;
  customerPhone?: string;
  startAt: string;
  notes?: string;
}) {
  return apiFetch<Appointment>("/booking/appointments", { method: "POST", body: JSON.stringify(data) });
}

export function updateAppointment(
  id: string,
  data: Partial<{ serviceTypeId: string; contactId: string; providerUserId: string; customerName: string; customerPhone: string; startAt: string; notes: string; location: string; cancelReason: string; reopen: boolean }>,
) {
  return apiFetch<Appointment>(`/booking/appointments/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function recordManualAppointmentPayment(id: string, data: { method: "CASH" | "CARD" | "TRANSFER"; amount?: number }) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/manual-payment`, { method: "POST", body: JSON.stringify(data) });
}

export function deleteAppointment(id: string) {
  return apiFetch<{ success: boolean }>(`/booking/appointments/${id}`, { method: "DELETE" });
}

export function sendAppointmentDetails(id: string) {
  return apiFetch<{ success: boolean }>(`/booking/appointments/${id}/send-details`, { method: "POST" });
}

export function confirmAppointment(id: string) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/confirm`, { method: "POST" });
}

export function completeAppointment(id: string) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/complete`, { method: "POST" });
}

export function noShowAppointment(id: string) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/no-show`, { method: "POST" });
}

export function cancelAppointment(id: string, reason?: string) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function approveCoordination(id: string, data: { startAt?: string; providerUserId?: string }) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/approve-coordination`, { method: "POST", body: JSON.stringify(data) });
}

export function rejectCoordination(id: string, reason?: string) {
  return apiFetch<Appointment>(`/booking/appointments/${id}/reject-coordination`, { method: "POST", body: JSON.stringify({ reason }) });
}

export type BookingSmsSettings = { confirmationTemplate: string };

export function fetchBookingSmsSettings() {
  return apiFetch<BookingSmsSettings>("/booking/appointments/settings/sms");
}

export function updateBookingSmsSettings(data: BookingSmsSettings) {
  return apiFetch<BookingSmsSettings>("/booking/appointments/settings/sms", { method: "PUT", body: JSON.stringify(data) });
}

export type CreateOpportunityInput = {
  title: string;
  summary?: string;
  value?: number;
  stage?: CrmDealStage;
  expectedCloseAt?: string;
};

export function createAppointmentOpportunity(id: string, data: CreateOpportunityInput) {
  return apiFetch<CrmDeal>(`/booking/appointments/${id}/create-opportunity`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchMyAvailability() {
  return apiFetch<StaffAvailabilitySlot[]>("/booking/my-availability");
}

export function replaceMyAvailability(slots: Array<{ weekday: number; startMinute: number; endMinute: number }>) {
  return apiFetch<StaffAvailabilitySlot[]>("/booking/my-availability", { method: "PUT", body: JSON.stringify({ slots }) });
}

// ── رزرو نوبت عمومی (Public booking wizard — no auth) ─────────────────────

export type PublicServiceType = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  requiresDeposit: boolean;
  depositAmount: number | null;
  requiresCoordination: boolean;
  requiresFullPayment?: boolean;
  description?: string | null;
  location?: string | null;
};
export type PublicProvider = { id: string; name: string };

export function fetchPublicServiceTypes(slug: string) {
  return apiFetch<PublicServiceType[]>(`/public/booking/${slug}/service-types`);
}

export type FreeSlot = { startAt: string; time: string; providerIds: string[] };

export function fetchPublicFreeSlots(slug: string, serviceTypeId: string, providerUserId: string | undefined, date: string) {
  const qs = new URLSearchParams({ serviceTypeId, date, ...(providerUserId ? { providerUserId } : {}) }).toString();
  return apiFetch<FreeSlot[]>(`/public/booking/${slug}/slots?${qs}`);
}

export type PublicBookingInfo = { businessName: string; address: string | null };

export function fetchPublicBookingInfo(slug: string) {
  return apiFetch<PublicBookingInfo>(`/public/booking/${slug}/info`);
}

export type PublicAppointmentView = {
  id: string;
  serviceName: string;
  description: string | null;
  customerName: string;
  providerName: string | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  confirmationMessage: string;
  location: string | null;
  paymentStatus: AppointmentPaymentStatus;
  amount: number | null;
  isFullPayment: boolean;
  businessName: string;
  paidAt?: string | null;
  paymentRefId?: number | null;
  paymentMethod?: string | null;
  cancelReason?: string | null;
};

export function fetchPublicAppointmentByToken(slug: string, token: string) {
  return apiFetch<PublicAppointmentView>(`/public/booking/${slug}/a/${token}`);
}

export type ProviderAppointmentView = {
  serviceName: string;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  cancelReason: string | null;
  paymentStatus: AppointmentPaymentStatus;
  amount: number | null;
  isFullPayment: boolean;
  location: string | null;
  canAct: boolean;
  serviceTypeId: string;
};

export function fetchProviderAppointment(slug: string, token: string) {
  return apiFetch<ProviderAppointmentView>(`/public/booking/${slug}/s/${token}`);
}
export function fetchProviderSlots(slug: string, token: string, date: string) {
  return apiFetch<FreeSlot[]>(`/public/booking/${slug}/s/${token}/slots?date=${date}`);
}
export function providerConfirmAppointment(slug: string, token: string) {
  return apiFetch<{ success: boolean }>(`/public/booking/${slug}/s/${token}/confirm`, { method: "POST" });
}
export function providerRejectAppointment(slug: string, token: string, reason: string) {
  return apiFetch<{ success: boolean }>(`/public/booking/${slug}/s/${token}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function providerRescheduleAppointment(slug: string, token: string, startAt: string) {
  return apiFetch<{ success: boolean }>(`/public/booking/${slug}/s/${token}/reschedule`, { method: "POST", body: JSON.stringify({ startAt }) });
}

export function startPublicAppointmentPaymentByToken(slug: string, token: string) {
  return apiFetch<{ paymentUrl?: string; error?: string }>(`/public/booking/${slug}/a/${token}/pay`, { method: "POST" });
}

export function fetchPublicProviders(slug: string) {
  return apiFetch<PublicProvider[]>(`/public/booking/${slug}/providers`);
}

export function fetchPublicHolidays(slug: string, jalaliYear: number) {
  return apiFetch<IranHoliday[]>(`/public/booking/${slug}/holidays?year=${jalaliYear}`);
}

export function requestBookingOtp(slug: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/booking/${slug}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyBookingOtp(slug: string, phone: string, code: string) {
  return apiFetch<{ bookingToken: string; expiresInSeconds: number }>(`/public/booking/${slug}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function createPublicAppointment(
  slug: string,
  data: {
    bookingToken: string;
    serviceTypeId: string;
    providerUserId?: string;
    customerName: string;
    startAt: string;
    notes?: string;
  },
) {
  return apiFetch<Appointment>(`/public/booking/${slug}/appointments`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchPublicAppointmentPayment(slug: string, appointmentId: string) {
  return apiFetch<{ id: string; serviceName: string; customerName: string; startAt: string; depositAmount: number | null; paymentStatus: AppointmentPaymentStatus }>(
    `/public/booking/${slug}/appointments/${appointmentId}`,
  );
}

export function startPublicAppointmentPayment(slug: string, appointmentId: string) {
  return apiFetch<{ paymentUrl?: string; error?: string }>(`/public/booking/${slug}/appointments/${appointmentId}/pay`, { method: "POST" });
}

// ── مدیریت قرارداد (Contracts) ────────────────────────────────────────────

export type ContractType = "SALES" | "PURCHASE";
export type ContractStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
export type ContractPartyMode = "INTERNAL" | "EXTERNAL" | "THIRD_PARTY";
export type ContractLegalCategory = "NOTARIZED" | "LAWYER_SUPERVISED" | "GENERAL";
export type ContractPartySide = "PARTY_A" | "PARTY_B";
export type ContractSignerSide = ContractPartySide | "WITNESS";

export type ContractEditRequest = {
  id: string;
  contractId: string;
  side: ContractPartySide;
  text: string;
  resolved: boolean;
  createdAt: string;
};

export type ContractAmendment = {
  id: string;
  contractId: string;
  text: string;
  contentHash: string | null;
  isLocked: boolean;
  partyASignedAt: string | null;
  partyASignatureDataUrl: string | null;
  partyBSignedAt: string | null;
  partyBSignatureDataUrl: string | null;
  createdAt: string;
};

export type ContractWitness = {
  id: string;
  contractId: string;
  name: string;
  phone: string;
  signedAt: string | null;
  signatureDataUrl: string | null;
  createdAt: string;
};

export type Contract = {
  id: string;
  contractNo: number;
  title: string;
  type: ContractType | null;
  partyMode: ContractPartyMode;
  legalCategory: ContractLegalCategory;
  category: string | null;
  templateId: string | null;
  contactId: string | null;
  employeeId: string | null;
  secondPartyContactId: string | null;
  secondPartyName: string | null;
  secondPartyPhone: string | null;
  secondPartyNationalId: string | null;
  secondPartyRegistrationNumber: string | null;
  secondPartyAddress: string | null;
  customFieldValues: Record<string, string> | null;
  status: ContractStatus;
  value: number;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  renewalReminderDays: number;
  reminderSentAt: string | null;
  terms: string | null;
  guaranteeTerms: string | null;
  referredSignerUserId: string | null;
  signedAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  createdAt: string;
  publicToken: string;
  contentHash: string | null;
  isLocked: boolean;
  partyASignedAt: string | null;
  partyASignatureDataUrl: string | null;
  partyASignerName: string | null;
  partyBSignedAt: string | null;
  partyBSignatureDataUrl: string | null;
  partyBSignerName: string | null;
  partyBSignedAsDelegate: boolean;
  contact: { id: string; name: string; company: string | null; phone: string | null } | null;
  employee: { id: string; fullName: string; phone: string | null } | null;
  secondPartyContact: { id: string; name: string; company: string | null; phone: string | null } | null;
  template: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  editRequests?: ContractEditRequest[];
  amendments?: ContractAmendment[];
  witnesses?: ContractWitness[];
};

export type ContractTemplate = {
  id: string;
  name: string;
  partyMode: ContractPartyMode;
  type: ContractType | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function fetchContracts(params: { type?: string; status?: string; contactId?: string; legalCategory?: string; category?: string; q?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<Contract[]>(`/contracts${qs ? `?${qs}` : ""}`);
}

export function fetchContract(id: string) {
  return apiFetch<Contract>(`/contracts/${id}`);
}

export function fetchExpiringSoonContracts() {
  return apiFetch<Contract[]>("/contracts/expiring-soon");
}

export function fetchContractCategories() {
  return apiFetch<string[]>("/contracts/categories");
}

export function openContractPdf(id: string): Promise<void> {
  return fetchAndOpenPdf(`/contracts/${id}/pdf`);
}

/** فقط برای پیش‌نمایش امضای شرکت هنگام امضای قرارداد — تغییر خودِ مهر/امضا از Settings → General (فقط مالک) است، نه اینجا. */
export function fetchCompanySignature() {
  return apiFetch<{ signatureImage?: string; stampImage?: string }>("/contracts/company-signature");
}

export function fetchContractWitnesses(contractId: string) {
  return apiFetch<ContractWitness[]>(`/contracts/${contractId}/witnesses`);
}

export function addContractWitness(contractId: string, data: { name: string; phone: string }) {
  return apiFetch<ContractWitness>(`/contracts/${contractId}/witnesses`, { method: "POST", body: JSON.stringify(data) });
}

export function removeContractWitness(witnessId: string) {
  return apiFetch<{ ok: true }>(`/contracts/witnesses/${witnessId}`, { method: "DELETE" });
}

export function createContract(data: {
  title: string;
  partyMode: ContractPartyMode;
  type?: ContractType;
  legalCategory?: ContractLegalCategory;
  category?: string;
  guaranteeTerms?: string;
  referredSignerUserId?: string;
  templateId?: string;
  contactId?: string;
  employeeId?: string;
  secondPartyContactId?: string;
  secondPartyName?: string;
  secondPartyPhone?: string;
  secondPartyNationalId?: string;
  secondPartyRegistrationNumber?: string;
  secondPartyAddress?: string;
  /** مقادیر فیلدهای سفارشی قالب — کلید همان نامی است که در متن قالب به‌صورت {{کلید}} استفاده شده. */
  customFields?: Record<string, string>;
  value: number;
  startDate: string;
  endDate: string;
  autoRenew?: boolean;
  renewalReminderDays?: number;
  terms?: string;
}) {
  return apiFetch<Contract>("/contracts", { method: "POST", body: JSON.stringify(data) });
}

export function updateContract(id: string, data: Partial<Pick<Parameters<typeof createContract>[0], "title" | "contactId" | "value" | "startDate" | "endDate" | "autoRenew" | "renewalReminderDays" | "terms" | "category" | "guaranteeTerms" | "referredSignerUserId">>) {
  return apiFetch<Contract>(`/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function signContract(id: string, data: { signatureDataUrl: string; signerName: string }) {
  return apiFetch<Contract>(`/contracts/${id}/sign`, { method: "POST", body: JSON.stringify(data) });
}

export function terminateContract(id: string, reason?: string) {
  return apiFetch<Contract>(`/contracts/${id}/terminate`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function renewContract(id: string, newEndDate: string) {
  return apiFetch<Contract>(`/contracts/${id}/renew`, { method: "POST", body: JSON.stringify({ newEndDate }) });
}

export function fetchContractTemplates() {
  return apiFetch<ContractTemplate[]>("/contracts/templates");
}

export function createContractTemplate(data: { name: string; partyMode: ContractPartyMode; type?: ContractType; body: string }) {
  return apiFetch<ContractTemplate>("/contracts/templates", { method: "POST", body: JSON.stringify(data) });
}

export function updateContractTemplate(id: string, data: { name: string; partyMode: ContractPartyMode; type?: ContractType; body: string }) {
  return apiFetch<ContractTemplate>(`/contracts/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteContractTemplate(id: string) {
  return apiFetch<{ ok: true }>(`/contracts/templates/${id}`, { method: "DELETE" });
}

export function fetchContractEditRequests(contractId: string) {
  return apiFetch<ContractEditRequest[]>(`/contracts/${contractId}/edit-requests`);
}

export function resolveContractEditRequest(requestId: string) {
  return apiFetch<ContractEditRequest>(`/contracts/edit-requests/${requestId}/resolve`, { method: "POST" });
}

export function fetchContractAmendments(contractId: string) {
  return apiFetch<ContractAmendment[]>(`/contracts/${contractId}/amendments`);
}

export function createContractAmendment(contractId: string, text: string) {
  return apiFetch<ContractAmendment>(`/contracts/${contractId}/amendments`, { method: "POST", body: JSON.stringify({ text }) });
}

export function signContractAmendmentAsCompany(amendmentId: string, data: { signatureDataUrl: string; signerName: string }) {
  return apiFetch<ContractAmendment>(`/contracts/amendments/${amendmentId}/sign`, { method: "POST", body: JSON.stringify(data) });
}

// ── امضای دیجیتال عمومی قرارداد (بدون نیاز به لاگین) ───────────────────────

export function requestContractSignOtp(slug: string, publicToken: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/contracts/${slug}/${publicToken}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyContractSignOtp(slug: string, publicToken: string, phone: string, code: string) {
  return apiFetch<{ ticket: string; expiresInSeconds: number; side: ContractSignerSide; witnessId?: string }>(`/public/contracts/${slug}/${publicToken}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function viewPublicContract(slug: string, publicToken: string, ticket: string) {
  return apiFetch<Contract>(`/public/contracts/${slug}/${publicToken}/view`, { method: "POST", body: JSON.stringify({ ticket }) });
}

export function submitPublicContractEditRequest(slug: string, publicToken: string, ticket: string, text: string) {
  return apiFetch<ContractEditRequest>(`/public/contracts/${slug}/${publicToken}/edit-request`, {
    method: "POST",
    body: JSON.stringify({ ticket, text }),
  });
}

export function signPublicContract(
  slug: string,
  publicToken: string,
  data: { ticket: string; signatureDataUrl: string; signerName: string; amendmentId?: string },
) {
  return apiFetch<Contract | ContractAmendment | ContractWitness>(`/public/contracts/${slug}/${publicToken}/sign`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── مدیریت پروژه (Projects) ───────────────────────────────────────────────

export type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";

export type ProjectStageStatus = "PENDING" | "AWAITING_APPROVAL" | "IN_PROGRESS" | "DONE" | "REJECTED";

export type ProjectStage = {
  id: string;
  projectId: string;
  title: string;
  order: number;
  status: ProjectStageStatus;
  responsibleUserId: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  completionReport: string | null;
  responsible: { id: string; name: string } | null;
  requestedBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
};

export type ProjectMember = {
  id: string;
  userId: string;
  user: { id: string; name: string };
};

export type Project = {
  id: string;
  projectNo: number;
  name: string;
  contactId: string | null;
  managerUserId: string | null;
  status: ProjectStatus;
  budget: number | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null } | null;
  manager: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  members: ProjectMember[];
  progress: { total: number; done: number };
  stages: ProjectStage[];
};

export function fetchProjects(params: { status?: string; contactId?: string; q?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<Project[]>(`/projects${qs ? `?${qs}` : ""}`);
}

export function fetchProject(id: string) {
  return apiFetch<Project>(`/projects/${id}`);
}

export function createProject(data: {
  name: string;
  contactId?: string;
  managerUserId?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  description?: string;
  stageTemplateId?: string;
  memberUserIds?: string[];
}) {
  return apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify(data) });
}

export function updateProject(id: string, data: Partial<Parameters<typeof createProject>[0]>) {
  return apiFetch<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteProject(id: string) {
  return apiFetch<{ success: boolean }>(`/projects/${id}`, { method: "DELETE" });
}

export function updateProjectStage(projectId: string, stageId: string, data: { title?: string; responsibleUserId?: string }) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteProjectStage(projectId: string, stageId: string) {
  return apiFetch<{ success: boolean }>(`/projects/${projectId}/stages/${stageId}`, { method: "DELETE" });
}

export function startProject(id: string) {
  return apiFetch<Project>(`/projects/${id}/start`, { method: "POST" });
}

export function holdProject(id: string) {
  return apiFetch<Project>(`/projects/${id}/hold`, { method: "POST" });
}

export function completeProject(id: string) {
  return apiFetch<Project>(`/projects/${id}/complete`, { method: "POST" });
}

export function cancelProject(id: string) {
  return apiFetch<Project>(`/projects/${id}/cancel`, { method: "POST" });
}

// ── قالب مراحل پروژه ───────────────────────────────────────────────────

export type StageTemplate = {
  id: string;
  name: string;
  items: { id: string; title: string; order: number }[];
};

export function fetchStageTemplates() {
  return apiFetch<StageTemplate[]>("/projects/stage-templates");
}

export function createStageTemplate(data: { name: string; items: { title: string }[] }) {
  return apiFetch<StageTemplate>("/projects/stage-templates", { method: "POST", body: JSON.stringify(data) });
}

export function updateStageTemplate(id: string, data: { name: string; items: { title: string }[] }) {
  return apiFetch<StageTemplate>(`/projects/stage-templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteStageTemplate(id: string) {
  return apiFetch<{ success: boolean }>(`/projects/stage-templates/${id}`, { method: "DELETE" });
}

// ── مراحل پروژه ────────────────────────────────────────────────────────

export function addProjectStage(projectId: string, title: string, responsibleUserId?: string) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages`, { method: "POST", body: JSON.stringify({ title, responsibleUserId }) });
}

export function assignProjectStage(projectId: string, stageId: string, responsibleUserId: string | undefined) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}/assign`, {
    method: "POST",
    body: JSON.stringify({ responsibleUserId }),
  });
}

export function requestStageStart(projectId: string, stageId: string) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}/request-start`, { method: "POST" });
}

export function approveStage(projectId: string, stageId: string) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}/approve`, { method: "POST" });
}

export function rejectStage(projectId: string, stageId: string, reason?: string) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function completeStage(projectId: string, stageId: string, report?: string) {
  return apiFetch<ProjectStage>(`/projects/${projectId}/stages/${stageId}/complete`, {
    method: "POST",
    body: JSON.stringify({ report }),
  });
}

// ── فاکتورهای پروژه ────────────────────────────────────────────────────

export type ProjectInvoiceSummary = {
  id: string;
  invoiceNo: number;
  status: string;
  total: number;
  paidAmount: number;
  issuedAt: string;
};

export function fetchProjectInvoices(projectId: string) {
  return apiFetch<ProjectInvoiceSummary[]>(`/projects/${projectId}/invoices`);
}

// ── پیگیری عمومی پروژه (Public tracking — no auth) ────────────────────

export type PublicTrackedProject = {
  projectNo: number;
  name: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  stages: { title: string; status: ProjectStageStatus; completedAt: string | null }[];
};

export function requestTrackingOtp(slug: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/tracking/${slug}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyTrackingOtp(slug: string, phone: string, code: string) {
  return apiFetch<{ trackingToken: string; expiresInSeconds: number }>(`/public/tracking/${slug}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function fetchTrackedProjects(slug: string, trackingToken: string) {
  return apiFetch<PublicTrackedProject[]>(`/public/tracking/${slug}/projects`, {
    method: "POST",
    body: JSON.stringify({ trackingToken }),
  });
}

// ── پورتال عمومی آزمایشگاه جیره (Ration lab review — no auth) ───────────

export type PublicRationLine = { ingredientName: string; quantityPerAnimalKg: string; unitCostSnapshot: number; lineCost: number };

export type PublicPendingLabSample = {
  id: string;
  sampleNo: number;
  status: RationSampleStatus;
  collectedAt: string;
  collectedByName: string | null;
  contact: { name: string; phone: string | null } | null;
};

export type PublicRationSample = {
  id: string;
  sampleNo: number;
  collectedAt: string;
  herdSize: number | null;
  totalHerdMilkYieldLiters: string | null;
  avgMilkYieldPerAnimalLiters: string | null;
  milkFatPercent: string | null;
  milkProteinPercent: string | null;
  currentRationDescription: string | null;
  currentLines: PublicRationLine[];
  contact: { name: string; phone: string | null } | null;
};

export function requestLabReviewOtp(slug: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/ration-lab/${slug}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyLabReviewOtp(slug: string, phone: string, code: string) {
  return apiFetch<{ labToken: string; expiresInSeconds: number }>(`/public/ration-lab/${slug}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function fetchPendingLabSamples(slug: string, labToken: string) {
  return apiFetch<PublicPendingLabSample[]>(`/public/ration-lab/${slug}/samples/pending`, {
    method: "POST",
    body: JSON.stringify({ labToken }),
  });
}

export function confirmLabReceipt(slug: string, labToken: string, sampleIds: string[]) {
  return apiFetch<{ confirmedCount: number }>(`/public/ration-lab/${slug}/samples/confirm-receipt`, {
    method: "POST",
    body: JSON.stringify({ labToken, sampleIds }),
  });
}

export function searchLabReviewSample(slug: string, labToken: string, sampleNo: number) {
  return apiFetch<PublicRationSample>(`/public/ration-lab/${slug}/samples/search`, {
    method: "POST",
    body: JSON.stringify({ labToken, sampleNo }),
  });
}

export function submitLabReviewReport(
  slug: string,
  sampleId: string,
  data: {
    labToken: string;
    reviewedByName?: string;
    currentRationIssues: string;
    riskIfUnchanged: string;
    newRecommendations: string;
    expectedResult: string;
    urgentWarningSigns: string;
    proposedLines: { ingredientName: string; quantityPerAnimalKg: number; unitCostSnapshot: number }[];
    addToKnowledge?: boolean;
  },
) {
  return apiFetch<{ success: boolean }>(`/public/ration-lab/${slug}/samples/${sampleId}/report`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function finalizeLabReport(slug: string, sampleId: string, labToken: string) {
  return apiFetch<{ success: boolean }>(`/public/ration-lab/${slug}/samples/${sampleId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ labToken }),
  });
}

// ── پورتال عمومی نتیجه‌ی آزمایش جیره برای دامدار (no auth) ───────────────

export type PublicRationResultSample = { id: string; sampleNo: number; collectedAt: string; status: RationSampleStatus };

export type PublicRationResultDetail = {
  sampleNo: number;
  collectedAt: string;
  report: {
    currentRationIssues: string;
    riskIfUnchanged: string;
    newRecommendations: string;
    expectedResult: string;
    urgentWarningSigns: string;
    submittedAt: string;
  };
  economics: {
    currentLines: PublicRationLine[];
    proposedLines: PublicRationLine[];
    currentTotalCost: number;
    proposedTotalCost: number;
    delta: number;
  };
};

export function requestRationResultOtp(slug: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/ration-result/${slug}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyRationResultOtp(slug: string, phone: string, code: string) {
  return apiFetch<{ resultToken: string; expiresInSeconds: number }>(`/public/ration-result/${slug}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function fetchRationResultSamples(slug: string, resultToken: string) {
  return apiFetch<PublicRationResultSample[]>(`/public/ration-result/${slug}/samples`, {
    method: "POST",
    body: JSON.stringify({ resultToken }),
  });
}

export function fetchRationResultSample(slug: string, sampleId: string, resultToken: string) {
  return apiFetch<PublicRationResultDetail>(`/public/ration-result/${slug}/samples/${sampleId}`, {
    method: "POST",
    body: JSON.stringify({ resultToken }),
  });
}

// ── ناوگان حمل و نقل (Fleet) ────────────────────────────────────────────

export type Driver = {
  id: string;
  name: string;
  phone: string;
  vehicleType: string | null;
  plateNumber: string | null;
  capacityKg: number | null;
  serviceAreas: string[];
  availableHoursNote: string | null;
  reliabilityNote: string | null;
  isActive: boolean;
  createdAt: string;
  averageRating?: number | null;
};

export function fetchDrivers(isActive?: boolean) {
  const qs = isActive === undefined ? "" : `?isActive=${isActive}`;
  return apiFetch<Driver[]>(`/fleet/drivers${qs}`);
}

export function fetchDriver(id: string) {
  return apiFetch<Driver>(`/fleet/drivers/${id}`);
}

export function createDriver(data: {
  name: string;
  phone: string;
  vehicleType?: string;
  plateNumber?: string;
  capacityKg?: number;
  serviceAreas?: string[];
  availableHoursNote?: string;
  reliabilityNote?: string;
}) {
  return apiFetch<Driver>("/fleet/drivers", { method: "POST", body: JSON.stringify(data) });
}

export function updateDriver(id: string, data: Partial<Parameters<typeof createDriver>[0]> & { isActive?: boolean }) {
  return apiFetch<Driver>(`/fleet/drivers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deactivateDriver(id: string) {
  return apiFetch<Driver>(`/fleet/drivers/${id}`, { method: "DELETE" });
}

export type ShipmentSourceType = "MANUAL" | "STOCK_MOVEMENT" | "SALES_INVOICE";
export type ShipmentStatus = "DRAFT" | "OFFERED" | "ACCEPTED" | "DELIVERED" | "CANCELLED";
export type ShipmentOfferStatus = "SCHEDULED" | "PENDING" | "ACCEPTED" | "EXPIRED";

export type ShipmentOffer = {
  id: string;
  shipmentId: string;
  driverId: string;
  rank: number;
  status: ShipmentOfferStatus;
  publicToken: string;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  driver: { id: string; name: string; phone: string };
};

export type DeliverySurvey = {
  id: string;
  shipmentId: string;
  publicToken: string;
  driverRating: number | null;
  productRating: number | null;
  note: string | null;
  sentAt: string | null;
  submittedAt: string | null;
  createdAt: string;
};

export type Shipment = {
  id: string;
  shipmentNo: number;
  sourceType: ShipmentSourceType;
  sourceStockMovementId: string | null;
  sourceInvoiceId: string | null;
  contactId: string | null;
  cargoType: string;
  quantity: number;
  unit: string | null;
  deliveryAddress: string;
  region: string | null;
  pickupAt: string;
  status: ShipmentStatus;
  driverId: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; phone: string | null } | null;
  driver: { id: string; name: string; phone: string; plateNumber: string | null; vehicleType: string | null } | null;
  createdBy: { id: string; name: string } | null;
  offers: ShipmentOffer[];
  survey: DeliverySurvey | null;
};

export type MatchCandidate = {
  driver: { id: string; name: string; phone: string; capacityKg: number | null; serviceAreas: string[] };
  score: number;
  reasons: string[];
  averageRating: number | null;
};

export function fetchShipments(status?: string, contactId?: string, q?: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (contactId) params.set("contactId", contactId);
  const qs = params.toString();
  return apiFetch<Shipment[]>(`/fleet/shipments${qs ? `?${qs}` : ""}`);
}

export function fetchShipment(id: string) {
  return apiFetch<Shipment>(`/fleet/shipments/${id}`);
}

export type FleetSmsSettings = {
  enabled: boolean;
  offerDispatchTemplate: string;
  offerAcceptedTemplate: string;
  deliveredSurveyTemplate: string;
};

export function fetchFleetSmsSettings() {
  return apiFetch<FleetSmsSettings>("/fleet/shipments/settings/sms");
}

export function updateFleetSmsSettings(data: FleetSmsSettings) {
  return apiFetch<FleetSmsSettings>("/fleet/shipments/settings/sms", { method: "PATCH", body: JSON.stringify(data) });
}

export function createShipment(data: {
  sourceType?: ShipmentSourceType;
  sourceStockMovementId?: string;
  sourceInvoiceId?: string;
  contactId?: string;
  cargoType: string;
  quantity: number;
  unit?: string;
  deliveryAddress: string;
  region?: string;
  pickupAt: string;
}) {
  return apiFetch<Shipment>("/fleet/shipments", { method: "POST", body: JSON.stringify(data) });
}

export function fetchMatchCandidates(shipmentId: string) {
  return apiFetch<MatchCandidate[]>(`/fleet/shipments/${shipmentId}/match-candidates`);
}

export function sendShipmentOffers(shipmentId: string, driverIds?: string[]) {
  return apiFetch<Shipment>(`/fleet/shipments/${shipmentId}/send-offers`, {
    method: "POST",
    body: JSON.stringify({ driverIds }),
  });
}

export function cancelShipment(id: string) {
  return apiFetch<Shipment>(`/fleet/shipments/${id}/cancel`, { method: "POST" });
}

export function deliverShipment(id: string) {
  return apiFetch<Shipment>(`/fleet/shipments/${id}/deliver`, { method: "POST" });
}

// ── لینک عمومی پذیرش بار توسط راننده (بدون OTP) ─────────────────────────

export type PublicOfferView =
  | { status: "pending"; shipment: Shipment }
  | { status: "accepted_by_you"; shipment: Shipment }
  | { status: "taken_by_other" }
  | { status: "cancelled" };

export function viewPublicFleetOffer(slug: string, token: string) {
  return apiFetch<PublicOfferView>(`/public/fleet/offer/${slug}/${token}`);
}

export function acceptPublicFleetOffer(slug: string, token: string) {
  return apiFetch<{ status: string; shipment?: Shipment; driver?: { name: string; phone: string } }>(
    `/public/fleet/offer/${slug}/${token}/accept`,
    { method: "POST" },
  );
}

// ── لینک عمومی نظرسنجی پس از تحویل (بدون OTP) ───────────────────────────

export type PublicSurveyView = DeliverySurvey & {
  shipment: { cargoType: string; quantity: number; deliveredAt: string | null; driver: { name: string } | null };
};

export function viewPublicSurvey(slug: string, token: string) {
  return apiFetch<PublicSurveyView>(`/public/survey/${slug}/${token}`);
}

export function submitPublicSurvey(slug: string, token: string, data: { driverRating?: number; productRating?: number; note?: string }) {
  return apiFetch<DeliverySurvey>(`/public/survey/${slug}/${token}/submit`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── فروشگاه آنلاین (Online Store) ────────────────────────────────────────

export type StoreProduct = {
  id: string;
  sku: string;
  name: string;
  salePrice: number;
  available: number;
  reservedQty: number;
  isPubliclyListed: boolean;
  publicSlug: string | null;
  publicDescription: string | null;
  publicImages: string[];
  publicCompareAtPrice: number | null;
};

export type StoreReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type StoreReview = {
  id: string;
  productId: string;
  customerName: string;
  rating: number;
  comment: string | null;
  status: StoreReviewStatus;
  createdAt: string;
  product: { name: string; publicSlug: string | null };
};

export type StoreOrderStatus = "PENDING" | "CONFIRMED" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export type StoreOrderLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type StoreOrder = {
  id: string;
  orderNo: number;
  contactId: string | null;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  notes: string | null;
  status: StoreOrderStatus;
  subtotal: number;
  trackingCode: string | null;
  createdAt: string;
  confirmedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lines: StoreOrderLine[];
};

export type StoreAnalyticsSummary = {
  periodDays: number;
  uniqueVisitors: number;
  totalOrders: number;
  revenue: number;
  ordersByStatus: Partial<Record<StoreOrderStatus, number>>;
  abandonedCarts: number;
  mostViewedProducts: { productId: string; name: string; views: number; avgDwellSeconds: number | null }[];
};

export function fetchStoreProducts() {
  return apiFetch<StoreProduct[]>("/online-store/products");
}

export function updateStoreListing(
  productId: string,
  data: {
    isPubliclyListed: boolean;
    publicSlug?: string;
    publicDescription?: string;
    publicImages?: string[];
    publicCompareAtPrice?: number | null;
  },
) {
  return apiFetch<StoreProduct>(`/online-store/products/${productId}/listing`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function fetchStoreReviews(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<StoreReview[]>(`/online-store/reviews${qs}`);
}

export function updateStoreReviewStatus(id: string, status: "APPROVED" | "REJECTED") {
  return apiFetch<StoreReview>(`/online-store/reviews/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export function fetchStoreOrders(status?: string, contactId?: string) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (contactId) params.set("contactId", contactId);
  const qs = params.toString();
  return apiFetch<StoreOrder[]>(`/online-store/orders${qs ? `?${qs}` : ""}`);
}

export function fetchStoreOrder(id: string) {
  return apiFetch<StoreOrder>(`/online-store/orders/${id}`);
}

export function updateStoreOrderStatus(id: string, data: { status: StoreOrderStatus; trackingCode?: string }) {
  return apiFetch<StoreOrder>(`/online-store/orders/${id}/status`, { method: "PUT", body: JSON.stringify(data) });
}

export function fetchStoreAnalyticsSummary(days = 7) {
  return apiFetch<StoreAnalyticsSummary>(`/online-store/analytics/summary?days=${days}`);
}

// ── نمای عمومی فروشگاه (بدون ورود) ───────────────────────────────────────

export type PublicStoreInfo = { name: string; themeColor: string | null; logoUrl: string | null };

export type PublicStoreReview = {
  id: string;
  customerName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export type PublicStoreProduct = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  images: string[];
  price: number;
  compareAtPrice: number | null;
  discountPercent: number | null;
  unit: string;
  category: string | null;
  createdAt: string;
  inStock: boolean;
  available: number;
  avgRating: number | null;
  reviewCount: number;
};

export type PublicStoreProductDetail = PublicStoreProduct & { reviews: PublicStoreReview[] };

export function fetchPublicStoreInfo(slug: string) {
  return apiFetch<PublicStoreInfo>(`/public/store/${slug}`);
}

export function fetchPublicStoreProducts(slug: string) {
  return apiFetch<PublicStoreProduct[]>(`/public/store/${slug}/products`);
}

export function fetchPublicStoreProduct(slug: string, productSlug: string) {
  return apiFetch<PublicStoreProductDetail>(`/public/store/${slug}/products/${productSlug}`);
}

export function submitPublicStoreReview(
  slug: string,
  productSlug: string,
  data: { customerName: string; rating: number; comment?: string },
) {
  return apiFetch<{ ok: true }>(`/public/store/${slug}/products/${productSlug}/reviews`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function trackPublicStoreEvent(
  slug: string,
  data: { sessionToken: string; type: "PAGE_VIEW" | "PRODUCT_VIEW" | "PRODUCT_DWELL" | "ADD_TO_CART" | "ORDER_PLACED"; productId?: string; meta?: Record<string, unknown> },
) {
  return apiFetch<{ ok: true }>(`/public/store/${slug}/track`, { method: "POST", body: JSON.stringify(data) });
}

export function placePublicStoreOrder(
  slug: string,
  data: {
    customerName: string;
    customerPhone: string;
    shippingAddress: string;
    notes?: string;
    sessionToken?: string;
    lines: { productId: string; quantity: number }[];
  },
) {
  return apiFetch<{ orderNo: number; status: StoreOrderStatus }>(`/public/store/${slug}/orders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── سرنخ و قیف فروش (CRM Funnel) ─────────────────────────────────────────

export type CrmFunnelStage =
  | "NEW_LEAD"
  | "CONTACTED"
  | "QUALIFIED"
  | "CUSTOMER"
  | "REPEAT_CUSTOMER"
  | "BRAND_AMBASSADOR"
  | "CHURN_RISK"
  | "CHURNED";

export type FunnelStageCount = { stage: string; label: string; count: number };
export type FunnelConversionRate = { fromStage: string; toStage: string; fromLabel: string; toLabel: string; rate: number | null };

export type FunnelSummary = {
  stages: FunnelStageCount[];
  conversionRates: FunnelConversionRate[];
  bottleneck: FunnelConversionRate | null;
  currentDistribution: Record<string, number>;
  ambassador: {
    totalAmbassadors: number;
    totalCustomers: number;
    ratioPercent: number;
    thisMonthCount: number;
    lastMonthCount: number;
    growthPercent: number;
    hasStrongBrandingPotential: boolean;
  };
};

export type FunnelSourcePerformance = { source: string; totalLeads: number; convertedCount: number; conversionRate: number };

export type FunnelSalesKpis = {
  avgAcquisitionCost: number | null;
  bestSource: FunnelSourcePerformance | null;
  sourcePerformance: FunnelSourcePerformance[];
  avgFollowUpHours: number | null;
  salespeople: { userId: string; name: string; totalLeads: number; convertedCount: number; conversionRate: number }[];
};

export type FunnelContact = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  funnelStage: CrmFunnelStage;
  source: string | null;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  avgPurchaseGapDays: number | null;
  isBrandAmbassador: boolean;
  owner: { name: string } | null;
};

export function fetchFunnelSummary() {
  return apiFetch<FunnelSummary>("/crm/funnel/summary");
}

export function fetchFunnelKpis() {
  return apiFetch<FunnelSalesKpis>("/crm/funnel/kpis");
}

export function fetchFunnelContacts(stage?: string) {
  const qs = stage ? `?stage=${stage}` : "";
  return apiFetch<FunnelContact[]>(`/crm/funnel/contacts${qs}`);
}

export function updateFunnelStage(contactId: string, stage: "NEW_LEAD" | "CONTACTED" | "QUALIFIED") {
  return apiFetch<FunnelContact>(`/crm/funnel/contacts/${contactId}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}

export function fetchFunnelStageLabels() {
  return apiFetch<Record<string, string>>("/crm/funnel/stage-labels");
}

export function updateFunnelStageLabels(labels: Record<string, string>) {
  return apiFetch<Record<string, string>>("/crm/funnel/stage-labels", { method: "PATCH", body: JSON.stringify({ labels }) });
}

// ── بازاریابی و کمپین (Marketing Campaigns) ─────────────────────────────

export type MarketingChannel = "SMS" | "BALE" | "WHATSAPP" | "INSTAGRAM_TEMPLATE";
export type MarketingCampaignStatus = "DRAFT" | "SENDING" | "SENT" | "FAILED";
export type MarketingRecipientStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type AudienceFilter = {
  funnelStages?: CrmFunnelStage[];
  minDaysSinceLastPurchase?: number;
  maxDaysSinceLastPurchase?: number;
  frequentBuyerMaxGapDays?: number;
  dueForRepurchase?: boolean;
  purchasedProductContains?: string;
  minPurchaseCount?: number;
  isBrandAmbassador?: boolean;
  source?: string;
};

export type MarketingCampaignRecipient = {
  id: string;
  contactId: string;
  phone: string | null;
  status: MarketingRecipientStatus;
  error: string | null;
  sentAt: string | null;
  contact: { id: string; name: string; phone: string | null };
};

export type MarketingCampaign = {
  id: string;
  name: string;
  channel: MarketingChannel;
  status: MarketingCampaignStatus;
  messageText: string | null;
  templateCode: string | null;
  templateTitle: string | null;
  templateCta: string | null;
  audienceFilter: AudienceFilter;
  createdAt: string;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  attributedOrderCount: number;
  attributedRevenue: number;
  recipients: MarketingCampaignRecipient[];
};

export function fetchCampaigns() {
  return apiFetch<MarketingCampaign[]>("/marketing/campaigns");
}

export function fetchCampaign(id: string) {
  return apiFetch<MarketingCampaign>(`/marketing/campaigns/${id}`);
}

export function previewCampaignAudience(filter: AudienceFilter) {
  return apiFetch<{ count: number; sample: { id: string; name: string; phone: string | null }[] }>(
    "/marketing/campaigns/preview-audience",
    { method: "POST", body: JSON.stringify({ filter }) },
  );
}

export function createCampaign(data: {
  name: string;
  channel: MarketingChannel;
  messageText?: string;
  templateCode?: "post-square" | "story";
  templateTitle?: string;
  templateCta?: string;
  audienceFilter?: AudienceFilter;
}) {
  return apiFetch<MarketingCampaign>("/marketing/campaigns", { method: "POST", body: JSON.stringify(data) });
}

export function sendCampaign(id: string) {
  return apiFetch<MarketingCampaign>(`/marketing/campaigns/${id}/send`, { method: "POST" });
}

export function updateCampaign(id: string, data: Partial<Parameters<typeof createCampaign>[0]>) {
  return apiFetch<MarketingCampaign>(`/marketing/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteCampaign(id: string) {
  return apiFetch<{ ok: true }>(`/marketing/campaigns/${id}`, { method: "DELETE" });
}

/** تصویر کمپین احراز‌هویت لازم دارد — img src مستقیم توکن نمی‌فرستد، پس به Object URL تبدیل می‌شود (همان الگوی downloadBackupExport). */
export async function fetchCampaignImageObjectUrl(id: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/marketing/campaigns/${id}/image`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("ساخت تصویر کمپین ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── منتورینگ، مشاوره و کوچینگ ───────────────────────────────────────────

export type MentoringPricingModel = "HOURLY" | "PACKAGE" | "PROJECT_BASED" | "SUBSCRIPTION";
export type MentoringEngagementStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type MentoringSessionMode = "ONLINE" | "PHONE" | "IN_PERSON";
export type MentoringSessionStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type MentoringGoalType = "QUANTITATIVE" | "QUALITATIVE";
export type MentoringGoalStatus = "IN_PROGRESS" | "ACHIEVED" | "MISSED" | "CANCELLED";

export type MentoringGoalCheckIn = {
  id: string;
  goalId: string;
  sessionId: string | null;
  value: number | null;
  note: string | null;
  recordedAt: string;
};

export type MentoringGoal = {
  id: string;
  engagementId: string;
  title: string;
  type: MentoringGoalType;
  unit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  targetDate: string | null;
  status: MentoringGoalStatus;
  createdAt: string;
  checkIns?: MentoringGoalCheckIn[];
};

export type MentoringSession = {
  id: string;
  engagementId: string;
  appointmentId: string | null;
  mode: MentoringSessionMode;
  scheduledAt: string;
  durationMinutes: number;
  status: MentoringSessionStatus;
  location: string | null;
  minutesNote: string | null;
  invoiceId: string | null;
  reminderSentAt: string | null;
  surveySentAt: string | null;
  createdAt: string;
  engagement?: { id: string; title: string; contact: { id: string; name: string; phone: string | null }; advisor: { id: string; name: string; phone: string | null } };
  survey?: { rating: number | null; note: string | null; sentAt: string | null; submittedAt: string | null } | null;
};

export type MentoringEngagement = {
  id: string;
  engagementNo: number;
  contactId: string;
  advisorUserId: string;
  title: string;
  pricingModel: MentoringPricingModel;
  hourlyRate: number | null;
  packageSessionsCount: number | null;
  packagePrice: number | null;
  subscriptionMonthlyPrice: number | null;
  status: MentoringEngagementStatus;
  contractId: string | null;
  projectId: string | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  contact: { id: string; name: string; phone: string | null; company: string | null };
  advisor: { id: string; name: string };
  contract: { id: string; contractNo: number; title: string } | null;
  project: { id: string; projectNo: number; name: string } | null;
  sessions?: MentoringSession[];
  goals?: MentoringGoal[];
};

export function fetchMentoringEngagements(params: { status?: string; contactId?: string; advisorUserId?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<MentoringEngagement[]>(`/mentoring/engagements${qs ? `?${qs}` : ""}`);
}

export function fetchMentoringEngagement(id: string) {
  return apiFetch<MentoringEngagement>(`/mentoring/engagements/${id}`);
}

export type MentoringSmsSettings = {
  enabled: boolean;
  scheduledContactTemplate: string;
  scheduledAdvisorTemplate: string;
  reminderContactTemplate: string;
  reminderAdvisorTemplate: string;
  surveyTemplate: string;
};

export function fetchMentoringSmsSettings() {
  return apiFetch<MentoringSmsSettings>("/mentoring/sessions/settings/sms");
}

export function updateMentoringSmsSettings(data: MentoringSmsSettings) {
  return apiFetch<MentoringSmsSettings>("/mentoring/sessions/settings/sms", { method: "PATCH", body: JSON.stringify(data) });
}

export function createMentoringEngagement(data: {
  contactId: string;
  advisorUserId: string;
  title: string;
  pricingModel: MentoringPricingModel;
  hourlyRate?: number;
  packageSessionsCount?: number;
  packagePrice?: number;
  subscriptionMonthlyPrice?: number;
  contractId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
}) {
  return apiFetch<MentoringEngagement>("/mentoring/engagements", { method: "POST", body: JSON.stringify(data) });
}

export function updateMentoringEngagement(
  id: string,
  data: Partial<Omit<Parameters<typeof createMentoringEngagement>[0], "contactId" | "startDate">> & { status?: MentoringEngagementStatus },
) {
  return apiFetch<MentoringEngagement>(`/mentoring/engagements/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function fetchMentoringSessions(params: { engagementId?: string; contactId?: string; status?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<MentoringSession[]>(`/mentoring/sessions${qs ? `?${qs}` : ""}`);
}

export function fetchUpcomingMentoringSessions() {
  return apiFetch<MentoringSession[]>("/mentoring/sessions/upcoming");
}

export function createMentoringSession(data: {
  engagementId: string;
  appointmentId?: string;
  mode?: MentoringSessionMode;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
}) {
  return apiFetch<MentoringSession>("/mentoring/sessions", { method: "POST", body: JSON.stringify(data) });
}

export function updateMentoringSession(
  id: string,
  data: Partial<{ mode: MentoringSessionMode; scheduledAt: string; durationMinutes: number; location: string }>,
) {
  return apiFetch<MentoringSession>(`/mentoring/sessions/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function completeMentoringSession(id: string, minutesNote?: string) {
  return apiFetch<MentoringSession>(`/mentoring/sessions/${id}/complete`, { method: "POST", body: JSON.stringify({ minutesNote }) });
}

export function cancelMentoringSession(id: string, reason?: string) {
  return apiFetch<MentoringSession>(`/mentoring/sessions/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function markMentoringSessionNoShow(id: string) {
  return apiFetch<MentoringSession>(`/mentoring/sessions/${id}/no-show`, { method: "POST" });
}

export function fetchMentoringSessionSuggestedAmount(id: string) {
  return apiFetch<{ amount: number | null }>(`/mentoring/sessions/${id}/suggested-amount`);
}

export function createMentoringSessionInvoice(id: string, amount: number) {
  return apiFetch<{ id: string; invoiceNo: number }>(`/mentoring/sessions/${id}/invoice`, { method: "POST", body: JSON.stringify({ amount }) });
}

export function createMentoringSessionOpportunity(id: string, data: CreateOpportunityInput) {
  return apiFetch<CrmDeal>(`/mentoring/sessions/${id}/create-opportunity`, { method: "POST", body: JSON.stringify(data) });
}

export function createMentoringGoal(data: {
  engagementId: string;
  title: string;
  type: MentoringGoalType;
  unit?: string;
  baselineValue?: number;
  targetValue?: number;
  targetDate?: string;
}) {
  return apiFetch<MentoringGoal>("/mentoring/goals", { method: "POST", body: JSON.stringify(data) });
}

export function updateMentoringGoal(
  id: string,
  data: Partial<Omit<Parameters<typeof createMentoringGoal>[0], "engagementId" | "type">> & { status?: MentoringGoalStatus },
) {
  return apiFetch<MentoringGoal>(`/mentoring/goals/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function addMentoringGoalCheckIn(goalId: string, data: { value?: number; note?: string; sessionId?: string }) {
  return apiFetch<MentoringGoalCheckIn>(`/mentoring/goals/${goalId}/check-ins`, { method: "POST", body: JSON.stringify(data) });
}

export type MentoringOverview = {
  activeEngagements: number;
  sessionsThisMonth: number;
  upcomingSessions7d: number;
  goalAchievementRate: number | null;
  totalRevenue: number;
  revenueThisMonth: number;
  avgSatisfaction: number | null;
  surveyResponseCount: number;
};

export function fetchMentoringOverview() {
  return apiFetch<MentoringOverview>("/mentoring/reports/overview");
}

export type MentoringClientLifetimeRow = {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  firstEngagementAt: string;
  lastSessionAt: string | null;
  tenureDays: number;
  totalSessions: number;
  completedSessions: number;
  totalRevenue: number;
  activeEngagements: number;
};

export function fetchMentoringClientLifetime() {
  return apiFetch<MentoringClientLifetimeRow[]>("/mentoring/reports/client-lifetime");
}

export type MentoringAdvisorRow = {
  advisorUserId: string;
  advisorName: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  revenue: number;
  avgSatisfaction: number | null;
  surveyResponseCount: number;
};

export function fetchMentoringByAdvisor() {
  return apiFetch<MentoringAdvisorRow[]>("/mentoring/reports/by-advisor");
}

export type PublicMentoringSurveyView = {
  id: string;
  rating: number | null;
  note: string | null;
  submittedAt: string | null;
  session: { engagement: { title: string; advisor: { name: string } } };
};

export function viewPublicMentoringSurvey(slug: string, token: string) {
  return apiFetch<PublicMentoringSurveyView>(`/public/mentoring-survey/${slug}/${token}`);
}

export function submitPublicMentoringSurvey(slug: string, token: string, data: { rating?: number; note?: string }) {
  return apiFetch<{ id: string; rating: number | null; note: string | null; submittedAt: string | null }>(
    `/public/mentoring-survey/${slug}/${token}/submit`,
    { method: "POST", body: JSON.stringify(data) },
  );
}

export type PublicReferralSurveyView = {
  id: string;
  rating: number | null;
  note: string | null;
  submittedAt: string | null;
  referralConversion: { resellerProfile: { contact: { name: string } } };
};

export function viewPublicReferralSurvey(slug: string, token: string) {
  return apiFetch<PublicReferralSurveyView>(`/public/referral-survey/${slug}/${token}`);
}

export function submitPublicReferralSurvey(slug: string, token: string, data: { rating?: number; note?: string }) {
  return apiFetch<{ id: string; rating: number | null; note: string | null; submittedAt: string | null }>(
    `/public/referral-survey/${slug}/${token}/submit`,
    { method: "POST", body: JSON.stringify(data) },
  );
}

export function fetchEventTicketsByContact(contactId: string) {
  return apiFetch<Array<EventTicket & { event: { id: string; title: string; slug: string; startAt: string } }>>(`/events/tickets/by-contact/${contactId}`);
}

// ── رویداد و بلیط‌فروشی ───────────────────────────────────────────────────

export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "COMPLETED";
export type EventBookingStatus = "PENDING_PAYMENT" | "PAID" | "CANCELLED" | "EXPIRED";
export type EventTicketStatus = "VALID" | "CHECKED_IN" | "CANCELLED";

export type EventTicketType = {
  id: string;
  eventId: string;
  name: string;
  price: number;
  capacity: number | null;
  sortOrder: number;
  sold?: number;
  remaining?: number | null;
};

export type EventItem = {
  id: string;
  eventNo: number;
  slug: string;
  title: string;
  description: string | null;
  coverImage: string | null;
  venue: string | null;
  isOnline: boolean;
  onlineUrl: string | null;
  startAt: string;
  endAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number | null;
  remainingCapacity?: number | null;
  category: string | null;
  status: EventStatus;
  createdBy: { id: string; name: string } | null;
  ticketTypes: EventTicketType[];
};

export type EventBooking = {
  id: string;
  bookingNo: number;
  eventId: string;
  ticketTypeId: string;
  buyerName: string;
  buyerPhone: string;
  contactId: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  status: EventBookingStatus;
  paidAt: string | null;
  invoiceId: string | null;
  createdAt: string;
  ticketType: { name: string };
  tickets: Array<{ id: string; attendeeName: string; status: EventTicketStatus }>;
};

export type EventTicket = {
  id: string;
  bookingId: string;
  eventId: string;
  ticketTypeId: string;
  ticketCode: string;
  qrToken: string;
  attendeeName: string;
  attendeePhone: string | null;
  status: EventTicketStatus;
  checkedInAt: string | null;
  createdAt: string;
  ticketType: { name: string };
  booking: { buyerName: string; buyerPhone: string };
};

export function fetchEvents(params: { status?: string; q?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<EventItem[]>(`/events${qs ? `?${qs}` : ""}`);
}

export function fetchEvent(id: string) {
  return apiFetch<EventItem>(`/events/${id}`);
}

export function createEvent(data: {
  slug: string;
  title: string;
  description?: string;
  coverImage?: string;
  venue?: string;
  isOnline?: boolean;
  onlineUrl?: string;
  startAt: string;
  endAt: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  capacity?: number;
  category?: string;
  ticketTypes: Array<{ name: string; price: number; capacity?: number; sortOrder?: number }>;
}) {
  return apiFetch<EventItem>("/events", { method: "POST", body: JSON.stringify(data) });
}

export function updateEvent(id: string, data: Partial<Omit<Parameters<typeof createEvent>[0], "slug" | "ticketTypes">>) {
  return apiFetch<EventItem>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function publishEvent(id: string) {
  return apiFetch<EventItem>(`/events/${id}/publish`, { method: "POST" });
}

export function unpublishEvent(id: string) {
  return apiFetch<EventItem>(`/events/${id}/unpublish`, { method: "POST" });
}

export function cancelEvent(id: string) {
  return apiFetch<EventItem>(`/events/${id}/cancel`, { method: "POST" });
}

export function createEventTicketType(eventId: string, data: { name: string; price: number; capacity?: number; sortOrder?: number }) {
  return apiFetch<EventTicketType>(`/events/${eventId}/ticket-types`, { method: "POST", body: JSON.stringify(data) });
}

export function updateEventTicketType(ticketTypeId: string, data: Partial<{ name: string; price: number; capacity: number; sortOrder: number }>) {
  return apiFetch<EventTicketType>(`/events/ticket-types/${ticketTypeId}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteEventTicketType(ticketTypeId: string) {
  return apiFetch<{ ok: true }>(`/events/ticket-types/${ticketTypeId}/delete`, { method: "POST" });
}

export function fetchEventBookings(eventId: string) {
  return apiFetch<EventBooking[]>(`/events/${eventId}/bookings`);
}

export function fetchEventTickets(eventId: string) {
  return apiFetch<EventTicket[]>(`/events/${eventId}/tickets`);
}

export function createManualEventBooking(
  eventId: string,
  data: { buyerName: string; buyerPhone: string; items: Array<{ ticketTypeId: string; attendees: Array<{ name: string; phone?: string }> }> },
) {
  return apiFetch<Array<EventBooking & { tickets: EventTicket[] }>>(`/events/${eventId}/bookings`, { method: "POST", body: JSON.stringify(data) });
}

export function checkInEventTicket(qrToken: string) {
  return apiFetch<EventTicket & { alreadyCheckedIn: boolean; event: { title: string }; ticketType: { name: string } }>("/events/check-in", {
    method: "POST",
    body: JSON.stringify({ qrToken }),
  });
}

export function eventTicketQrImageUrl(qrToken: string): string {
  return `${API_URL}/events/tickets/${qrToken}/qr.png`;
}

export type EventsSmsSettings = { enabled: boolean; ticketIssuedTemplate: string };

export function fetchEventsSmsSettings() {
  return apiFetch<EventsSmsSettings>("/events/settings/sms");
}

export function updateEventsSmsSettings(data: EventsSmsSettings) {
  return apiFetch<EventsSmsSettings>("/events/settings/sms", { method: "PATCH", body: JSON.stringify(data) });
}

/** پوستر رویداد احراز‌هویت لازم دارد — img src مستقیم توکن نمی‌فرستد، پس به Object URL تبدیل می‌شود (همان الگوی fetchCampaignImageObjectUrl). */
export async function fetchEventPosterObjectUrl(eventId: string, code: "post-square" | "story"): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/events/${eventId}/poster?code=${code}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("ساخت پوستر ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── رویداد — عمومی (بدون ورود) ────────────────────────────────────────────

export type PublicEventItem = Omit<EventItem, "createdBy">;

export function fetchPublicEvents(tenantSlug: string) {
  return apiFetch<PublicEventItem[]>(`/public/events/${tenantSlug}`);
}

export function fetchPublicEvent(tenantSlug: string, eventSlug: string) {
  return apiFetch<PublicEventItem>(`/public/events/${tenantSlug}/${eventSlug}`);
}

export function requestPublicEventOtp(tenantSlug: string, phone: string) {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>(`/public/events/${tenantSlug}/otp/request`, {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function verifyPublicEventOtp(tenantSlug: string, phone: string, code: string) {
  return apiFetch<{ bookingToken: string; expiresInSeconds: number }>(`/public/events/${tenantSlug}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export function createPublicEventOrder(
  tenantSlug: string,
  eventSlug: string,
  data: {
    bookingToken: string;
    buyerName: string;
    items: Array<{ ticketTypeId: string; attendees: Array<{ name: string; phone?: string }> }>;
  },
) {
  return apiFetch<{ orderGroupId: string; requiresPayment: boolean; amount?: number }>(`/public/events/${tenantSlug}/${eventSlug}/bookings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchPublicEventBookingStatus(tenantSlug: string, orderGroupId: string) {
  return apiFetch<{ status: EventBookingStatus; tickets: Array<{ qrToken: string; ticketCode: string; attendeeName: string }> }>(
    `/public/events/${tenantSlug}/bookings/${orderGroupId}`,
  );
}

export function payPublicEventBooking(tenantSlug: string, orderGroupId: string) {
  return apiFetch<{ paymentUrl?: string; error?: string }>(`/public/events/${tenantSlug}/bookings/${orderGroupId}/pay`, { method: "POST" });
}

export type PublicEventTicket = {
  id: string;
  ticketCode: string;
  qrToken: string;
  attendeeName: string;
  attendeePhone: string | null;
  status: EventTicketStatus;
  event: { title: string; startAt: string; endAt: string; venue: string | null; isOnline: boolean; onlineUrl: string | null };
  ticketType: { name: string };
};

export function fetchPublicEventTicket(tenantSlug: string, qrToken: string) {
  return apiFetch<PublicEventTicket>(`/public/events/${tenantSlug}/ticket/${qrToken}`);
}

export function publicEventCoverImageUrl(tenantSlug: string, eventSlug: string): string {
  return `${API_URL}/public/events/${tenantSlug}/${eventSlug}/image`;
}

export function publicEventTicketQrImageUrl(tenantSlug: string, qrToken: string): string {
  return `${API_URL}/public/events/${tenantSlug}/ticket/${qrToken}/qr.png`;
}

export function publicEventTicketPdfUrl(tenantSlug: string, qrToken: string): string {
  return `${API_URL}/public/events/${tenantSlug}/ticket/${qrToken}/pdf`;
}

// ── فرم‌ساز — نظرسنجی، آزمون آنلاین، پرسش‌نامه، ثبت‌نام ─────────────────────

export type FormType = "SURVEY" | "QUIZ" | "QUESTIONNAIRE" | "REGISTRATION";
export type FormStatus = "DRAFT" | "PUBLISHED" | "CLOSED";
export type FormFieldType = "SHORT_TEXT" | "LONG_TEXT" | "NUMBER" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "RATING" | "DATE" | "PHONE" | "EMAIL";

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  sortOrder: number;
  options: string[];
  correctOption?: string | null;
  points?: number | null;
};

export type FormItem = {
  id: string;
  formNo: number;
  slug: string;
  type: FormType;
  title: string;
  description: string | null;
  coverImage: string | null;
  status: FormStatus;
  collectPhone: boolean;
  requirePhone: boolean;
  createContact: boolean;
  closesAt: string | null;
  passScorePercent: number | null;
  thankYouMessage: string | null;
  allowedOrigins?: string[];
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  fields: FormField[];
  _count?: { submissions: number };
  /** تعداد پاسخ‌های «جدید» (دیده‌نشده) — فقط در فهرست */
  newCount?: number;
};

export type FormSubmissionStatus = "NEW" | "IN_REVIEW" | "DONE";

export type FormAnswer = {
  id: string;
  fieldId: string;
  valueText: string | null;
  valueOptions: string[];
  field: { label: string; type: FormFieldType; sortOrder?: number };
};

export type FormSubmission = {
  id: string;
  formId: string;
  contactId: string | null;
  respondentName: string | null;
  respondentPhone: string | null;
  scorePercent: number | null;
  passed: boolean | null;
  submittedAt: string;
  status: FormSubmissionStatus;
  viewedAt: string | null;
  internalNote: string | null;
  sourceUrl: string | null;
  sourceMeta: { utm?: Record<string, string>; referrer?: string | null; origin?: string | null } | null;
  ipMasked: string | null;
  contact: { id: string; name: string } | null;
  answers: FormAnswer[];
};

export type FormSubmissionDetail = Omit<FormSubmission, "answers"> & {
  answers: Array<FormAnswer & { field: FormField }>;
  form: { id: string; title: string; slug: string; type: FormType; fields: FormField[] };
  viewedByName: string | null;
};

export type FormsInboxSummary = {
  totalNew: number;
  forms: Array<{
    formId: string;
    title: string;
    slug: string;
    type: FormType;
    newCount: number;
    latest: Array<{ id: string; submittedAt: string; respondentName: string | null; respondentPhone: string | null; preview: string | null }>;
  }>;
};

export type FormStats = {
  totalSubmissions: number;
  quizStats: { avgScorePercent: number; passRate: number } | null;
  ratingAverages: Array<{ fieldId: string; label: string; average: number | null }>;
};

export type FormFieldInput = {
  id?: string;
  type: FormFieldType;
  label: string;
  helpText?: string;
  required?: boolean;
  sortOrder?: number;
  options?: string[];
  correctOption?: string;
  points?: number;
};

export function fetchForms(params: { status?: string; type?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return apiFetch<FormItem[]>(`/forms${qs ? `?${qs}` : ""}`);
}

export function fetchForm(id: string) {
  return apiFetch<FormItem>(`/forms/${id}`);
}

export function createForm(data: {
  slug: string;
  type: FormType;
  title: string;
  description?: string;
  coverImage?: string;
  collectPhone?: boolean;
  requirePhone?: boolean;
  createContact?: boolean;
  closesAt?: string;
  passScorePercent?: number;
  thankYouMessage?: string;
  fields: FormFieldInput[];
}) {
  return apiFetch<FormItem>("/forms", { method: "POST", body: JSON.stringify(data) });
}

export function updateForm(id: string, data: Partial<Omit<Parameters<typeof createForm>[0], "slug" | "type">> & { allowedOrigins?: string[] }) {
  return apiFetch<FormItem>(`/forms/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function publishForm(id: string) {
  return apiFetch<FormItem>(`/forms/${id}/publish`, { method: "POST" });
}

export function unpublishForm(id: string) {
  return apiFetch<FormItem>(`/forms/${id}/unpublish`, { method: "POST" });
}

export function closeForm(id: string) {
  return apiFetch<FormItem>(`/forms/${id}/close`, { method: "POST" });
}

export function deleteForm(id: string) {
  return apiFetch<{ ok: true }>(`/forms/${id}/delete`, { method: "POST" });
}

export function fetchFormSubmissions(formId: string, status?: FormSubmissionStatus) {
  return apiFetch<FormSubmission[]>(`/forms/${formId}/submissions${status ? `?status=${status}` : ""}`);
}

export function fetchFormsInboxSummary() {
  return apiFetch<FormsInboxSummary>("/forms/inbox-summary");
}

export function fetchFormSubmissionDetail(submissionId: string) {
  return apiFetch<FormSubmissionDetail>(`/forms/submissions/${submissionId}`);
}

/** باز شدن پاسخ = دیده شد (NEW → IN_REVIEW). */
export function markFormSubmissionViewed(submissionId: string) {
  return apiFetch<{ id: string; status: FormSubmissionStatus; changed: boolean }>(`/forms/submissions/${submissionId}/viewed`, { method: "POST" });
}

export function updateFormSubmission(submissionId: string, data: { status?: FormSubmissionStatus; internalNote?: string }) {
  return apiFetch<{ id: string; status: FormSubmissionStatus; internalNote: string | null }>(`/forms/submissions/${submissionId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function fetchFormStats(formId: string) {
  return apiFetch<FormStats>(`/forms/${formId}/stats`);
}

export type FormSubmissionByContact = {
  id: string;
  respondentName: string | null;
  scorePercent: number | null;
  passed: boolean | null;
  submittedAt: string;
  form: { id: string; title: string; slug: string; type: FormType };
};

export function fetchFormSubmissionsByContact(contactId: string) {
  return apiFetch<FormSubmissionByContact[]>(`/forms/submissions/by-contact/${contactId}`);
}

// ── فرم — نمای عمومی (بدون ورود) ───────────────────────────────────────────

export type PublicFormView = {
  id: string;
  type: FormType;
  title: string;
  description: string | null;
  coverImage: string | null;
  collectPhone: boolean;
  requirePhone: boolean;
  fields: Array<Pick<FormField, "id" | "type" | "label" | "helpText" | "required" | "sortOrder" | "options">>;
  isClosed: boolean;
};

export function fetchPublicForm(tenantSlug: string, formSlug: string) {
  return apiFetch<PublicFormView>(`/public/forms/${tenantSlug}/${formSlug}`);
}

export function submitPublicForm(
  tenantSlug: string,
  formSlug: string,
  data: {
    respondentName?: string;
    respondentPhone?: string;
    answers: Array<{ fieldId: string; valueText?: string; valueOptions?: string[] }>;
    _hp?: string;
    source?: { url?: string; referrer?: string; utm?: Record<string, string> };
  },
) {
  return apiFetch<{ submissionId: string | null; scorePercent: number | null; passed: boolean | null; thankYouMessage: string | null }>(
    `/public/forms/${tenantSlug}/${formSlug}/submit`,
    { method: "POST", body: JSON.stringify(data) },
  );
}

export function publicFormCoverImageUrl(tenantSlug: string, formSlug: string): string {
  return `${API_URL}/public/forms/${tenantSlug}/${formSlug}/image`;
}

// ── گارانتی و خدمات پس از فروش ──────────────────────────────────────────────

export type WarrantyCodeStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "VOID";
export type WarrantyServiceStatus = "NEW" | "REVIEWING" | "AWAITING_PRODUCT" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export type WarrantyCode = {
  id: string;
  code: string;
  productId: string | null;
  itemDescription: string | null;
  invoiceId: string | null;
  invoiceLineId: string | null;
  manualInvoiceNumber: string | null;
  contactId: string | null;
  serialNumber: string | null;
  durationDays: number;
  status: WarrantyCodeStatus;
  issuedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  activatedByName: string | null;
  activatedByPhone: string | null;
  activatedByEmail: string | null;
  termsAcceptedAt: string | null;
  productPhoto: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string } | null;
  contact: { id: string; name: string; phone: string } | null;
  invoice: { id: string; invoiceNo: number } | null;
};

export type WarrantyServiceRequest = {
  id: string;
  warrantyId: string;
  description: string;
  photo: string | null;
  status: WarrantyServiceStatus;
  staffNotes: string | null;
  customerRating: number | null;
  customerFeedback: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  warranty: { code: string; itemDescription: string | null; activatedByName: string | null; activatedByPhone: string | null; status: WarrantyCodeStatus };
};

export type WarrantyCodeDetail = WarrantyCode & { services: WarrantyServiceRequest[] };
export type AfterSalesServiceDetail = WarrantyServiceRequest & { warranty: WarrantyCodeDetail };

export type WarrantyInvoiceGroup = {
  invoiceId: string | null;
  invoiceNo: number | null;
  contactName: string | null;
  totalCodes: number;
  firstIssued: string;
  lastIssued: string;
};

export type WarrantyProduct = { id: string; sku: string; name: string; warrantyEnabled: boolean; warrantyDurationDays: number | null };

export type WarrantyInvoiceSummary = {
  invoiceId: string;
  invoiceNo: number;
  contactId: string;
  contactName: string;
  lines: { id: string; productId: string | null; description: string; quantity: number; warrantyEligible: boolean; alreadyIssued: boolean }[];
};

export type WarrantyGeneralSettings = {
  defaultDurationDays: number;
  reminderDaysBeforeExpiry: number;
  termsConditions: string;
  warrantyManagerUserId: string | null;
};

export type WarrantySmsSettings = {
  enabled: boolean;
  activationCustomerEnabled: boolean;
  activationCustomerTemplate: string;
  activationStaffEnabled: boolean;
  activationStaffTemplate: string;
};

export type WarrantyReportsData = {
  totalCodes: number;
  statusBreakdown: Partial<Record<WarrantyCodeStatus, number>>;
  topItemsByActivation: { itemDescription: string; total: number }[];
  topContactsByActivation: { contactId: string | null; name: string; total: number }[];
};

export type AfterSalesGeneralSettings = {
  serviceTermsConditions: string;
  serviceManagerUserId: string | null;
};

export type AfterSalesSmsSettings = {
  enabled: boolean;
  serviceNewStaffEnabled: boolean;
  serviceNewStaffTemplate: string;
  serviceStatusCustomerEnabled: boolean;
  serviceStatusCustomerTemplate: string;
  serviceStatusStaffEnabled: boolean;
  serviceStatusStaffTemplate: string;
  quickTemplates: { title: string; text: string }[];
};

export type AfterSalesReportsData = {
  totalServices: number;
  serviceStatusBreakdown: Partial<Record<WarrantyServiceStatus, number>>;
  topItemsByService: { itemDescription: string; total: number }[];
  avgRating: number | null;
  ratingCount: number;
  avgResolutionHours: number | null;
  resolvedCount: number;
};

export function fetchWarrantyCodes(filters: { status?: string; search?: string; invoiceId?: string; noInvoice?: boolean; contactId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.invoiceId) params.set("invoiceId", filters.invoiceId);
  if (filters.noInvoice) params.set("noInvoice", "true");
  if (filters.contactId) params.set("contactId", filters.contactId);
  const qs = params.toString();
  return apiFetch<WarrantyCode[]>(`/warranty/codes${qs ? `?${qs}` : ""}`);
}

export function fetchWarrantyInvoiceGroups() {
  return apiFetch<WarrantyInvoiceGroup[]>("/warranty/codes/invoice-groups");
}

export function fetchWarrantyCode(id: string) {
  return apiFetch<WarrantyCodeDetail>(`/warranty/codes/${id}`);
}

export function voidWarrantyCode(id: string) {
  return apiFetch<WarrantyCodeDetail>(`/warranty/codes/${id}/void`, { method: "POST" });
}

export function extendWarrantyCode(id: string, expiresAt: string) {
  return apiFetch<WarrantyCodeDetail>(`/warranty/codes/${id}/extend`, { method: "POST", body: JSON.stringify({ expiresAt }) });
}

export function deleteWarrantyCodes(ids: string[]) {
  return apiFetch<{ ok: true }>("/warranty/codes/delete", { method: "POST", body: JSON.stringify({ ids }) });
}

export function manualIssueWarrantyCodes(data: {
  productId: string;
  contactId?: string;
  quantity: number;
  durationDays?: number;
  serialNumber?: string;
  manualInvoiceNumber?: string;
}) {
  return apiFetch<{ codes: string[] }>("/warranty/codes/manual-issue", { method: "POST", body: JSON.stringify(data) });
}

export function searchWarrantyInvoices(term: string) {
  return apiFetch<{ id: string; label: string }[]>(`/warranty/invoices/search?term=${encodeURIComponent(term)}`);
}

export function fetchWarrantyInvoiceSummary(invoiceId: string) {
  return apiFetch<WarrantyInvoiceSummary>(`/warranty/invoices/${invoiceId}/summary`);
}

export function issueWarrantyFromInvoiceNow(invoiceId: string, lineIds?: string[]) {
  return apiFetch<{ issued: string[]; alreadyIssued: string[] }>(`/warranty/invoices/${invoiceId}/issue-now`, {
    method: "POST",
    body: JSON.stringify({ lineIds }),
  });
}

export function fetchWarrantyInvoiceHasIssuable(invoiceId: string) {
  return apiFetch<{ hasIssuable: boolean }>(`/warranty/invoices/${invoiceId}/has-issuable-warranty`);
}

/** چاپ لیبل احراز‌هویت لازم دارد، پس به Object URL تبدیل می‌شود (همان الگوی fetchEventPosterObjectUrl). */
export async function printWarrantyLabelsObjectUrl(ids: string[], columns?: number): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/warranty/codes/print-labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ids, columns }),
  });
  if (!res.ok) throw new ApiError("چاپ لیبل ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function fetchWarrantyProducts() {
  return apiFetch<WarrantyProduct[]>("/warranty/products");
}

export function updateWarrantyProduct(id: string, data: { warrantyEnabled: boolean; warrantyDurationDays?: number }) {
  return apiFetch<WarrantyProduct>(`/warranty/products/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function fetchWarrantyReports() {
  return apiFetch<WarrantyReportsData>("/warranty/reports");
}

export function fetchWarrantyGeneralSettings() {
  return apiFetch<WarrantyGeneralSettings>("/warranty/settings/general");
}

export function updateWarrantyGeneralSettings(data: WarrantyGeneralSettings) {
  return apiFetch<WarrantyGeneralSettings>("/warranty/settings/general", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchWarrantySmsSettings() {
  return apiFetch<WarrantySmsSettings>("/warranty/settings/sms");
}

export function updateWarrantySmsSettings(data: WarrantySmsSettings) {
  return apiFetch<WarrantySmsSettings>("/warranty/settings/sms", { method: "PUT", body: JSON.stringify(data) });
}

export function importLegacyWarranties(rows: Record<string, string>[]) {
  return apiFetch<{ imported: number; skipped: number }>("/warranty/import", { method: "POST", body: JSON.stringify({ rows }) });
}

// عمومی — بدون ورود

export type PublicWarrantyLookup = {
  code: string;
  itemDescription: string | null;
  status: WarrantyCodeStatus;
  issuedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  serialNumber: string | null;
  afterSalesInstalled: boolean;
};

export function fetchPublicWarrantyLookup(tenantSlug: string, code: string) {
  return apiFetch<PublicWarrantyLookup>(`/public/warranty/${tenantSlug}/lookup?code=${encodeURIComponent(code)}`);
}

export function fetchPublicWarrantyTerms(tenantSlug: string) {
  return apiFetch<{ text: string }>(`/public/warranty/${tenantSlug}/terms`);
}

export function activatePublicWarranty(
  tenantSlug: string,
  data: { code: string; name: string; phone: string; email?: string; termsAccepted?: boolean; productPhoto?: string },
) {
  return apiFetch<{ success: true; warrantyId: string; expiresAt: string; daysRemaining: number | null; afterSalesInstalled: boolean }>(
    `/public/warranty/${tenantSlug}/activate`,
    { method: "POST", body: JSON.stringify(data) },
  );
}

// ── خدمات پس از فروش (ماژول مستقل، dependsOn: warranty) ────────────────────

export function fetchAfterSalesServices(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<WarrantyServiceRequest[]>(`/after-sales-service/services${qs}`);
}

export function fetchAfterSalesService(id: string) {
  return apiFetch<AfterSalesServiceDetail>(`/after-sales-service/services/${id}`);
}

export function updateAfterSalesServiceStatus(id: string, data: { status: WarrantyServiceStatus; staffNotes?: string }) {
  return apiFetch<AfterSalesServiceDetail>(`/after-sales-service/services/${id}/status`, { method: "PATCH", body: JSON.stringify(data) });
}

export function sendAfterSalesServiceSms(id: string, message: string) {
  return apiFetch<{ ok: true }>(`/after-sales-service/services/${id}/sms`, { method: "POST", body: JSON.stringify({ message }) });
}

export function fetchAfterSalesServiceStatusLabels() {
  return apiFetch<Record<string, string>>("/after-sales-service/service-status-labels");
}

export function fetchAfterSalesReports() {
  return apiFetch<AfterSalesReportsData>("/after-sales-service/reports");
}

export function fetchAfterSalesGeneralSettings() {
  return apiFetch<AfterSalesGeneralSettings>("/after-sales-service/settings/general");
}

export function updateAfterSalesGeneralSettings(data: AfterSalesGeneralSettings) {
  return apiFetch<AfterSalesGeneralSettings>("/after-sales-service/settings/general", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchAfterSalesSmsSettings() {
  return apiFetch<AfterSalesSmsSettings>("/after-sales-service/settings/sms");
}

export function updateAfterSalesSmsSettings(data: AfterSalesSmsSettings) {
  return apiFetch<AfterSalesSmsSettings>("/after-sales-service/settings/sms", { method: "PUT", body: JSON.stringify(data) });
}

// عمومی — بدون ورود

export type PublicAfterSalesStatus = {
  code: string;
  itemDescription: string | null;
  warrantyStatus: WarrantyCodeStatus;
  canRequestService: boolean;
  latestService: { id: string; status: WarrantyServiceStatus; createdAt: string; resolvedAt: string | null } | null;
};

export function fetchPublicAfterSalesStatus(tenantSlug: string, code: string) {
  return apiFetch<PublicAfterSalesStatus>(`/public/after-sales-service/${tenantSlug}/status?code=${encodeURIComponent(code)}`);
}

export function fetchPublicAfterSalesTerms(tenantSlug: string) {
  return apiFetch<{ text: string }>(`/public/after-sales-service/${tenantSlug}/terms`);
}

export function requestPublicAfterSalesService(tenantSlug: string, data: { code: string; description: string; photo?: string }) {
  return apiFetch<{ success: true; serviceId: string }>(`/public/after-sales-service/${tenantSlug}/request-service`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function submitPublicAfterSalesFeedback(tenantSlug: string, serviceId: string, data: { rating: number; comment?: string }) {
  return apiFetch<{ success: true }>(`/public/after-sales-service/${tenantSlug}/service-feedback/${serviceId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── کد QR — ساخت QR اختصاصی برای هر لینک دلخواه (داخل یا خارج از اکسیر) ────

export type QrCodeItem = {
  id: string;
  code: string;
  label: string;
  targetUrl: string;
  scanCount: number;
  lastScannedAt: string | null;
  createdAt: string;
  redirectUrl: string;
};

export function fetchQrCodes() {
  return apiFetch<QrCodeItem[]>("/qr-codes");
}

export function fetchQrCode(id: string) {
  return apiFetch<QrCodeItem>(`/qr-codes/${id}`);
}

export function createQrCode(data: { label: string; targetUrl: string }) {
  return apiFetch<QrCodeItem>("/qr-codes", { method: "POST", body: JSON.stringify(data) });
}

export function updateQrCode(id: string, data: { label?: string; targetUrl?: string }) {
  return apiFetch<QrCodeItem>(`/qr-codes/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteQrCode(id: string) {
  return apiFetch<{ ok: true }>(`/qr-codes/${id}`, { method: "DELETE" });
}

/** تصویر QR احراز‌هویت لازم دارد، پس به Object URL تبدیل می‌شود (همان الگوی fetchEventPosterObjectUrl). */
export async function fetchQrCodeImageObjectUrl(id: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/qr-codes/${id}/image.png`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("ساخت تصویر QR ناموفق بود", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── استخدام و جذب نیرو ──────────────────────────────────────────────────────

export type JobEmploymentType = "INTERN" | "PROJECT_BASED" | "PART_TIME" | "FULL_TIME";
export type JobPostingStatus = "OPEN" | "CLOSED";
export type ApplicantStage =
  | "NEW"
  | "INTERVIEW_SCHEDULED"
  | "INTERVIEWED"
  | "SPECIALIST_APPROVED"
  | "SPECIALIST_REJECTED"
  | "OFFER_SENT"
  | "OFFER_DECLINED"
  | "AWAITING_MANAGEMENT"
  | "MANAGEMENT_APPROVED"
  | "MANAGEMENT_REJECTED"
  | "HIRED";
export type InterviewStatus = "SCHEDULED" | "DONE" | "CANCELLED" | "NO_SHOW";
export type JobOfferStatus = "DRAFT" | "SENT" | "ACCEPTED" | "SIGNED" | "REJECTED";

export type JobPosting = {
  id: string;
  postingNo: number;
  title: string;
  jobField: string;
  employmentType: JobEmploymentType;
  capacity: number;
  publishChannel: string | null;
  publishBudget: number | null;
  description: string | null;
  status: JobPostingStatus;
  closedAt: string | null;
  contractId?: string | null;
  contractTemplateId?: string | null;
  createdAt: string;
  _count?: { applicants: number };
};

export type JobInterviewScoreItem = { id: string; interviewId: string; criterion: string; score: number; note: string | null };

export type JobInterview = {
  id: string;
  applicantId: string;
  scheduledAt: string;
  durationMinutes: number;
  interviewerUserId: string | null;
  status: InterviewStatus;
  overallNote: string | null;
  location: string | null;
  createdAt: string;
  interviewer: { id: string; name: string } | null;
  scoreItems: JobInterviewScoreItem[];
  applicant?: { id: string; name: string; phone: string; jobPosting: { title: string } };
};

export type JobOffer = {
  id: string;
  applicantId: string;
  jobDescription: string;
  collaborationType: string;
  workingHours: string | null;
  salary: number;
  benefits: string | null;
  durationMonths: number | null;
  startDate: string | null;
  status: JobOfferStatus;
  publicToken: string;
  candidateAcceptedAt: string | null;
  signedByUserId: string | null;
  signedAt: string | null;
  candidateSignature?: string | null;
  candidateRejectedAt?: string | null;
  stampApplied?: boolean;
  link?: string;
  createdAt: string;
};

export type JobApplicant = {
  id: string;
  jobPostingId: string;
  name: string;
  phone: string;
  educationField: string | null;
  birthDate: string | null;
  skillTags: string[];
  resumeFile: string | null;
  stage: ApplicantStage;
  specialistDecisionReason: string | null;
  specialistDecisionAt: string | null;
  specialistUserId: string | null;
  managementDecisionReason: string | null;
  managementDecisionAt: string | null;
  managementUserId: string | null;
  contactId: string | null;
  createdAt: string;
  jobPosting: { id: string; title: string; postingNo: number };
  specialist: { id: string; name: string } | null;
  management: { id: string; name: string } | null;
  interviews: JobInterview[];
  offer: JobOffer | null;
};

export type RecruitmentPostingReport = {
  postingId: string;
  title: string;
  capacity: number;
  totalApplicants: number;
  hired: number;
  remainingCapacity: number;
  stageBreakdown: Partial<Record<ApplicantStage, number>>;
  status: JobPostingStatus;
  closedAt: string | null;
};

export type RecruitmentGeneralSettings = { defaultInterviewMinutes: number; bufferMinutesBetweenInterviews: number };
export type RecruitmentSmsSettings = {
  enabled: boolean;
  specialistApprovedTemplate: string;
  specialistRejectedTemplate: string;
  managementApprovedTemplate: string;
  managementRejectedTemplate: string;
  interviewInvitationTemplate: string;
  offerSentTemplate: string;
  hiredTemplate: string;
};
export type RecruitmentCompanySeal = { signatureImage?: string; stampImage?: string };

export function fetchJobPostings(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<JobPosting[]>(`/recruitment/postings${qs}`);
}

export function fetchJobPosting(id: string) {
  return apiFetch<JobPosting & { applicants: JobApplicant[] }>(`/recruitment/postings/${id}`);
}

export function fetchPostingReport(id: string) {
  return apiFetch<RecruitmentPostingReport>(`/recruitment/postings/${id}/report`);
}

export function createJobPosting(data: {
  title: string;
  jobField: string;
  employmentType: JobEmploymentType;
  capacity: number;
  publishChannel?: string;
  publishBudget?: number;
  description?: string;
  contractId?: string;
  contractTemplateId?: string | null;
}) {
  return apiFetch<JobPosting>("/recruitment/postings", { method: "POST", body: JSON.stringify(data) });
}

export function updateJobPosting(id: string, data: Partial<Parameters<typeof createJobPosting>[0]>) {
  return apiFetch<JobPosting>(`/recruitment/postings/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function closeJobPosting(id: string) {
  return apiFetch<JobPosting>(`/recruitment/postings/${id}/close`, { method: "POST" });
}

export function reopenJobPosting(id: string) {
  return apiFetch<{ executed: boolean; pendingApproval?: boolean; result?: JobPosting }>(`/recruitment/postings/${id}/reopen`, { method: "POST" });
}

export function fetchApplicants(filters: { jobPostingId?: string; stage?: string; search?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.jobPostingId) params.set("jobPostingId", filters.jobPostingId);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  return apiFetch<JobApplicant[]>(`/recruitment/applicants${qs ? `?${qs}` : ""}`);
}

export function fetchApplicant(id: string) {
  return apiFetch<JobApplicant>(`/recruitment/applicants/${id}`);
}

export function createApplicant(data: {
  jobPostingId: string;
  name: string;
  phone: string;
  educationField?: string;
  birthDate?: string;
  skillTags?: string[];
  resumeFile?: string;
}) {
  return apiFetch<JobApplicant>("/recruitment/applicants", { method: "POST", body: JSON.stringify(data) });
}

export function updateApplicant(id: string, data: Partial<Omit<Parameters<typeof createApplicant>[0], "jobPostingId">>) {
  return apiFetch<JobApplicant>(`/recruitment/applicants/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function specialistDecision(applicantId: string, data: { approved: boolean; reason?: string }) {
  return apiFetch<JobApplicant>(`/recruitment/applicants/${applicantId}/specialist-decision`, { method: "POST", body: JSON.stringify(data) });
}

export function managementDecision(applicantId: string, data: { approved: boolean; reason?: string }) {
  return apiFetch<JobApplicant>(`/recruitment/applicants/${applicantId}/management-decision`, { method: "POST", body: JSON.stringify(data) });
}

export function hireApplicant(applicantId: string, data: { employeeCode?: string; departmentId?: string; applyStamp?: boolean; createLogin?: boolean; roleId?: string }) {
  return apiFetch<Employee>(`/recruitment/applicants/${applicantId}/hire`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchInterviews(filters: { from?: string; to?: string; interviewerUserId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.interviewerUserId) params.set("interviewerUserId", filters.interviewerUserId);
  const qs = params.toString();
  return apiFetch<JobInterview[]>(`/recruitment/interviews${qs ? `?${qs}` : ""}`);
}

export function scheduleInterview(data: {
  applicantId: string;
  scheduledAt: string;
  durationMinutes?: number;
  interviewerUserId?: string;
  location?: string;
}) {
  return apiFetch<JobInterview>("/recruitment/interviews", { method: "POST", body: JSON.stringify(data) });
}

export function updateInterview(
  id: string,
  data: Partial<{ scheduledAt: string; durationMinutes: number; interviewerUserId: string; status: InterviewStatus; location: string }>,
) {
  return apiFetch<JobInterview>(`/recruitment/interviews/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function cancelInterview(id: string) {
  return apiFetch<JobInterview>(`/recruitment/interviews/${id}/cancel`, { method: "POST" });
}

export function recordInterviewReport(
  id: string,
  data: { scores: { criterion: string; score: number; note?: string }[]; overallNote?: string; status: "DONE" | "NO_SHOW" },
) {
  return apiFetch<JobInterview>(`/recruitment/interviews/${id}/report`, { method: "POST", body: JSON.stringify(data) });
}

export function fetchOffer(applicantId: string) {
  return apiFetch<JobOffer>(`/recruitment/applicants/${applicantId}/offer`);
}

export function createOrUpdateOffer(applicantId: string, data: {
  jobDescription: string;
  collaborationType: string;
  workingHours?: string;
  salary: number;
  benefits?: string;
  durationMonths?: number;
  startDate?: string;
}) {
  return apiFetch<JobOffer>(`/recruitment/applicants/${applicantId}/offer`, { method: "POST", body: JSON.stringify(data) });
}

export function sendOffer(offerId: string) {
  return apiFetch<JobOffer>(`/recruitment/offers/${offerId}/send`, { method: "POST" });
}

export function openOfferPdf(offerId: string): void {
  fetchAndOpenPdf(`/recruitment/offers/${offerId}/pdf`);
}

export function fetchRecruitmentGeneralSettings() {
  return apiFetch<RecruitmentGeneralSettings>("/recruitment/settings/general");
}

export function updateRecruitmentGeneralSettings(data: RecruitmentGeneralSettings) {
  return apiFetch<RecruitmentGeneralSettings>("/recruitment/settings/general", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchRecruitmentSmsSettings() {
  return apiFetch<RecruitmentSmsSettings>("/recruitment/settings/sms");
}

export function updateRecruitmentSmsSettings(data: RecruitmentSmsSettings) {
  return apiFetch<RecruitmentSmsSettings>("/recruitment/settings/sms", { method: "PUT", body: JSON.stringify(data) });
}

/** فقط برای پیش‌نمایش/رندر شرایط همکاری — تغییر خودِ مهر/امضا از Settings → General (فقط مالک) است. */
export function fetchRecruitmentCompanySeal() {
  return apiFetch<RecruitmentCompanySeal>("/recruitment/settings/company-seal");
}

// عمومی — بدون ورود

export type PublicJobOfferView = {
  applicantName: string;
  jobDescription: string;
  collaborationType: string;
  workingHours: string | null;
  salary: number;
  benefits: string | null;
  durationMonths: number | null;
  startDate: string | null;
  status: JobOfferStatus;
  candidateAcceptedAt: string | null;
  jobTitle?: string;
  contractTitle?: string | null;
  contractTerms?: string | null;
};

export function fetchPublicJobOffer(tenantSlug: string, token: string) {
  return apiFetch<PublicJobOfferView>(`/public/recruitment/${tenantSlug}/offer/${token}`);
}

export function respondToPublicJobOffer(
  tenantSlug: string,
  token: string,
  accepted: boolean,
  signature?: string,
  nationalId?: string,
  idCardImage?: string,
) {
  return apiFetch<{ success: true; accepted: boolean }>(`/public/recruitment/${tenantSlug}/offer/${token}/respond`, {
    method: "POST",
    body: JSON.stringify({ accepted, signature, nationalId, idCardImage }),
  });
}

// ── گزارش‌ها ──────────────────────────────────────────────────────────────

export type ReportCategory = { id: string; name: string; createdAt: string };

export type ReportReferral = {
  id: string;
  reportId: string;
  note: string | null;
  emailCc: string | null;
  paraphed: boolean;
  paraphedAt: string | null;
  createdAt: string;
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string };
};

export type Report = {
  id: string;
  reportNo: number;
  title: string;
  body: string;
  categoryId: string | null;
  executionAt: string | null;
  isArchived: boolean;
  isKnowledge: boolean;
  createdAt: string;
  updatedAt: string;
  category: ReportCategory | null;
  createdBy: { id: string; name: string } | null;
  referrals: ReportReferral[];
};

export function fetchReportCategories() {
  return apiFetch<ReportCategory[]>("/reports/categories");
}

export function createReportCategory(name: string) {
  return apiFetch<ReportCategory>("/reports/categories", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteReportCategory(id: string) {
  return apiFetch<{ ok: true }>(`/reports/categories/${id}`, { method: "DELETE" });
}

export function fetchReports(filters?: { categoryId?: string; isArchived?: boolean; isKnowledge?: boolean; referredToMe?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.categoryId) params.set("categoryId", filters.categoryId);
  if (filters?.isArchived != null) params.set("isArchived", String(filters.isArchived));
  if (filters?.isKnowledge != null) params.set("isKnowledge", String(filters.isKnowledge));
  if (filters?.referredToMe != null) params.set("referredToMe", String(filters.referredToMe));
  const qs = params.toString();
  return apiFetch<Report[]>(`/reports${qs ? `?${qs}` : ""}`);
}

export function fetchReport(id: string) {
  return apiFetch<Report>(`/reports/${id}`);
}

export function createReport(data: { title: string; body: string; categoryId?: string; executionAt?: string }) {
  return apiFetch<Report>("/reports", { method: "POST", body: JSON.stringify(data) });
}

export function updateReport(id: string, data: Partial<{ title: string; body: string; categoryId: string; executionAt: string }>) {
  return apiFetch<Report>(`/reports/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteReport(id: string) {
  return apiFetch<{ ok: true }>(`/reports/${id}`, { method: "DELETE" });
}

export function archiveReport(id: string) {
  return apiFetch<Report>(`/reports/${id}/archive`, { method: "POST" });
}

export function unarchiveReport(id: string) {
  return apiFetch<Report>(`/reports/${id}/unarchive`, { method: "POST" });
}

export function convertReportToKnowledge(id: string) {
  return apiFetch<Report>(`/reports/${id}/convert-to-knowledge`, { method: "POST" });
}

export function unconvertReportKnowledge(id: string) {
  return apiFetch<Report>(`/reports/${id}/unconvert-knowledge`, { method: "POST" });
}

export function referReport(id: string, data: { toUserIds: string[]; note?: string; emailCc?: string[] }) {
  return apiFetch<Report>(`/reports/${id}/refer`, { method: "POST", body: JSON.stringify(data) });
}

export function paraphReportReferral(reportId: string, referralId: string) {
  return apiFetch<Report>(`/reports/${reportId}/referrals/${referralId}/paraph`, { method: "POST" });
}

// ── KPI پرسنل ────────────────────────────────────────────────────────────

export type EmployeeKpi = {
  employee: { id: string; fullName: string; position: string; employeeCode: string };
  period: { from: string; to: string };
  attendance: { present: number; absent: number; leave: number; holiday: number; rate: number | null };
  tasks: { assigned: number; completed: number; overdue: number; completionRate: number | null } | null;
  rewardsCount: number;
  penaltiesCount: number;
  netRewardScore: number;
  moduleActivity: { moduleCode: string; label: string; recordsCreated: number }[];
  dailyReports?: { cutoff: { hour: number; minute: number }; range: { from: string; to: string }; summary: DailyReportSubmissionSummary | null; rows: DailyReportSubmissionRow[] } | null;
  totalRecordsCreated: number;
  overallScore: number | null;
};

export function fetchEmployeeKpi(employeeId: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiFetch<EmployeeKpi>(`/hr/employees/${employeeId}/kpi${qs ? `?${qs}` : ""}`);
}

// ── نمایندگی و بازاریابی رفرال ───────────────────────────────────────────

export type ResellerTier = "A_PLUS" | "A" | "B";

export type Reseller = {
  id: string;
  contactId: string;
  userId: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  shabaNumber: string | null;
  tier: ResellerTier;
  isVerified: boolean;
  verifiedAt: string | null;
  commissionFirstPaymentPercent: number;
  commissionRenewalPercent: number;
  referralCode: string;
  npsAvgScore: number | null;
  bio?: string | null;
  city?: string | null;
  cooperationStatus?: "ACTIVE" | "END_REQUESTED" | "ENDED";
  hiddenFromMap?: boolean;
  endReason?: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; phone: string | null; address: string | null };
  user: { id: string; phone: string; status: string } | null;
};

export type ReferralConversion = {
  id: string;
  resellerProfileId: string;
  contactId: string;
  controlTenantId: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; phone: string | null };
};

export type ReferralCommission = {
  id: string;
  referralConversionId: string;
  kind: "FIRST_PAYMENT" | "RENEWAL";
  purchaseOrderId: string;
  amount: number;
  createdAt: string;
  referralConversion: { contact: { name: string; company: string | null }; controlTenantId: string | null };
  purchaseOrder: { orderNo: number; status: string; total: number; paidAmount: number };
};

export type ResellerDashboardRow = {
  id: string;
  name: string;
  company: string | null;
  tier: ResellerTier;
  isVerified: boolean;
  npsAvgScore: number | null;
  referredCustomerCount: number;
  totalCommission: number;
  paidCommission: number;
  pendingCommission: number;
};

export function fetchResellers() {
  return apiFetch<Reseller[]>("/referral-marketing/resellers");
}

export function fetchResellerDashboard() {
  return apiFetch<ResellerDashboardRow[]>("/referral-marketing/resellers/dashboard");
}

export function fetchReseller(id: string) {
  return apiFetch<Reseller>(`/referral-marketing/resellers/${id}`);
}

export type ReferralSmsSettings = { enabled: boolean; npsSurveyTemplate: string };

export function fetchReferralSmsSettings() {
  return apiFetch<ReferralSmsSettings>("/referral-marketing/resellers/settings/sms");
}

export function updateReferralSmsSettings(data: ReferralSmsSettings) {
  return apiFetch<ReferralSmsSettings>("/referral-marketing/resellers/settings/sms", { method: "PATCH", body: JSON.stringify(data) });
}

export function createReseller(data: {
  name: string;
  company?: string;
  phone?: string;
  address?: string;
  websiteUrl?: string;
  logoUrl?: string;
  shabaNumber?: string;
  tier?: ResellerTier;
}) {
  return apiFetch<Reseller>("/referral-marketing/resellers", { method: "POST", body: JSON.stringify(data) });
}

export function updateReseller(
  id: string,
  data: Partial<Parameters<typeof createReseller>[0]> & {
    isVerified?: boolean;
    commissionFirstPaymentPercent?: number;
    commissionRenewalPercent?: number;
  },
) {
  return apiFetch<Reseller>(`/referral-marketing/resellers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function grantResellerAccess(id: string) {
  return apiFetch<Reseller>(`/referral-marketing/resellers/${id}/grant-access`, { method: "POST" });
}

export function fetchResellerConversions(id: string) {
  return apiFetch<ReferralConversion[]>(`/referral-marketing/resellers/${id}/conversions`);
}

/** یک مشتری CRM موجود را به این نماینده وصل می‌کند — از این پس فاکتورهای تسویه‌شده‌ی آن مشتری خودکار کمیسیون می‌سازند. */
export function linkResellerConversion(id: string, contactId: string) {
  return apiFetch<ReferralConversion>(`/referral-marketing/resellers/${id}/conversions`, {
    method: "POST",
    body: JSON.stringify({ contactId }),
  });
}

export function fetchResellerCommissions(id: string) {
  return apiFetch<ReferralCommission[]>(`/referral-marketing/resellers/${id}/commissions`);
}

export function fetchMyResellerProfile() {
  return apiFetch<Reseller>("/referral-marketing/me");
}

export function updateMyResellerProfile(data: { logoUrl?: string; bio?: string; websiteUrl?: string; city?: string; company?: string; address?: string }) {
  return apiFetch<Reseller>("/referral-marketing/me", { method: "PATCH", body: JSON.stringify(data) });
}

export function fetchMyReferralConversions() {
  return apiFetch<ReferralConversion[]>("/referral-marketing/me/conversions");
}

export function fetchMyReferralCommissions() {
  return apiFetch<ReferralCommission[]>("/referral-marketing/me/commissions");
}

export type ResellerSupportTicket = {
  id: string;
  tenantId: string;
  tenantName?: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
};

export function fetchMySupportTickets() {
  return apiFetch<ResellerSupportTicket[]>("/referral-marketing/me/support-tickets");
}


// ── کارتابل تأیید ────────────────────────────────────────────────────────────

export type ApprovalRequest = {
  id: string;
  moduleCode: string;
  entityType: string;
  entityId: string;
  title: string;
  summary: string | null;
  link: string | null;
  isOfficial: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  stampApplied: boolean;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export function fetchApprovals(status?: "PENDING" | "APPROVED" | "REJECTED") {
  return apiFetch<ApprovalRequest[]>(`/approvals${status ? `?status=${status}` : ""}`);
}

export type ApprovalDetail = { request: ApprovalRequest; detail: { fields: Array<{ label: string; value: string }> } };

export function fetchApprovalDetail(id: string) {
  return apiFetch<ApprovalDetail>(`/approvals/${id}/detail`);
}

export function fetchPendingApprovalCount() {
  return apiFetch<{ count: number }>("/approvals/pending-count");
}

export function decideApproval(id: string, data: { approved: boolean; withStamp?: boolean; note?: string }) {
  return apiFetch<ApprovalRequest>(`/approvals/${id}/decision`, { method: "POST", body: JSON.stringify(data) });
}

export function grantEmployeeAccess(employeeId: string, data: { roleId: string; phone?: string }) {
  return apiFetch<Employee>(`/hr/employees/${employeeId}/grant-access`, { method: "POST", body: JSON.stringify(data) });
}

// ── پنل پیامکی تننت ─────────────────────────────────────────────────────────

export type SmsPanelStatus = {
  mode: "NONE" | "SYSTEM" | "OWN" | "LEGACY";
  senderNumber?: string;
  smsCount: number | null;
  error: string | null;
};
export type SmsPackageOption = { code: string; credits: number; priceToman: number };

export function fetchSmsPanelStatus() {
  return apiFetch<SmsPanelStatus>("/sms-panel/status");
}

export function setSmsPanelConnection(data: { mode: "NONE" | "SYSTEM" | "OWN"; apiKey?: string; senderNumber?: string }) {
  return apiFetch<SmsPanelStatus>("/sms-panel/connection", { method: "PUT", body: JSON.stringify(data) });
}

export function fetchSmsPackages() {
  return apiFetch<SmsPackageOption[]>("/sms-panel/packages");
}

/** بسته را به فاکتور تبدیل می‌کند و کاربر را به درگاه پرداخت می‌برد؛ بعد از پرداخت، اعتبار فوراً شارژ می‌شود. */
export async function purchaseSmsPackageAndPay(code: string): Promise<string> {
  const { invoiceId } = await apiFetch<{ invoiceId: string }>(`/sms-panel/packages/${code}/purchase`, { method: "POST" });
  const pay = await payPublicInvoice(invoiceId);
  if (!pay.paymentUrl) throw new ApiError(pay.error ?? "درگاه پرداخت در دسترس نیست", 502);
  return pay.paymentUrl;
}

// ── حذف رکوردها (با محافظ سوابق وابسته در سرور) ─────────────────────────────
export function deleteCrmContact(id: string) {
  return apiFetch<{ success: boolean }>(`/crm/contacts/${id}`, { method: "DELETE" });
}
export function deleteEmployee(id: string) {
  return apiFetch<{ success: boolean }>(`/hr/employees/${id}`, { method: "DELETE" });
}
export function deleteLeaveRequest(id: string) {
  return apiFetch<{ success: boolean }>(`/hr/leave/${id}`, { method: "DELETE" });
}
export function deleteJobPosting(id: string) {
  return apiFetch<{ success: boolean }>(`/recruitment/postings/${id}`, { method: "DELETE" });
}
export function deleteJobApplicant(id: string) {
  return apiFetch<{ success: boolean }>(`/recruitment/applicants/${id}`, { method: "DELETE" });
}
export function deleteMentoringEngagement(id: string) {
  return apiFetch<{ success: boolean }>(`/mentoring/engagements/${id}`, { method: "DELETE" });
}
export function deleteMentoringGoal(id: string) {
  return apiFetch<{ success: boolean }>(`/mentoring/goals/${id}`, { method: "DELETE" });
}
export function deleteReseller(id: string) {
  return apiFetch<{ success: boolean }>(`/referral-marketing/resellers/${id}`, { method: "DELETE" });
}

// ── ویرایش/حذف/ابطال اسناد مالی (استاندارد: پیش‌نویس ویرایش‌پذیر، سند قطعی فقط با ابطال و سند معکوس) ──
export type ControlledActionResult = { success: boolean; pendingApproval?: boolean };

export function updateSalesInvoice(id: string, data: Parameters<typeof createSalesInvoice>[0]) {
  return apiFetch<SalesInvoiceDetail>(`/sales/invoices/${id}`, { method: "PUT", body: JSON.stringify(data) });
}
export function deleteSalesInvoice(id: string) {
  return apiFetch<{ success: boolean }>(`/sales/invoices/${id}`, { method: "DELETE" });
}
export function cancelSalesInvoice(id: string, reason: string) {
  return apiFetch<ControlledActionResult>(`/sales/invoices/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function deleteJournalEntry(id: string) {
  return apiFetch<{ success: boolean }>(`/accounting/entries/${id}`, { method: "DELETE" });
}
export function voidJournalEntry(id: string, reason: string) {
  return apiFetch<ControlledActionResult>(`/accounting/entries/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function deletePurchaseOrder(id: string) {
  return apiFetch<{ success: boolean }>(`/purchasing/orders/${id}`, { method: "DELETE" });
}
export function cancelPurchaseOrder(id: string, reason: string) {
  return apiFetch<unknown>(`/purchasing/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function updateJournalEntry(id: string, data: Parameters<typeof createJournalEntry>[0]) {
  return apiFetch<JournalEntry>(`/accounting/entries/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function updatePurchaseOrder(id: string, data: Parameters<typeof createPurchaseOrder>[0]) {
  return apiFetch<PurchaseOrderDetail>(`/purchasing/orders/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

// ── پایان همکاری نماینده و صورتحساب مانده‌ی تسویه ───────────────────────────
export type ResellerSettlement = {
  id: string;
  number: number;
  totalCommission: number;
  paidCommission: number;
  amountDue: number;
  lines: Array<{ customer: string; kind: string; orderNo: number; amount: number; paid: number; due: number }>;
  note: string | null;
  status: "ISSUED" | "SETTLED";
  issuedAt: string;
  settledAt: string | null;
};
export function fetchResellerSettlements(id: string) {
  return apiFetch<ResellerSettlement[]>(`/referral-marketing/resellers/${id}/settlements`);
}
export function createResellerSettlement(id: string, note?: string) {
  return apiFetch<ResellerSettlement>(`/referral-marketing/resellers/${id}/settlements`, { method: "POST", body: JSON.stringify({ note }) });
}
export function settleResellerSettlement(settlementId: string) {
  return apiFetch<ResellerSettlement>(`/referral-marketing/resellers/settlements/${settlementId}/settle`, { method: "POST" });
}
export function endResellerCooperation(id: string, reason: string) {
  return apiFetch<ResellerSettlement>(`/referral-marketing/resellers/${id}/end`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function setResellerMapVisibility(id: string, hidden: boolean) {
  return apiFetch<Reseller>(`/referral-marketing/resellers/${id}/map-visibility`, { method: "POST", body: JSON.stringify({ hidden }) });
}
export function requestMyResellerEnd(reason: string) {
  return apiFetch<{ success: boolean }>("/referral-marketing/me/end-request", { method: "POST", body: JSON.stringify({ reason }) });
}
export function fetchMyResellerSettlements() {
  return apiFetch<ResellerSettlement[]>("/referral-marketing/me/settlements");
}

// ── فروش تک‌محصولی (ماژول مستقل book-store) ─────────────────────────────────

export type BookOrderFormat = "PRINT" | "EBOOK" | "AUDIO";
export type BookOrderStatus = "PENDING_PAYMENT" | "PAID" | "CANCELLED" | "SHIPPED" | "DELIVERED";

export type BookOrder = {
  id: string;
  orderNo: number;
  format: BookOrderFormat;
  buyerName: string;
  buyerPhone: string;
  address: string | null;
  postalCode: string | null;
  unitPrice: number;
  status: BookOrderStatus;
  contactId: string | null;
  paymentRefId: number | null;
  paidAt: string | null;
  invoiceId: string | null;
  createdAt: string;
};

export function fetchBookOrders() {
  return apiFetch<BookOrder[]>("/book-store/orders");
}

export function shipBookOrder(id: string) {
  return apiFetch<BookOrder>(`/book-store/orders/${id}/ship`, { method: "POST" });
}

export type BookStoreSettings = {
  printPriceToman: number;
  ebookPriceToman: number;
  audioPriceToman: number;
  printProductId: string | null;
};

export function fetchBookStoreSettings() {
  return apiFetch<BookStoreSettings>("/book-store/settings");
}

export function updateBookStoreSettings(data: Partial<BookStoreSettings>) {
  return apiFetch<BookStoreSettings>("/book-store/settings", { method: "PUT", body: JSON.stringify(data) });
}

// ── بایگانی اسناد محرمانه (ماژول مستقل confidential-archive) ───────────────
// ثبت سند بدون OTP برای هر کاربر با ماژول نصب‌شده آزاد است؛ مشاهده/ویرایش
// آرشیو پشت یک «بلیط طاق» (vault ticket) کوتاه‌مدت است که فقط پس از تأیید
// پلکانی کد پیامکی + داشتن مجوز صادر می‌شود — نک: توابع request/verifyVaultOtp
// و پارامتر vaultTicket روی توابع زیر که آن را در هدر X-Vault-Ticket می‌فرستند.

export type ConfidentialDocumentCategory =
  | "PASSWORD"
  | "TECHNICAL_KNOWLEDGE"
  | "FORMULATION"
  | "CONFIDENTIAL_CONTRACT"
  | "SYSTEM_LOG"
  | "OTHER";

export const CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS: Record<ConfidentialDocumentCategory, string> = {
  PASSWORD: "رمز عبور",
  TECHNICAL_KNOWLEDGE: "دانش فنی",
  FORMULATION: "فرمولاسیون",
  CONFIDENTIAL_CONTRACT: "قرارداد محرمانه",
  SYSTEM_LOG: "ریز لاگ سیستم",
  OTHER: "سایر",
};

export type ConfidentialDocument = {
  id: string;
  title: string;
  category: ConfidentialDocumentCategory;
  content: string | null;
  fileName: string | null;
  fileData: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedByUserId: string | null;
  updatedAt: string;
  createdBy?: { id: string; name: string } | null;
  updatedBy?: { id: string; name: string } | null;
};

export type ConfidentialArchiveAccessRow = {
  id: string;
  userId: string;
  canEdit: boolean;
  grantedAt: string;
  user: { id: string; name: string };
  grantedBy: { id: string; name: string } | null;
};

/** ثبت سند جدید — بدون OTP، هیچ vaultTicket ای لازم نیست. */
export function createConfidentialDocument(data: {
  title: string;
  category: ConfidentialDocumentCategory;
  content?: string;
  fileName?: string;
  fileData?: string;
}) {
  return apiFetch<ConfidentialDocument>("/confidential-archive/documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** آیا دکمه‌ی «ورود به آرشیو» برای کاربر جاری معنا دارد — مالک/مدیر همیشه، وگرنه فقط با مجوز صریح. بدون OTP. */
export function fetchMyArchiveAccess() {
  return apiFetch<{ isManager: boolean; hasAccess: boolean; canEdit: boolean }>("/confidential-archive/my-access");
}

export function requestArchiveOtp() {
  return apiFetch<{ expiresInSeconds: number; devCode?: string }>("/confidential-archive/otp/request", { method: "POST" });
}

export function verifyArchiveOtp(code: string) {
  return apiFetch<{ vaultTicket: string; expiresInSeconds: number; canEdit: boolean }>("/confidential-archive/otp/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

function vaultHeaders(vaultTicket: string): HeadersInit {
  return { "X-Vault-Ticket": vaultTicket };
}

export function fetchConfidentialDocuments(vaultTicket: string) {
  return apiFetch<ConfidentialDocument[]>("/confidential-archive/documents", { headers: vaultHeaders(vaultTicket) });
}

export function fetchConfidentialDocument(id: string, vaultTicket: string) {
  return apiFetch<ConfidentialDocument>(`/confidential-archive/documents/${id}`, { headers: vaultHeaders(vaultTicket) });
}

export function updateConfidentialDocument(
  id: string,
  data: Partial<{ title: string; category: ConfidentialDocumentCategory; content: string; fileName: string; fileData: string }>,
  vaultTicket: string,
) {
  return apiFetch<ConfidentialDocument>(`/confidential-archive/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    headers: vaultHeaders(vaultTicket),
  });
}

export function deleteConfidentialDocument(id: string, vaultTicket: string) {
  return apiFetch<{ ok: true }>(`/confidential-archive/documents/${id}`, { method: "DELETE", headers: vaultHeaders(vaultTicket) });
}

/** فقط مالک/مدیر — بدون نیاز به OTP (اقدام تنظیماتی، نه مشاهده‌ی محتوای محرمانه). */
export function fetchArchiveAccessList() {
  return apiFetch<ConfidentialArchiveAccessRow[]>("/confidential-archive/access");
}

export function setArchiveAccess(userId: string, canEdit: boolean) {
  return apiFetch<ConfidentialArchiveAccessRow>("/confidential-archive/access", {
    method: "PUT",
    body: JSON.stringify({ userId, canEdit }),
  });
}

export function revokeArchiveAccess(userId: string) {
  return apiFetch<{ ok: true }>(`/confidential-archive/access/${userId}`, { method: "DELETE" });
}


// ── Platform management (parent tenant only) ─────────────────────────────

export type PlatformCatalogModule = {
  id: string;
  code: string;
  name: string;
  category: string;
  isCore: boolean;
  isListed: boolean;
  version: string;
  licenseUsd: number;
  priceMonthly: number;
  priceYearly: number;
  priceLicense: number;
};
export type PlatformTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  planName: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  activeModulesCount: number;
};
export type PlatformTenantModule = {
  code: string;
  name: string;
  category: string;
  status: string;
  billingMode: "MONTHLY" | "YEARLY" | "LICENSE" | null;
  currentPeriodEnd: string | null;
  pendingRenewalInvoiceId: string | null;
};
export type PlatformInvoice = {
  id: string;
  tenantId: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  purpose: string | null;
  items: { moduleCode: string; moduleName: string; billingMode: string; amount: number }[] | null;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  tenant?: { id: string; name: string; slug: string };
};
export type PlatformRenewal = {
  tenant: { id: string; name: string; slug: string };
  moduleCode: string;
  moduleName: string;
  billingMode: "MONTHLY" | "YEARLY" | null;
  nextRenewalAt: string;
  renewalAmount: number;
  pendingInvoice: PlatformInvoice | null;
};
export type PlatformTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type PlatformTicketMessage = { id: string; senderType: "TENANT_USER" | "ADMIN" | "SYSTEM"; body: string; createdAt: string };
export type PlatformTicket = {
  id: string;
  subject: string;
  status: PlatformTicketStatus;
  priority: string;
  createdAt: string;
  resolutionNote: string | null;
  tenant: { name: string; slug: string };
  createdByUser: { name: string | null; phone: string };
  messages: PlatformTicketMessage[];
};

export function fetchPlatformMe() {
  return apiFetch<{ isPlatformOwner: boolean }>("/platform/me");
}
export function fetchPlatformModules() {
  return apiFetch<PlatformCatalogModule[]>("/platform/modules");
}
export function fetchPlatformTenants() {
  return apiFetch<PlatformTenantRow[]>("/platform/tenants");
}
export function fetchPlatformTenant(id: string) {
  return apiFetch<{ tenant: PlatformTenantRow; modules: PlatformTenantModule[]; invoices: PlatformInvoice[] }>(`/platform/tenants/${id}`);
}
export function createPlatformModuleInvoice(
  tenantId: string,
  input: { items: { code: string; billingMode: "MONTHLY" | "YEARLY" | "LICENSE" }[]; dueAt?: string; note?: string },
) {
  return apiFetch<PlatformInvoice>(`/platform/tenants/${tenantId}/module-invoice`, { method: "POST", body: JSON.stringify(input) });
}
export function fetchPlatformInvoices(params: { status?: string; tenantId?: string; recurring?: boolean } = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.tenantId) q.set("tenantId", params.tenantId);
  if (params.recurring) q.set("recurring", "true");
  return apiFetch<PlatformInvoice[]>(`/platform/invoices?${q.toString()}`);
}
export function fetchPlatformRenewals() {
  return apiFetch<PlatformRenewal[]>("/platform/renewals");
}
export function markPlatformInvoicePaid(id: string) {
  return apiFetch<PlatformInvoice>(`/platform/invoices/${id}/mark-paid`, { method: "POST" });
}
export function cancelPlatformInvoice(id: string) {
  return apiFetch<PlatformInvoice>(`/platform/invoices/${id}/cancel`, { method: "POST" });
}
export function fetchPlatformTickets(params: { status?: string; tenantId?: string } = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.tenantId) q.set("tenantId", params.tenantId);
  return apiFetch<PlatformTicket[]>(`/platform/tickets?${q.toString()}`);
}
export function fetchPlatformTicket(id: string) {
  return apiFetch<PlatformTicket>(`/platform/tickets/${id}`);
}
export function replyPlatformTicket(id: string, body: string) {
  return apiFetch<PlatformTicketMessage>(`/platform/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}
export function setPlatformTicketStatus(id: string, status: PlatformTicketStatus, resolutionNote?: string) {
  return apiFetch<PlatformTicket>(`/platform/tickets/${id}/status`, { method: "POST", body: JSON.stringify({ status, resolutionNote }) });
}

// ── پروپوزال برای مشتری (proposals) ──────────────────────────────────────

export type ProposalStatus = "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "REJECTED" | "REVISION_REQUESTED" | "EXPIRED";

export type ProposalInvoiceLine = { description: string; quantity: number; unitPrice: number };

export type ProposalListItem = {
  id: string;
  proposalNo: number;
  title: string;
  status: ProposalStatus;
  amount: number;
  contactId: string;
  contact: { id: string; name: string; company: string | null };
  assignedUserId: string | null;
  assignedTo: { id: string; name: string } | null;
  issuedAt: string;
  validUntil: string | null;
  viewCount: number;
  invoiceId: string | null;
  invoicedAt: string | null;
  createdAt: string;
  _count: { comments: number };
};

export type ProposalComment = {
  id: string;
  authorType: "CUSTOMER" | "STAFF";
  authorName: string | null;
  kind: "COMMENT" | "REVISION_REQUEST" | "REJECTION";
  body: string;
  createdAt: string;
};

export type ProposalDetail = Omit<ProposalListItem, "_count"> & {
  content: string;
  durationText: string | null;
  paymentMethodText: string | null;
  paymentTerms: string | null;
  paymentDeadline: string | null;
  paymentDueAt: string | null;
  bankInfo: string | null;
  invoiceLines: ProposalInvoiceLine[] | null;
  internalNote: string | null;
  statusNote: string | null;
  dealId: string | null;
  sentAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  acceptedByName: string | null;
  acceptedSignatureDataUrl: string | null;
  acceptedAt: string | null;
  acceptedIp: string | null;
  acceptedManually: boolean;
  rejectedReason: string | null;
  contact: { id: string; name: string; company: string | null; phone: string | null; email: string | null };
  deal: { id: string; title: string } | null;
  createdBy: { id: string; name: string } | null;
  comments: ProposalComment[];
  events: Array<{ id: string; type: string; body: string | null; createdAt: string }>;
  views: Array<{ id: string; ip: string | null; userAgent: string | null; createdAt: string }>;
  invoice: { id: string; invoiceNo: number; status: string } | null;
};

export type ProposalInput = {
  title?: string;
  contactId?: string;
  dealId?: string | null;
  content?: string;
  durationText?: string | null;
  amount?: number;
  paymentMethodText?: string | null;
  paymentTerms?: string | null;
  paymentDeadline?: string | null;
  paymentDueAt?: string | null;
  bankInfo?: string | null;
  validUntil?: string | null;
  internalNote?: string | null;
  assignedUserId?: string | null;
  invoiceLines?: ProposalInvoiceLine[] | null;
};

export type ProposalTemplate = {
  id: string;
  name: string;
  title: string;
  content: string;
  durationText: string | null;
  amount: number;
  paymentMethodText: string | null;
  paymentTerms: string | null;
  paymentDeadline: string | null;
  bankInfo: string | null;
  validDays: number | null;
  updatedAt: string;
  createdBy: { name: string } | null;
};

export function fetchProposals(filters: { q?: string; status?: string; contactId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.contactId) params.set("contactId", filters.contactId);
  const qs = params.toString();
  return apiFetch<ProposalListItem[]>(`/proposals${qs ? `?${qs}` : ""}`);
}
export function fetchProposal(id: string) {
  return apiFetch<ProposalDetail>(`/proposals/${id}`);
}
export function createProposal(data: ProposalInput & { title: string; contactId: string }) {
  return apiFetch<ProposalListItem>("/proposals", { method: "POST", body: JSON.stringify(data) });
}
export function updateProposal(id: string, data: ProposalInput) {
  return apiFetch<ProposalListItem>(`/proposals/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteProposal(id: string) {
  return apiFetch<{ success: boolean }>(`/proposals/${id}`, { method: "DELETE" });
}
export function setProposalStatus(id: string, status: ProposalStatus, note?: string) {
  return apiFetch<ProposalListItem>(`/proposals/${id}/status`, { method: "POST", body: JSON.stringify({ status, note }) });
}
export function updateProposalStatusNote(id: string, statusNote: string) {
  return apiFetch<ProposalListItem>(`/proposals/${id}/status-note`, { method: "PATCH", body: JSON.stringify({ statusNote }) });
}
export function assignProposal(id: string, userId: string | null, createTask: boolean) {
  return apiFetch<{ id: string; assignedUserId: string | null }>(`/proposals/${id}/assign`, { method: "POST", body: JSON.stringify({ userId, createTask }) });
}
export function addProposalStaffComment(id: string, body: string) {
  return apiFetch<ProposalComment>(`/proposals/${id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}
export function getProposalLink(id: string) {
  return apiFetch<{ url: string }>(`/proposals/${id}/link`, { method: "POST" });
}
export function fetchProposalSmsPreview(id: string) {
  return apiFetch<{ phone: string | null; contactName: string; message: string; parts: number; url: string }>(`/proposals/${id}/sms-preview`);
}
export function sendProposalSms(id: string) {
  return apiFetch<{ ok: boolean; url: string }>(`/proposals/${id}/send-sms`, { method: "POST" });
}
export function issueProposalInvoice(id: string, data: { dueAt?: string; lines?: ProposalInvoiceLine[] } = {}) {
  return apiFetch<{ invoiceId: string; invoiceNo: number }>(`/proposals/${id}/issue-invoice`, { method: "POST", body: JSON.stringify(data) });
}
export function fetchProposalTemplates() {
  return apiFetch<ProposalTemplate[]>("/proposals/templates");
}
export function createProposalTemplate(data: Record<string, unknown>) {
  return apiFetch<ProposalTemplate>("/proposals/templates", { method: "POST", body: JSON.stringify(data) });
}
export function updateProposalTemplate(id: string, data: Record<string, unknown>) {
  return apiFetch<ProposalTemplate>(`/proposals/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteProposalTemplate(id: string) {
  return apiFetch<{ success: boolean }>(`/proposals/templates/${id}`, { method: "DELETE" });
}

export type PublicProposalView = {
  seller: { name: string; logoUrl: string | null; phone: string | null; address: string | null };
  proposalNo: number;
  title: string;
  isDraft?: boolean;
  status: ProposalStatus;
  content: string;
  durationText: string | null;
  amount: number;
  paymentMethodText: string | null;
  paymentTerms: string | null;
  paymentDeadline: string | null;
  bankInfo: string | null;
  issuedAt: string;
  validUntil: string | null;
  expired: boolean;
  contact: { name: string; company: string | null; phoneMasked: string | null };
  acceptedByName: string | null;
  acceptedAt: string | null;
  attachments: Array<{ id: string; title: string; mimeType: string | null; sizeBytes: number | null; isImage: boolean; externalUrl: string | null }>;
  comments: Array<{ id: string; authorType: "CUSTOMER" | "STAFF"; authorName: string | null; kind: string; body: string; createdAt: string }>;
};

export function fetchPublicProposal(slug: string, token: string, headers?: Record<string, string>) {
  return apiFetch<PublicProposalView>(`/public/tenants/${slug}/proposals/${token}`, { headers });
}
export function publicProposalFileUrl(slug: string, token: string, attachmentId: string) {
  return `${API_URL}/public/tenants/${slug}/proposals/${token}/files/${attachmentId}`;
}
export function acceptPublicProposal(slug: string, token: string, data: { name: string; signatureDataUrl: string; confirmed: boolean }) {
  return apiFetch<{ success: boolean }>(`/public/tenants/${slug}/proposals/${token}/accept`, { method: "POST", body: JSON.stringify(data) });
}
export function rejectPublicProposal(slug: string, token: string, data: { reason?: string; name?: string }) {
  return apiFetch<{ success: boolean }>(`/public/tenants/${slug}/proposals/${token}/reject`, { method: "POST", body: JSON.stringify(data) });
}
export function commentPublicProposal(slug: string, token: string, data: { body: string; name?: string; requestRevision?: boolean }) {
  return apiFetch<PublicProposalView["comments"][number]>(`/public/tenants/${slug}/proposals/${token}/comments`, { method: "POST", body: JSON.stringify(data) });
}

// ── مالیات و صورتحساب الکترونیکی — سامانه مودیان (tax) ───────────────────────

export type TaxInvoiceStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "QUEUED" | "SENT" | "ACCEPTED" | "REJECTED" | "FAILED" | "CANCELLED";
export type TaxInvoiceSubject = "ORIGINAL" | "CORRECTION" | "CANCELLATION" | "RETURN";
export type TaxEnvironment = "SANDBOX" | "PRODUCTION";

export type TaxIssue = { code: string; severity: "BLOCKING" | "WARNING"; message: string; field?: string; lineIndex?: number };
export type TaxMappedError = { code: string | null; detail: string | null; fa: string; transient?: boolean };

export type TaxInvoiceListItem = {
  id: string;
  salesInvoiceId: string;
  status: TaxInvoiceStatus;
  subject: TaxInvoiceSubject;
  taxid: string | null;
  referenceNumber: string | null;
  errors: TaxMappedError[] | null;
  retryCount: number;
  approvedAt: string | null;
  sentAt: string | null;
  resultAt: string | null;
  createdAt: string;
  salesInvoice: { id: string; invoiceNo: number; officialInvoiceNo: number | null; total: number; issuedAt: string; contact: { id: string; name: string; company: string | null } };
};

export type TaxPreview = {
  payload: { header: Record<string, string | number | null>; body: Array<Record<string, string | number | null>>; payments: unknown[] };
  issues: TaxIssue[];
  blocking: boolean;
  mappingVersion: string;
  frozen: boolean;
};

export type TaxSubmissionLog = { id: string; kind: string; ok: boolean; errorCode: string | null; httpStatus: number | null; summary: Record<string, unknown> | null; createdAt: string };

export type TaxInvoiceDetail = TaxInvoiceListItem & {
  pattern: number;
  invoiceType: number;
  inno: string | null;
  irtaxid: string | null;
  uid: string;
  overrides: Record<string, string | number> | null;
  normalizedHash: string | null;
  mappingVersion: string | null;
  environment: TaxEnvironment | null;
  preview: TaxPreview;
  issues: TaxIssue[];
  logs: TaxSubmissionLog[];
  approval: { id: string; status: string; decisionNote: string | null; decidedAt: string | null } | null;
  chain: Array<{ id: string; subject: TaxInvoiceSubject; status: TaxInvoiceStatus; taxid: string | null }>;
};

export type TaxSettings = {
  economicCode: string | null;
  fiscalId: string | null;
  taxpayerName: string | null;
  postalCode: string | null;
  branchCode: string | null;
  environment: TaxEnvironment;
  sendingEnabled: boolean;
  sandboxBaseUrl: string | null;
  defaultVatRate: number | null;
  defaultSstid: string | null;
  defaultUnitCode: number | null;
  hasPrivateKey: boolean;
  keyFingerprint: string | null;
  hasCertificate: boolean;
  certFingerprint: string | null;
  certValidTo: string | null;
  signatureKeyId: string | null;
  serverPublicKeyId: string | null;
  serverKeyFetchedAt: string | null;
  verifiedAgainstSandboxAt: string | null;
  secretsKeyConfigured: boolean;
  realSendingDisabled: boolean;
  readiness: Array<{ key: string; ok: boolean; label: string }>;
};

export type TaxStatus = { environment: TaxEnvironment; sendingEnabled: boolean; realSendingDisabled: boolean; verifiedAgainstSandboxAt: string | null };

export type TaxProductRow = { id: string; sku: string; name: string; unit: string; taxCode: { sstid: string; unitCode: number; vatRate: number | null; updatedAt: string } | null };

export type TaxSettingsInput = Partial<{
  economicCode: string;
  fiscalId: string;
  taxpayerName: string;
  postalCode: string;
  branchCode: string;
  environment: TaxEnvironment;
  sendingEnabled: boolean;
  sandboxBaseUrl: string;
  defaultVatRate: number | null;
  defaultSstid: string;
  defaultUnitCode: number | null;
}>;

export function fetchTaxStatus() {
  return apiFetch<TaxStatus>("/tax/status");
}
export function fetchTaxSettings() {
  return apiFetch<TaxSettings>("/tax/settings");
}
export function saveTaxSettings(data: TaxSettingsInput) {
  return apiFetch<TaxSettings>("/tax/settings", { method: "PUT", body: JSON.stringify(data) });
}
export function uploadTaxKey(data: { privateKeyPem: string; certificatePem?: string; signatureKeyId?: string }) {
  return apiFetch<TaxSettings>("/tax/settings/key", { method: "PUT", body: JSON.stringify(data) });
}
export function removeTaxKey() {
  return apiFetch<TaxSettings>("/tax/settings/key", { method: "DELETE" });
}
export function refreshTaxServerKey() {
  return apiFetch<TaxSettings>("/tax/settings/refresh-server-key", { method: "POST" });
}
export function fetchTaxInvoices(filters: { q?: string; status?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return apiFetch<TaxInvoiceListItem[]>(`/tax/invoices${qs ? `?${qs}` : ""}`);
}
export function fetchTaxInvoice(id: string) {
  return apiFetch<TaxInvoiceDetail>(`/tax/invoices/${id}`);
}
export function createTaxInvoice(salesInvoiceId: string) {
  return apiFetch<TaxInvoiceDetail>("/tax/invoices", { method: "POST", body: JSON.stringify({ salesInvoiceId }) });
}
export function updateTaxInvoice(id: string, data: { taxid?: string; overrides?: Record<string, string | number> }) {
  return apiFetch<TaxInvoiceDetail>(`/tax/invoices/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function taxInvoiceAction(id: string, action: "validate" | "request-approval" | "approve" | "reject" | "send" | "inquire" | "resend" | "discard", body?: { note?: string }) {
  return apiFetch<TaxInvoiceDetail>(`/tax/invoices/${id}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) });
}
export function chainTaxInvoice(id: string, kind: "CANCELLATION" | "CORRECTION", taxid?: string) {
  return apiFetch<TaxInvoiceDetail>(`/tax/invoices/${id}/chain`, { method: "POST", body: JSON.stringify({ kind, ...(taxid ? { taxid } : {}) }) });
}
export function fetchTaxProductCodes(filters: { q?: string; unmapped?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.unmapped) params.set("unmapped", "1");
  const qs = params.toString();
  return apiFetch<TaxProductRow[]>(`/tax/product-codes${qs ? `?${qs}` : ""}`);
}
export function saveTaxProductCode(data: { productId: string; sstid: string; unitCode: number; vatRate?: number | null }) {
  return apiFetch<{ id: string }>("/tax/product-codes", { method: "PUT", body: JSON.stringify(data) });
}
export function removeTaxProductCode(productId: string) {
  return apiFetch<{ success: boolean }>(`/tax/product-codes/${productId}`, { method: "DELETE" });
}
