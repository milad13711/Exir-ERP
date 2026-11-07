import { apiFetch } from "@/lib/api";

export type ReleaseStatus = "DRAFT" | "PUBLISHED";
export type ChangeType = "NEW" | "IMPROVED" | "FIX";

export type ReleaseChangeInput = { type: ChangeType; title: string; description: string; valueText: string; deepLink: string };

export type ReleaseRow = {
  id: string;
  shortCode: string;
  moduleCode: string;
  moduleName: string;
  version: string;
  title: string;
  summary: string;
  status: ReleaseStatus;
  publishedAt: string | null;
  createdAt: string;
  changeCount: number;
};

export type ReleaseFull = Omit<ReleaseRow, "changeCount"> & {
  channels: { notify?: boolean; ticket?: boolean; sms?: boolean } | null;
  changes: Array<{ id: string; type: ChangeType; title: string; description: string; valueText: string; deepLink: string | null }>;
};

export type ReleaseMeta = {
  modules: Array<{ code: string; name: string; version: string; route: string | null }>;
  routeRoots: string[];
  types: ChangeType[];
};

export type Channels = { notify: boolean; ticket: boolean; sms: boolean };

export type RecipientsPreview = {
  tenants: number;
  smsReady: number;
  optedOut: { notify: number; ticket: number; sms: number };
  sample: Array<{ id: string; name: string; slug: string }>;
};

export type ChannelOutcome = { status: string; sent: number; failed: number; reason?: string | null; attempts?: number; ticketId?: string | null; finishedAt?: string | null; retryable?: boolean };

export type DeliveryReport = {
  release: { id: string; moduleCode: string; status: string };
  running: boolean;
  totals: Record<string, Record<string, number>>;
  retryableCount: number;
  tenants: Array<{ tenantId: string; name: string; slug: string; channels: Record<string, ChannelOutcome> }>;
};

const base = "/admin/module-releases";
const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const fetchReleaseMeta = () => apiFetch<ReleaseMeta>(`${base}/meta`);
export const fetchReleases = (status?: string) => apiFetch<ReleaseRow[]>(`${base}${status ? `?status=${status}` : ""}`);
export const fetchRelease = (id: string) => apiFetch<ReleaseFull>(`${base}/${id}`);
export const createRelease = (d: { moduleCode: string; version: string; title: string; summary: string; changes: ReleaseChangeInput[] }) =>
  apiFetch<ReleaseFull>(base, { method: "POST", ...json(d) });
export const updateRelease = (id: string, d: { title: string; summary: string; changes: ReleaseChangeInput[] }) =>
  apiFetch<ReleaseFull>(`${base}/${id}`, { method: "PATCH", ...json(d) });
export const deleteRelease = (id: string) => apiFetch<{ success: boolean }>(`${base}/${id}`, { method: "DELETE" });
export const fetchRecipients = (id: string) => apiFetch<RecipientsPreview>(`${base}/${id}/recipients`);
export const publishRelease = (id: string, channels: Channels) => apiFetch<{ success: boolean }>(`${base}/${id}/publish`, { method: "POST", ...json({ channels, confirm: true }) });
export const retryRelease = (id: string) => apiFetch<{ success: boolean }>(`${base}/${id}/retry`, { method: "POST" });
export const testSendRelease = (id: string, tenantId: string, channels: Channels) =>
  apiFetch<Record<string, ChannelOutcome>>(`${base}/${id}/test-send`, { method: "POST", ...json({ tenantId, channels }) });
export const fetchDeliveryReport = (id: string) => apiFetch<DeliveryReport>(`${base}/${id}/report`);
