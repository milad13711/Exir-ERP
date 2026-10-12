"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { TaskModal } from "@/components/tasks/TaskModal";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { FIELD, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from "@/components/tasks/task-ui";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchTasks, fetchTaskSummary, fetchTaskSettings, updateTaskSettings, fetchUsers, deleteTask, type ApiTask, type TaskSummary, type TenantUser } from "@/lib/api";

const COUNTERS: Array<{ key: keyof TaskSummary; label: string; status: string; tone: string }> = [
  { key: "new", label: "جدید", status: "NEW,SEEN", tone: "text-primary" },
  { key: "inProgress", label: "در حال انجام", status: "IN_PROGRESS,RETURNED_FOR_FIX", tone: "text-accent" },
  { key: "overdue", label: "دارای تأخیر", status: "OVERDUE", tone: "text-danger" },
  { key: "awaitingApproval", label: "منتظر تأیید", status: "DONE", tone: "text-warning" },
  { key: "hasProblem", label: "دارای مشکل", status: "HAS_PROBLEM", tone: "text-danger" },
  { key: "doneToday", label: "انجام‌شده‌ی امروز", status: "DONE,APPROVED", tone: "text-success" },
];

const STATUS_OPTIONS = ["NEW", "SEEN", "IN_PROGRESS", "DONE", "APPROVED", "HAS_PROBLEM", "RETURNED_FOR_FIX", "EXPIRED", "CANCELLED"] as const;

