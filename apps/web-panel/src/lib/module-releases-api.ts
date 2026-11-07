import { apiFetch } from "@/lib/api";

export type ReleaseChangeType = "NEW" | "IMPROVED" | "FIX";

export type ReleaseListItem = {
  id: string;
  shortCode: string;
  moduleCode: string;
  moduleName: string;
  version: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  changeCount: number;
  route: string | null;
  unread: boolean;
};

export type ReleaseChange = {
  id: string;
  type: ReleaseChangeType;
  title: string;
  description: string;
  valueText: string;
  deepLink: string | null;
};

export type ReleaseDetail = {
  id: string;
  shortCode: string;
  moduleCode: string;
  moduleName: string;
  version: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  isDraftPreview: boolean;
  route: string | null;
  unread: boolean;
  changes: ReleaseChange[];
};

export type ReleasePrefs = { notify: boolean; ticket: boolean; sms: boolean };

export const fetchReleases = () => apiFetch<{ unreadCount: number; items: ReleaseListItem[] }>("/module-releases");
export const fetchReleasesUnread = () => apiFetch<{ unreadCount: number }>("/module-releases/unread-count");
export const fetchReleaseDetail = (code: string) => apiFetch<ReleaseDetail>(`/module-releases/${encodeURIComponent(code)}`);
export const markReleaseRead = (id: string) => apiFetch<{ success: boolean }>(`/module-releases/${encodeURIComponent(id)}/read`, { method: "POST" });
export const markAllReleasesRead = () => apiFetch<{ success: boolean }>("/module-releases/read-all", { method: "POST" });
export const fetchReleasePrefs = () => apiFetch<ReleasePrefs>("/module-releases/settings");
export const saveReleasePrefs = (p: Partial<ReleasePrefs>) => apiFetch<ReleasePrefs>("/module-releases/settings", { method: "PUT", body: JSON.stringify(p) });

/** فقط مسیر نسبی داخلی پنل؛ هر چیز دیگر (آدرس کامل، //، اسکیم) رد می‌شود (دفاع در عمق کنار بک‌اند). */
export function safeInternalPath(p: string | null | undefined): string | null {
  if (!p) return null;
  return /^\/[a-z0-9][a-z0-9\-/]*(\?[A-Za-z0-9_\-=&.]*)?$/.test(p) && !p.includes("//") && !p.includes("..") ? p : null;
}

export const RELEASE_TYPE_META: Record<ReleaseChangeType, { label: string; tone: "success" | "primary" | "warning" }> = {
  NEW: { label: "جدید", tone: "success" },
  IMPROVED: { label: "بهبود", tone: "primary" },
  FIX: { label: "رفع مشکل", tone: "warning" },
};
