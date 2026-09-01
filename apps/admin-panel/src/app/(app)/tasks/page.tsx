"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, ClockIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchInternalTasks,
  createInternalTask,
  toggleInternalTask,
  fetchStaff,
  type InternalTask,
  type StaffMember,
} from "@/lib/api";

export default function TasksPage() {
  const [tasks, setTasks] = useState<InternalTask[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    fetchInternalTasks().then(setTasks).catch(() => setTasks([]));
  }
  useEffect(reload, []);
  useEffect(() => {
    fetchStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await createInternalTask({
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        assignedToId: assignedToId || undefined,
      });
      setTitle("");
      setDueAt("");
      setAssignedToId("");
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(id: string) {
    await toggleInternalTask(id);
    reload();
  }

  const open = tasks?.filter((t) => t.status === "OPEN") ?? [];
  const done = tasks?.filter((t) => t.status === "DONE") ?? [];

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <h1 className="text-xl font-extrabold">وظایف داخلی تیم</h1>
      <p className="text-[13.5px] text-muted mt-1">یادآوری و ارجاع کارها به اعضای تیم مدیریت</p>

      <Card className="mt-5 p-4">
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان وظیفه..."
            className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            className="text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          >
            <option value="">ارجاع به...</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="flex items-center justify-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <PlusIcon className="w-4 h-4" />
            افزودن
          </button>
        </form>
      </Card>

      <Card className="mt-4 p-2">
        {tasks === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : open.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">وظیفه‌ی بازی نیست</div>
        ) : (
          open.map((t, i) => <TaskRow key={t.id} task={t} onToggle={handleToggle} isLast={i === open.length - 1} />)
        )}
      </Card>

      {done.length > 0 ? (
        <Card className="mt-4 p-2 opacity-70">
          {done.map((t, i) => (
            <TaskRow key={t.id} task={t} onToggle={handleToggle} isLast={i === done.length - 1} />
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function TaskRow({ task, onToggle, isLast }: { task: InternalTask; onToggle: (id: string) => void; isLast: boolean }) {
  const done = task.status === "DONE";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isLast ? "" : "border-b border-border"}`}>
      <button
        onClick={() => onToggle(task.id)}
        className={`w-6 h-6 rounded-lg border flex items-center justify-center cursor-pointer shrink-0 ${
          done ? "bg-success border-success text-white" : "border-border text-transparent hover:border-primary"
        }`}
      >
        <CheckIcon className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold ${done ? "line-through text-muted" : ""}`}>{task.title}</div>
        <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
          {task.assignedTo ? <span>ارجاع به {task.assignedTo.name}</span> : <span>بدون ارجاع</span>}
          {task.dueAt ? (
            <span className="flex items-center gap-1">
              <ClockIcon className="w-3 h-3" />
              {formatJalaliDateTime(task.dueAt)}
            </span>
          ) : null}
        </div>
      </div>
      {!done && task.dueAt && new Date(task.dueAt) < new Date() ? <Badge tone="danger">عقب‌افتاده</Badge> : null}
    </div>
  );
}
