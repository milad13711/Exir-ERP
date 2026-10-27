import { apiFetch, downloadExcelFile } from "@/lib/api";
import type { TaskPriority, TaskStatus } from "@/lib/api";

export type OpsScope = "all" | "own";

export type OpsOverview = {
  scope: OpsScope;
  range: { from: string; to: string };
  counters: {
    new: number;
    seenNotStarted: number;
    inProgress: number;
    overdue: number;
    awaitingApproval: number;
    returnedForFix: number;
    hasProblem: number;
    extensionPending: number;
    scheduled: number;
    doneToday: number;
    doneThisWeek: number;
  };
  stats: { created: number; completed: number; completionRate: number | null; avgCompletionHours: number | null; onTimeRate: number | null };
  generatedAt: string;
};

export type OpsChip = "overloaded" | "has_overdue" | "idle" | "ok";
export type OpsWorkloadRow = {
  userId: string;
  name: string;
  openCount: number;
  overdueCount: number;
  awaitingApprovalCount: number;
  doneInRange: number;
  avgCompletionHours: number | null;
  lastActivityAt: string | null;
  chips: OpsChip[];
};
export type OpsWorkloadSort = "open" | "overdue" | "done" | "avg" | "last" | "name";
export type OpsWorkload = { scope: OpsScope; currentUserId: string | null; rows: OpsWorkloadRow[] };

export type OpsAttentionKind = "problem" | "extension" | "approval" | "overdue" | "unseen" | "scheduled";
export type OpsAttentionItem = {
  kind: OpsAttentionKind;
  taskId: string;
  code: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  since: string;
  ageHours: number;
  score: number;
  detail: string | null;
  assignees: Array<{ userId: string; name: string }>;
  /** تیک دریافت/مشاهده (فقط مدیر/سازنده) */
  tick?: "none" | "sent" | "delivered" | "seen" | null;
  extension: { id: string; proposedDueAt: string; reason: string | null; requestedByName: string } | null;
};
export type OpsAttention = { scope: OpsScope; unseenHours: number; items: OpsAttentionItem[] };

export type OpsActivityItem = {
  id: string;
  taskId: string;
  code: string;
  taskTitle: string;
  type: string;
  label: string;
  actorUserId: string | null;
  actorName: string;
  note: string | null;
  createdAt: string;
};
export type OpsActivity = { items: OpsActivityItem[]; nextCursor: string | null };

export type OpsTrend = {
  scope: OpsScope;
  days: number;
  series: Array<{ date: string; created: number; completed: number }>;
  byPriority: Record<TaskPriority, { created: number; completed: number }>;
};

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fetchOpsOverview = (from?: string, to?: string) => apiFetch<OpsOverview>(`/operations/overview${qs({ from, to })}`);
/** فقط شمارنده‌ها (سبک) — برای ویجت داشبورد. */
export const fetchOpsCounters = () => apiFetch<{ scope: OpsScope; counters: OpsOverview["counters"]; generatedAt: string }>("/operations/counters");
export const fetchOpsWorkload = (o: { from?: string; to?: string; sort?: OpsWorkloadSort; dir?: "asc" | "desc" }) => apiFetch<OpsWorkload>(`/operations/workload${qs(o)}`);
export const fetchOpsAttention = () => apiFetch<OpsAttention>("/operations/attention");
export const fetchOpsActivity = (cursor?: string) => apiFetch<OpsActivity>(`/operations/activity${qs({ cursor, limit: 25 })}`);
export const fetchOpsTrend = (days: number) => apiFetch<OpsTrend>(`/operations/trend${qs({ days })}`);
export const downloadOpsCsv = (from?: string, to?: string) => downloadExcelFile(`/operations/export${qs({ from, to })}`, "operations-tasks.csv");
