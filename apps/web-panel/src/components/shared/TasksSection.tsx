import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchTasks, createTask, toggleTask, fetchUsers, type ApiTask, type TenantUser } from "@/lib/api";

export function TasksSection({ relatedModule, relatedEntityId }: { relatedModule: string; relatedEntityId: string }) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    fetchTasks({ relatedModule, relatedEntityId }).then(setTasks).catch(() => setTasks([]));
  }
  useEffect(reload, [relatedModule, relatedEntityId]);
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await createTask({ title: title.trim(), assignedUserId: assignedUserId || undefined, relatedModule, relatedEntityId });
      setTitle("");
      setAssignedUserId("");
      setAdding(false);
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(id: string) {
    await toggleTask(id);
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-muted">وظایف مرتبط</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          افزودن وظیفه
        </button>
      </div>

      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان وظیفه"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
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
            disabled={submitting || !title.trim()}
            className="py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : "ثبت وظیفه"}
          </button>
        </form>
      ) : null}

      {tasks === null ? (
        <div className="text-[12px] text-muted">در حال بارگذاری...</div>
      ) : tasks.length === 0 ? (
        <div className="text-[12px] text-muted">هنوز وظیفه‌ای ثبت نشده است</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <button
                onClick={() => handleToggle(t.id)}
                className={
                  "w-4.5 h-4.5 rounded-md shrink-0 flex items-center justify-center cursor-pointer " +
                  (t.status === "DONE" ? "bg-success" : "border-2 border-border")
                }
              >
                {t.status === "DONE" ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
              </button>
              <div className="flex-1 min-w-0">
                <div className={"text-[12px] font-bold truncate" + (t.status === "DONE" ? " text-muted line-through" : "")}>
                  {t.title}
                </div>
                <div className="text-[10.5px] text-muted mt-0.5">
                  {t.dueAt ? formatJalaliDateTime(t.dueAt) : formatJalaliDateTime(t.createdAt)}
                  {t.assignee ? ` · ${t.assignee.name}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
