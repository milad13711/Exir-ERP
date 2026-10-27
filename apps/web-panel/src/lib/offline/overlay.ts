import type { OutboxItem } from "./types";

/**
 * هنگام آفلاین، لیست‌های کش‌شده را با موارد در صف «همین دستگاه» ترکیب می‌کند تا کاربر کار خودش را ببیند
 * (ردیف با نشان _queued). فقط برای چند لیست پرمصرف؛ بقیه‌ی صفحات پس از همگام‌سازی تازه می‌شوند.
 */
type Row = Record<string, unknown>;
const pendingOf = (items: OutboxItem[]) => items.filter((i) => i.status !== "done");
const body = (i: OutboxItem): Row => (i.body && typeof i.body === "object" ? (i.body as Row) : {});

export function applyOverlay(ruleKey: string, data: unknown, items: OutboxItem[], query: URLSearchParams): unknown {
  if (!Array.isArray(data)) return data;
  const pend = pendingOf(items);
  const rows = (data as Row[]).map((r) => ({ ...r }));
  if (ruleKey === "checklist") {
    const date = query.get("date");
    for (const it of pend) {
      if (it.opKey === "checklist.toggle" || it.opKey === "checklist.update") {
        const id = it.path.split("?")[0].split("/").pop();
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, body(it), { _queued: true });
      } else if (it.opKey === "checklist.create") {
        const b = body(it);
        if (!date || String(b.date ?? "").slice(0, 10) === date.slice(0, 10)) {
          rows.push({ id: it.tempId ?? it.id, done: false, priority: "NORMAL", order: 9999, createdAt: it.createdAtDevice, updatedAt: it.createdAtDevice, ...b, _queued: true });
        }
      }
    }
  } else if (ruleKey === "tasks") {
    for (const it of pend) {
      if (it.opKey === "tasks.create") {
        rows.unshift({ id: it.tempId ?? it.id, status: "NEW", number: null, createdAt: it.createdAtDevice, ...body(it), _queued: true });
      } else if (it.opKey === "tasks.start" || it.opKey === "tasks.result") {
        const id = it.path.split("?")[0].split("/")[2];
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, { status: it.opKey === "tasks.start" ? "IN_PROGRESS" : "DONE", _queued: true });
      }
    }
  }
  return rows;
}
