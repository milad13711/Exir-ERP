"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { CheckIcon, TrashIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchTasks, createTask, toggleTask, updateTask, deleteTask, fetchUsers, type ApiTask, type TenantUser } from "@/lib/api";

export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editPriority, setEditPriority] = useState<ApiTask["priority"]>("NORMAL");
  const [editAssignedUserId, setEditAssignedUserId] = useState("");

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const task = await createTask({
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        assignedUserId: assignedUserId || undefined,
      });
      setTasks((prev) => [task, ...(prev ?? [])]);
      setTitle("");
      setDueAt("");
      setAssignedUserId("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(id: string) {
    const updated = await toggleTask(id);
    setTasks((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? prev);
  }

  function startEdit(task: ApiTask) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDueAt(task.dueAt ?? "");
    setEditPriority(task.priority);
    setEditAssignedUserId(task.assignedUserId ?? "");
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim()) return;
    const updated = await updateTask(id, {
      title: editTitle.trim(),
      priority: editPriority,
      dueAt: editDueAt ? new Date(editDueAt).toISOString() : null,
      ...(editAssignedUserId ? { assignedUserId: editAssignedUserId } : {}),
    });
    setTasks((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? prev);
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("این وظیفه حذف شود؟")) return;
    await deleteTask(id);
    setTasks((prev) => prev?.filter((t) => t.id !== id) ?? prev);
  }

  return (
    <div className="p-5 lg:p-7 max-w-[860px] mx-auto">
      <h1 className="text-xl font-extrabold">وظایف و یادآوری</h1>
      <p className="text-[13.5px] text-muted mt-1">همه‌ی وظایف شما در یک‌جا، مستقل از ماژول مرتبط</p>

      <Card className="mt-6 p-2">
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-border">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="+ افزودن وظیفه‌ی جدید..."
            className="flex-1 min-w-[140px] text-[13.5px] outline-none placeholder:text-muted bg-transparent"
          />
          {title.trim() ? (
            <>
              <div className="w-[220px] shrink-0">
                <JalaliDateTimeInput value={dueAt} onChange={setDueAt} placeholder="سررسید (اختیاری)" />
              </div>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-2 py-1.5 shrink-0"
              >
                <option value="">ارجاع به خودم</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={submitting}
                className="text-[12.5px] font-bold text-primary disabled:opacity-50"
              >
                افزودن
              </button>
            </>
          ) : null}
        </form>
        <div className="flex flex-col">
          {tasks === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">هنوز وظیفه‌ای ثبت نشده است</div>
          ) : (
            tasks.map((task, i) => {
              const done = task.status === "DONE";
              const isEditing = editingId === task.id;
              return (
                <div
                  key={task.id}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3.5",
                    i < tasks.length - 1 && "border-b border-border",
                  )}
                >
                  {isEditing ? (
                    <div className="flex-1 flex flex-wrap items-center gap-2.5">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 min-w-[140px] text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5"
                      />
                      <div className="w-[200px] shrink-0">
                        <JalaliDateTimeInput value={editDueAt} onChange={setEditDueAt} placeholder="سررسید" />
                      </div>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value as ApiTask["priority"])}
                        className="text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-2 py-1.5"
                      >
                        <option value="NORMAL">عادی</option>
                        <option value="MEDIUM">متوسط</option>
                        <option value="URGENT">فوری</option>
                      </select>
                      <select
                        value={editAssignedUserId}
                        onChange={(e) => setEditAssignedUserId(e.target.value)}
                        className="text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-2 py-1.5"
                      >
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(task.id)}
                        disabled={!editTitle.trim()}
                        className="text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        ذخیره
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleToggle(task.id)}
                        className={clsx(
                          "w-5 h-5 rounded-md shrink-0 flex items-center justify-center cursor-pointer",
                          done ? "bg-success" : "border-2 border-border",
                        )}
                        aria-label={done ? "علامت‌گذاری به‌عنوان انجام‌نشده" : "علامت‌گذاری به‌عنوان انجام‌شده"}
                      >
                        {done ? <CheckIcon className="w-3 h-3 text-white" strokeWidth={3} /> : null}
                      </button>
                      <div className="flex-1 cursor-pointer" onClick={() => startEdit(task)}>
                        <div className={clsx("text-[13.5px] font-semibold", done && "text-muted line-through")}>
                          {task.title}
                        </div>
                        <div className="text-[11.5px] text-muted mt-0.5">
                          {task.dueAt
                            ? `سررسید: ${formatJalaliDateTime(task.dueAt)}`
                            : `ایجاد شده: ${formatJalaliDateTime(task.createdAt)}`}
                          {task.assignee ? ` · ارجاع به: ${task.assignee.name}` : ""}
                        </div>
                      </div>
                      {task.priority !== "NORMAL" ? (
                        <Badge tone={task.priority === "URGENT" ? "danger" : "warning"}>
                          {task.priority === "URGENT" ? "فوری" : "متوسط"}
                        </Badge>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
                        aria-label="حذف وظیفه"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
