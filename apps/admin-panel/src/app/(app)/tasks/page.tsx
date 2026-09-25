"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { Card } from "@/components/ui/Card";
import { INPUT, SELECT, BTN_PRIMARY } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, ClockIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchInternalTasks,
  createInternalTask,
  toggleInternalTask,
  updateInternalTask,
  deleteInternalTask,
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

  async function handleEdit(id: string, patch: { title?: string; description?: string; dueAt?: string; assignedToId?: string }) {
    await updateInternalTask(id, patch);
    reload();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این وظیفه حذف شود؟")) return;
    await deleteInternalTask(id);
    reload();
  }

  async function handleToggle(id: string) {
    await toggleInternalTask(id);
    reload();
  }

  const open = tasks?.filter((t) => t.status === "OPEN") ?? [];
  const done = tasks?.filter((t) => t.status === "DONE") ?? [];

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="وظایف داخلی تیم" subtitle="یادآوری و ارجاع کارها به اعضای تیم مدیریت" />

      <Card className="mt-5 p-4">
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان وظیفه..."
            className={`${INPUT} flex-1`}
          />
          <div className="sm:w-[230px]">
            <JalaliDateTimeInput value={dueAt} onChange={setDueAt} placeholder="سررسید (اختیاری)" />
          </div>
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            className={SELECT}
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
            className={BTN_PRIMARY}
          >
            <PlusIcon className="w-4 h-4" />
            افزودن
          </button>
        </form>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {tasks === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : open.length === 0 ? (
          <div className="p-10 text-center text-muted text-sm flex flex-col items-center gap-2">
            <span className="w-12 h-12 rounded-2xl bg-success-soft text-success flex items-center justify-center">
              <CheckIcon className="w-6 h-6" />
            </span>
            وظیفه‌ی بازی نیست
          </div>
        ) : (
          open.map((t, i) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} staff={staff} isLast={i === open.length - 1} />)
        )}
      </Card>

      {done.length > 0 ? (
        <Card className="mt-4 overflow-hidden opacity-70">
          {done.map((t, i) => (
            <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} staff={staff} isLast={i === done.length - 1} />
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
  staff,
  isLast,
}: {
  task: InternalTask;
  onToggle: (id: string) => void;
  onEdit: (id: string, patch: { title?: string; description?: string; dueAt?: string; assignedToId?: string }) => Promise<void>;
  onDelete: (id: string) => void;
  staff: StaffMember[];
  isLast: boolean;
}) {
  const done = task.status === "DONE";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [editDue, setEditDue] = useState(task.dueAt ?? "");
  const [editAssignee, setEditAssignee] = useState(task.assignedTo?.id ?? "");
  return (
    <div className={`flex items-start gap-3 px-4 py-3.5 flex-wrap sm:flex-nowrap ${isLast ? "" : "border-b border-border"}`}>
      <button
        onClick={() => onToggle(task.id)}
        className={`w-6 h-6 rounded-lg border flex items-center justify-center cursor-pointer shrink-0 ${
          done ? "bg-success border-success text-white" : "border-border text-transparent hover:border-primary"
        }`}
      >
        <CheckIcon className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0 basis-[calc(100%-3rem)] sm:basis-auto">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="توضیحات" className="text-[12px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5" />
            <JalaliDateTimeInput value={editDue} onChange={setEditDue} placeholder="موعد انجام" />
            <select value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)} className="text-[12px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5">
              <option value="">بدون ارجاع</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={async () => { await onEdit(task.id, { title, description, dueAt: editDue ? new Date(editDue).toISOString() : undefined, assignedToId: editAssignee || undefined }); setEditing(false); }} className="text-[11.5px] font-bold text-white bg-primary px-3 py-1 rounded-lg cursor-pointer">ذخیره</button>
              <button onClick={() => setEditing(false)} className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1 rounded-lg cursor-pointer">انصراف</button>
            </div>
          </div>
        ) : (
          <>
        <div className={`text-[13px] font-semibold ${done ? "line-through text-muted" : ""}`}>{task.title}</div>
        {task.description ? <div className="text-[11.5px] text-ink-soft mt-0.5">{task.description}</div> : null}
        <div className="text-[11px] text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {task.assignedTo ? <span>ارجاع به {task.assignedTo.name}</span> : <span>بدون ارجاع</span>}
          {task.ticket ? (
            <Link href={`/support/${task.ticket.id}`} className="text-primary font-bold">
              تیکت: {task.ticket.subject}
            </Link>
          ) : null}
          {task.dueAt ? (
            <span className="flex items-center gap-1">
              <ClockIcon className="w-3 h-3" />
              {formatJalaliDateTime(task.dueAt)}
            </span>
          ) : null}
        </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-1.5 shrink-0 max-sm:w-full max-sm:ps-9">
          <button onClick={() => setEditing(true)} className="text-[11px] font-bold text-ink-soft bg-slate-100 px-2.5 py-1 rounded-lg cursor-pointer">ویرایش</button>
          <button onClick={() => onDelete(task.id)} className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer">حذف</button>
        </div>
      )}
      {!done && task.dueAt && new Date(task.dueAt) < new Date() ? <Badge tone="danger">عقب‌افتاده</Badge> : null}
    </div>
  );
}
