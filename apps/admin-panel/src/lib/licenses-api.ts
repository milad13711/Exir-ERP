import { apiFetch, getToken } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export type EffectiveStatus = "active" | "expired" | "suspended" | "revoked";

export type LicenseRow = {
  id: string;
  licenseKey: string | null;
  orgName: string;
  productName: string;
  edition: string | null;
  customerName: string | null;
  customerEmail: string | null;
  notes: string | null;
  tenantId: string | null;
  tenant?: { id: string; name: string; slug: string } | null;
  allowedModules: string[];
  seats: number;
  maxActivations: number;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  effectiveStatus: EffectiveStatus;
  issuedAt: string;
  expiresAt: string | null;
  updatesUntil: string | null;
  graceDays: number;
  integrityPolicy: "WARN" | "LOCK";
  revokedAt: string | null;
  revokedReason: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletedAt: string | null;
  hasOfflineToken: boolean;
  lastCheckInAt: string | null;
  lastCheckInIp: string | null;
  lastAppVersion: string | null;
  lastTamperStatus: string | null;
  activationCount: number;
};

export type LicenseList = { total: number; page: number; pageSize: number; items: LicenseRow[] };

export type LicenseActivationRow = {
  id: string;
  identifier: string;
  ip: string | null;
  appVersion: string | null;
  tamperStatus: string | null;
  lastTelemetry: { users?: number; modules?: number; runtimeState?: string; clockRollback?: boolean } | null;
  activatedAt: string;
  lastCheckAt: string;
};

export type LicenseEventRow = {
  id: string;
  licenseId: string | null;
  licenseKeyHint: string | null;
  kind: "ADMIN" | "PUBLIC" | "CHECKIN" | "SYSTEM";
  action: string;
  code: string | null;
  actorId: string | null;
  actorLabel: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export type LicenseSettings = {
  apiEnabled: boolean;
  tokenValidityDays: number;
  auditSampleEvery: number;
  crlVersion: number;
  signing: { configured: boolean; kid: string | null; publicKeyPem: string | null };
};

export type LicenseInput = {
  orgName: string;
  productName?: string;
  edition?: string;
  customerName?: string;
  customerEmail?: string;
  notes?: string;
  tenantId?: string;
  modules: string[];
  seats?: number;
  maxActivations?: number;
  expiresAt?: string;
  updatesUntil?: string;
  graceDays?: number;
  integrityPolicy?: "WARN" | "LOCK";
};

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export type LicenseFilters = { q?: string; status?: string; page?: number; pageSize?: number; includeDeleted?: boolean };

export const fetchLicenseList = (f: LicenseFilters) =>
  apiFetch<LicenseList>(`/admin/licenses${qs({ q: f.q, status: f.status, page: f.page, pageSize: f.pageSize, includeDeleted: f.includeDeleted ? "true" : undefined })}`);

export const createLicense = (d: LicenseInput) => apiFetch<LicenseRow>("/admin/licenses", { method: "POST", body: JSON.stringify(d) });

export const updateLicense = (id: string, d: Partial<Omit<LicenseInput, "expiresAt" | "updatesUntil">>) =>
  apiFetch<LicenseRow>(`/admin/licenses/${id}`, { method: "PATCH", body: JSON.stringify(d) });

export const renewLicense = (id: string, d: { expiresAt?: string; extendDays?: number; perpetual?: boolean; updatesUntil?: string; updatesUnlimited?: boolean }) =>
  apiFetch<LicenseRow>(`/admin/licenses/${id}/renew`, { method: "POST", body: JSON.stringify(d) });

export const suspendLicense = (id: string, reason: string) => apiFetch<LicenseRow>(`/admin/licenses/${id}/suspend`, { method: "POST", body: JSON.stringify({ reason }) });
export const resumeLicense = (id: string) => apiFetch<LicenseRow>(`/admin/licenses/${id}/resume`, { method: "POST" });
export const revokeLicense = (id: string, reason: string) => apiFetch<LicenseRow>(`/admin/licenses/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
export const deleteLicense = (id: string, reason: string) => apiFetch<{ ok: true }>(`/admin/licenses/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });

export const fetchActivations = (id: string) => apiFetch<LicenseActivationRow[]>(`/admin/licenses/${id}/activations`);
export const releaseActivation = (id: string, activationId: string) => apiFetch<{ ok: true }>(`/admin/licenses/${id}/activations/${activationId}`, { method: "DELETE" });

export const issueOfflineToken = (id: string, d: { installationId: string; validityDays: number; reason: string }) =>
  apiFetch<{ token: string; expiresAt: string }>(`/admin/licenses/${id}/offline-token`, { method: "POST", body: JSON.stringify(d) });

export const fetchLicenseEvents = (f: { licenseId?: string; kind?: string; page?: number; pageSize?: number }) =>
  apiFetch<{ total: number; page: number; pageSize: number; items: LicenseEventRow[] }>(`/admin/licenses/events${qs(f)}`);

export const fetchLicenseSettings = () => apiFetch<LicenseSettings>("/admin/licenses/settings");
export const updateLicenseSettings = (d: Partial<Pick<LicenseSettings, "apiEnabled" | "tokenValidityDays" | "auditSampleEvery">>) =>
  apiFetch<LicenseSettings>("/admin/licenses/settings", { method: "PATCH", body: JSON.stringify(d) });

/** دانلود CSV با توکن ادمین (لینک مستقیم نمی‌شود چون Authorization header لازم است). */
export async function downloadLicensesCsv(f: LicenseFilters): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/admin/licenses/export.csv${qs({ q: f.q, status: f.status })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("خروجی CSV ناموفق بود");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "licenses.csv";
  a.click();
  URL.revokeObjectURL(url);
}