export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [modalTask, setModalTask] = useState<ApiTask | null | undefined>(undefined); // undefined = بسته، null = وظیفه‌ی جدید

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState("");

  const debouncedSearch = useDebouncedValue(search, 300);
  const beginRequest = useRequestGuard();
  const filterKey = JSON.stringify([debouncedSearch.trim(), status, priority, assigneeId, from, to, reloadKey]);
  const loading = loadedKey !== filterKey;

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchTaskSettings().then((s) => setPrefix(s.numberPrefix)).catch(() => {});
    // لینک عمیق اعلان‌ها: /tasks?open=<id>
    const params = new URLSearchParams(window.location.search);
    // لینک شمارنده‌های داشبورد عملیات: /tasks?status=OVERDUE&priority=URGENT&assigneeId=...
    void Promise.resolve().then(() => {
      const st = params.get("status");
      if (st && /^[A-Z_,]+$/.test(st)) setStatus(st);
      const pr = params.get("priority");
      if (pr && ["NORMAL", "MEDIUM", "URGENT"].includes(pr)) setPriority(pr);
      const as = params.get("assigneeId");
      if (as && /^[0-9a-fA-F-]{36}$/.test(as)) setAssigneeId(as);
    });
    const id = params.get("open");
    if (id) void Promise.resolve().then(() => setModalTask({ id, title: "", dueAt: null, priority: "NORMAL", status: "NEW", createdAt: "", completedAt: null }));
  }, []);

  useEffect(() => {
    const isCurrent = beginRequest();
    const requested = filterKey;
    fetchTasks({
      q: debouncedSearch.trim() || undefined,
      status: status || undefined,
      priority: priority || undefined,
      assigneeId: assigneeId || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    })
      .then((r) => isCurrent() && setTasks(r))
      .catch(() => isCurrent() && setTasks((prev) => prev ?? []))
      .finally(() => isCurrent() && setLoadedKey(requested));
    fetchTaskSummary(assigneeId || undefined).then((s) => isCurrent() && setSummary(s)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, beginRequest]);

  async function savePrefix() {
    try {
      const r = await updateTaskSettings(prefixDraft.trim());
      setPrefix(r.numberPrefix);
      setPrefixOpen(false);
      setReloadKey((k) => k + 1);
    } catch {
      window.alert("پیشوند فقط می‌تواند حروف/ارقام لاتین (حداکثر ۱۰ نویسه) باشد");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این وظیفه حذف شود؟")) return;
    await deleteTask(id);
    setReloadKey((k) => k + 1);
  }

  function handleSaved(saved: ApiTask) {
    setTasks((prev) => {
      const list = prev ?? [];
      return list.some((t) => t.id === saved.id) ? list.map((t) => (t.id === saved.id ? { ...t, ...saved } : t)) : list;
    });
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="p-5 lg:p-7 max-w-[980px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">وظایف و یادآوری</h1>
            <ModuleHelp code="tasks" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">ارجاع، پیگیری و تأیید وظایف تیم در یک‌جا</p>
        </div>
        <button onClick={() => setModalTask(null)} className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
          <PlusIcon className="w-4 h-4" />
          ثبت وظیفه
        </button>
      </div>

      {tasks?.some((t) => t.role?.manager) && prefix ? (
        <div className="mt-3 text-[12px] text-muted flex items-center gap-2 flex-wrap">
          پیشوند شماره‌ی وظایف: <span className="font-mono font-bold text-ink" dir="ltr">{prefix}</span>
          {prefixOpen ? (
            <>
              <input value={prefixDraft} onChange={(e) => setPrefixDraft(e.target.value)} dir="ltr" maxLength={10} className="w-28 text-[12px] bg-slate-50 border border-border rounded-lg px-2 py-1" />
              <button type="button" onClick={savePrefix} className="font-bold text-primary cursor-pointer">ذخیره</button>
              <button type="button" onClick={() => setPrefixOpen(false)} className="cursor-pointer">انصراف</button>
            </>
          ) : (
            <button type="button" onClick={() => { setPrefixDraft(prefix); setPrefixOpen(true); }} className="font-bold text-primary cursor-pointer">تغییر</button>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-5">
        {COUNTERS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setStatus(status === c.status ? "" : c.status)}
            className={clsx("bg-surface border rounded-2xl p-3 text-right cursor-pointer", status === c.status ? "border-primary" : "border-border")}
          >
            <div className={clsx("text-[20px] font-extrabold", c.tone)}>{summary ? summary[c.key].toLocaleString("fa-IR") : "–"}</div>
            <div className="text-[11.5px] text-muted mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 mt-4">
        <SearchInput value={search} onChange={setSearch} loading={loading} placeholder="جستجو در عنوان، توضیحات، شماره (مثلاً TASK-000125)" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={FIELD} aria-label="ارجاع‌گیرنده">
            <option value="">همه‌ی افراد</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={COUNTERS.some((c) => c.status === status) ? "" : status} onChange={(e) => setStatus(e.target.value)} className={FIELD} aria-label="وضعیت">
            <option value="">همه‌ی وضعیت‌ها</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="OVERDUE">دارای تأخیر</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={FIELD} aria-label="اولویت">
            <option value="">همه‌ی اولویت‌ها</option>
            <option value="NORMAL">عادی</option>
            <option value="MEDIUM">مهم</option>
            <option value="URGENT">فوری</option>
          </select>
          <JalaliDateInput value={from} onChange={setFrom} placeholder="موعد از تاریخ" />
          <JalaliDateInput value={to} onChange={setTo} placeholder="موعد تا تاریخ" />
        </div>
        {status || priority || assigneeId || from || to ? (
          <button
            type="button"
            onClick={() => {
              setStatus("");
              setPriority("");
              setAssigneeId("");
              setFrom("");
              setTo("");
            }}
            className="text-[12px] font-bold text-primary self-start cursor-pointer"
          >
            حذف فیلترها
          </button>
        ) : null}
      </div>

      <Card className="mt-4 p-2">
        <div className="flex flex-col">
          {tasks === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">وظیفه‌ای با این شرایط پیدا نشد</div>
          ) : (
            tasks.map((task, i) => {
              const items = task.checklist ?? [];
              const doneItems = items.filter((c) => c.done).length;
              const names = (task.assignees ?? []).map((a) => a.name);
              return (
                <div key={task.id} className={clsx("flex items-center gap-3 px-4 py-3.5", i < tasks.length - 1 && "border-b border-border")}>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setModalTask(task)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted font-mono" dir="ltr">{task.code}</span>
                      <span className={clsx("text-[13.5px] font-semibold", (task.status === "APPROVED" || task.status === "CANCELLED") && "text-muted line-through")}>{task.title}</span>
                    </div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {task.dueAt ? <span className={clsx(task.isOverdue && "text-danger font-bold")}>موعد: {formatJalaliDateTime(task.dueAt)}</span> : `ایجاد: ${formatJalaliDateTime(task.createdAt)}`}
                      {names.length ? ` · ${names.slice(0, 2).join("، ")}${names.length > 2 ? ` و ${names.length - 2} نفر دیگر` : ""}` : ""}
                      {items.length > 0 ? ` · چک‌لیست ${doneItems}/${items.length}` : ""}
                      {task.isPublished === false ? " · ارسال زمان‌بندی‌شده" : ""}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                  {task.priority !== "NORMAL" ? <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge> : null}
                  {task.role?.canManage ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(task.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
                      aria-label="حذف وظیفه"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {modalTask !== undefined ? (
        <TaskModal key={modalTask?.id ?? "new"} task={modalTask} onClose={() => setModalTask(undefined)} onSaved={handleSaved} />
      ) : null}
    </div>
  );
}
