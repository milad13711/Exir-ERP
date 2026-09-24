"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { CheckIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  createTask,
  updateTask,
  fetchUsers,
  addTaskChecklistItem,
  updateTaskChecklistItem,
  deleteTaskChecklistItem,
  ApiError,
  type ApiTask,
  type ApiTaskChecklistItem,
  type TenantUser,
} from "@/lib/api";

const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary";

/** فرم کامل وظیفه — هم برای ثبت وظیفه‌ی جدید و هم مشاهده/ویرایش یک وظیفه‌ی موجود (زمان، ارجاع، توضیحات، چک‌لیست). */
export function TaskModal({
  task,
  relatedModule,
  relatedEntityId,
  onClose,
  onSaved,
}: {
  task?: ApiTask | null;
  relatedModule?: string;
  relatedEntityId?: string;
  onClose: () => void;
  onSaved: (task: ApiTask) => void;
}) {
  const editing = !!task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueAt, setDueAt] = useState(task?.dueAt ?? "");
  const [priority, setPriority] = useState<ApiTask["priority"]>(task?.priority ?? "NORMAL");
  const [assignedUserId, setAssignedUserId] = useState(task?.assignedUserId ?? "");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [checklist, setChecklist] = useState<ApiTaskChecklistItem[]>(task?.checklist ?? []);
  const [draftItems, setDraftItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  async function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    if (!task) {
      setDraftItems((prev) => [...prev, text]);
      return;
    }
    try {
      const item = await addTaskChecklistItem(task.id, text);
      setChecklist((prev) => [...prev, item]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن آیتم ناموفق بود");
    }
  }

  async function toggleItem(item: ApiTaskChecklistItem) {
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      await updateTaskChecklistItem(item.taskId, item.id, { done: !item.done });
    } catch {
      setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
    }
  }

  async function removeItem(item: ApiTaskChecklistItem) {
    setChecklist((prev) => prev.filter((i) => i.id !== item.id));
    await deleteTaskChecklistItem(item.taskId, item.id).catch(() => {});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
      const saved = task
        ? await updateTask(task.id, {
            title: title.trim(),
            description: description.trim() || null,
            priority,
            dueAt: dueIso,
            ...(assignedUserId ? { assignedUserId } : {}),
          })
        : await createTask({
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            dueAt: dueIso ?? undefined,
            assignedUserId: assignedUserId || undefined,
            checklist: draftItems.length ? draftItems : undefined,
            relatedModule,
            relatedEntityId,
          });
      onSaved({ ...saved, checklist: editing ? checklist : saved.checklist });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت وظیفه ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <Modal title={editing ? "جزئیات وظیفه" : "ثبت وظیفه"} onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">عنوان</label>
          <input autoFocus={!editing} value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} placeholder="چه کاری باید انجام شود؟" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">توضیحات</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={FIELD} placeholder="جزئیات بیشتر (اختیاری)" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">موعد انجام</label>
            <JalaliDateTimeInput value={dueAt} onChange={setDueAt} placeholder="بدون موعد" />
            {dueAt ? (
              <button type="button" onClick={() => setDueAt("")} className="text-[11px] text-muted mt-1 cursor-pointer">
                حذف موعد
              </button>
            ) : null}
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">ارجاع به</label>
            <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className={FIELD}>
              <option value="">{editing ? "بدون تغییر" : "خودم"}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">اولویت</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as ApiTask["priority"])} className={FIELD}>
            <option value="NORMAL">عادی</option>
            <option value="MEDIUM">متوسط</option>
            <option value="URGENT">فوری</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12px] font-semibold text-ink-soft">چک‌لیست</label>
            {editing && checklist.length > 0 ? (
              <span className="text-[11px] text-muted">
                {doneCount} از {checklist.length} انجام شد
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleItem(item)}
                  className={clsx("w-4.5 h-4.5 rounded-md shrink-0 flex items-center justify-center cursor-pointer", item.done ? "bg-success" : "border-2 border-border")}
                  aria-label="تغییر وضعیت آیتم"
                >
                  {item.done ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
                </button>
                <span className={clsx("flex-1 text-[12.5px]", item.done && "line-through text-muted")}>{item.text}</span>
                <button type="button" onClick={() => removeItem(item)} className="text-muted hover:text-danger cursor-pointer" aria-label="حذف آیتم">
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {draftItems.map((text, i) => (
              <div key={`d${i}`} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
                <span className="w-4.5 h-4.5 rounded-md border-2 border-border shrink-0" />
                <span className="flex-1 text-[12.5px]">{text}</span>
                <button type="button" onClick={() => setDraftItems((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-danger cursor-pointer" aria-label="حذف آیتم">
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addItem();
                  }
                }}
                placeholder="افزودن آیتم چک‌لیست..."
                className={clsx(FIELD, "flex-1 !py-2")}
              />
              <button type="button" onClick={() => void addItem()} disabled={!newItem.trim()} className="w-9 h-9 rounded-xl bg-slate-100 text-ink-soft flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0" aria-label="افزودن آیتم">
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="text-[12px] text-danger font-semibold">{error}</div> : null}
        <button type="submit" disabled={submitting || title.trim().length < 2} className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50">
          {submitting ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : "ثبت وظیفه"}
        </button>
      </form>
    </Modal>
  );
}
