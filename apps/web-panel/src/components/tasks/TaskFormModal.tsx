"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { CheckIcon, ChevronDownIcon, CloseIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  createTask,
  updateTask,
  reassignTask,
  fetchUsers,
  addTaskChecklistItem,
  updateTaskChecklistItem,
  deleteTaskChecklistItem,
  ApiError,
  type ApiTask,
  type ApiTaskChecklistItem,
  type TaskPriority,
  type TaskRecurrence,
  type TenantUser,
} from "@/lib/api";
import { FIELD, LABEL, PRIORITY_LABEL, RECURRENCE_LABEL, REMINDER_OPTIONS, filesToInputs, toIso, toLocalInput, uploadErrorText } from "@/components/tasks/task-ui";

/** انتخاب چندنفره‌ی ارجاع‌گیرنده — چیپ‌های انتخاب‌شده + لیست کشویی. */
export function AssigneePicker({ users, value, onChange }: { users: TenantUser[]; value: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 bg-primary-soft text-primary text-[12px] font-bold rounded-lg px-2.5 py-1">
            {byId.get(id) ?? "کاربر"}
            <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="حذف" className="cursor-pointer">
              <CloseIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
        {value.length === 0 ? <span className="text-[12px] text-muted">خودم</span> : null}
      </div>
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        className={FIELD}
        aria-label="افزودن ارجاع‌گیرنده"
      >
        <option value="">+ افزودن فرد</option>
        {users
          .filter((u) => u.status !== "DISABLED" && !value.includes(u.id))
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </select>
    </div>
  );
}

/**
 * فرم ثبت/ویرایش وظیفه. فرم اصلی کوتاه است (عنوان، ارجاع‌گیرندگان، اولویت، موعد، توضیحات)؛
 * همه‌ی فیلدهای فرعی داخل بخش جمع‌شونده‌ی «جزئیات بیشتر» هستند.
 */
export function TaskFormModal({
  task,
  relatedModule,
  relatedEntityId,
  onClose,
  onSaved,
}: {
  task?: ApiTask;
  relatedModule?: string;
  relatedEntityId?: string;
  onClose: () => void;
  onSaved: (task: ApiTask) => void;
}) {
  const editing = !!task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueAt, setDueAt] = useState(toLocalInput(task?.dueAt));
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "NORMAL");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assignees?.map((a) => a.userId) ?? []);
  const [users, setUsers] = useState<TenantUser[]>([]);

  const [moreOpen, setMoreOpen] = useState(false);
  const [startAt, setStartAt] = useState(toLocalInput(task?.startAt));
  const [sendLater, setSendLater] = useState(!!task && task.isPublished === false);
  const [sendAt, setSendAt] = useState(toLocalInput(task?.sendAt));
  const [reminders, setReminders] = useState<number[]>(task?.reminderOffsetsMin ?? []);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>(task?.recurrence ?? "NONE");
  const [interval, setIntervalValue] = useState(task?.recurrenceInterval ?? 1);
  const [recurrenceEnd, setRecurrenceEnd] = useState(toLocalInput(task?.recurrenceEndAt));
  const [tags, setTags] = useState((task?.tags ?? []).join("، "));
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [checklist, setChecklist] = useState<ApiTaskChecklistItem[]>(task?.checklist ?? []);
  const [draftItems, setDraftItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const linkedModule = task?.relatedModule ?? relatedModule;
  const alreadySent = editing && task?.isPublished !== false;

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

  function toggleReminder(min: number) {
    setReminders((prev) => (prev.includes(min) ? prev.filter((m) => m !== min) : [...prev, min]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    if (reminders.length && !dueAt) {
      setMoreOpen(true);
      setError("برای یادآوری ابتدا موعد را مشخص کنید");
      return;
    }
    if (sendLater && !sendAt) {
      setMoreOpen(true);
      setError("زمان ارسال را انتخاب کنید");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const tagList = tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean);
      let saved: ApiTask;
      if (task) {
        saved = await updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || null,
          priority,
          dueAt: dueAt ? toIso(dueAt)! : null,
          startAt: startAt ? toIso(startAt)! : null,
          reminderOffsetsMin: reminders,
          recurrence,
          recurrenceInterval: interval,
          recurrenceEndAt: recurrenceEnd ? toIso(recurrenceEnd)! : null,
          tags: tagList,
          notes: notes.trim() || null,
          ...(alreadySent ? {} : { sendAt: sendLater && sendAt ? toIso(sendAt)! : null }),
        });
        const before = (task.assignees ?? []).map((a) => a.userId).sort().join(",");
        const after = [...assigneeIds].sort().join(",");
        if (assigneeIds.length && before !== after) saved = await reassignTask(task.id, assigneeIds);
      } else {
        const attachments = files.length ? await filesToInputs(files) : undefined;
        saved = await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          dueAt: toIso(dueAt),
          assigneeIds: assigneeIds.length ? assigneeIds : undefined,
          checklist: draftItems.length ? draftItems : undefined,
          relatedModule,
          relatedEntityId,
          startAt: toIso(startAt),
          sendAt: sendLater ? toIso(sendAt) : undefined,
          reminderOffsetsMin: reminders.length ? reminders : undefined,
          recurrence: recurrence === "NONE" ? undefined : recurrence,
          recurrenceInterval: recurrence === "NONE" ? undefined : interval,
          recurrenceEndAt: recurrence === "NONE" ? undefined : toIso(recurrenceEnd),
          tags: tagList.length ? tagList : undefined,
          notes: notes.trim() || undefined,
          attachments,
        });
      }
      onSaved({ ...saved, checklist: editing ? checklist : saved.checklist });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uploadErrorText(err, "ثبت وظیفه ناموفق بود"));
    } finally {
      setSubmitting(false);
    }
  }

  const doneCount = checklist.filter((i) => i.done).length;

  return (
    <Modal title={editing ? `ویرایش وظیفه${task?.code ? ` · ${task.code}` : ""}` : "ثبت وظیفه"} onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={LABEL}>عنوان</label>
          <input autoFocus={!editing} value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} placeholder="چه کاری باید انجام شود؟" />
        </div>

        <div>
          <label className={LABEL}>ارجاع به</label>
          <AssigneePicker users={users} value={assigneeIds} onChange={setAssigneeIds} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label className={LABEL}>اولویت</label>
            <div className="flex gap-1.5">
              {(["NORMAL", "MEDIUM", "URGENT"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={clsx(
                    "flex-1 py-2.5 rounded-xl text-[12.5px] font-bold border cursor-pointer",
                    priority === p ? (p === "URGENT" ? "bg-danger text-white border-danger" : p === "MEDIUM" ? "bg-warning text-white border-warning" : "bg-primary text-white border-primary") : "bg-slate-50 border-border text-ink-soft",
                  )}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={LABEL}>موعد انجام</label>
            <JalaliDateTimeInput value={dueAt} onChange={setDueAt} placeholder="بدون موعد" />
            {dueAt ? (
              <button type="button" onClick={() => setDueAt("")} className="text-[11px] text-muted mt-1 cursor-pointer">
                حذف موعد
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <label className={LABEL}>توضیحات</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={FIELD} placeholder="توضیح کوتاه (اختیاری)" />
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="flex items-center gap-1.5 text-[12.5px] font-bold text-primary cursor-pointer self-start"
        >
          <ChevronDownIcon className={clsx("w-4 h-4 transition-transform", moreOpen && "rotate-180")} />
          جزئیات بیشتر
        </button>

        {moreOpen ? (
          <div className="flex flex-col gap-3.5 border border-border rounded-2xl p-3.5 bg-surface">
            <div>
              <label className={LABEL}>زمان شروع</label>
              <JalaliDateTimeInput value={startAt} onChange={setStartAt} placeholder="بدون زمان شروع" />
            </div>

            <div>
              <label className={LABEL}>زمان ارسال</label>
              {alreadySent ? (
                <div className="text-[12px] text-muted">این وظیفه قبلاً ارسال شده است.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setSendLater(false)} className={clsx("flex-1 py-2 rounded-xl text-[12.5px] font-bold border cursor-pointer", !sendLater ? "bg-primary text-white border-primary" : "bg-slate-50 border-border text-ink-soft")}>
                      همین الان
                    </button>
                    <button type="button" onClick={() => setSendLater(true)} className={clsx("flex-1 py-2 rounded-xl text-[12.5px] font-bold border cursor-pointer", sendLater ? "bg-primary text-white border-primary" : "bg-slate-50 border-border text-ink-soft")}>
                      زمان‌بندی
                    </button>
                  </div>
                  {sendLater ? <JalaliDateTimeInput value={sendAt} onChange={setSendAt} placeholder="انتخاب زمان ارسال" /> : null}
                  {sendLater ? <div className="text-[11px] text-muted">تا زمان ارسال، وظیفه برای ارجاع‌گیرنده دیده نمی‌شود و اعلانی نمی‌رود.</div> : null}
                </div>
              )}
            </div>

            <div>
              <label className={LABEL}>یادآوری پیش از موعد</label>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map((o) => (
                  <button
                    key={o.min}
                    type="button"
                    onClick={() => toggleReminder(o.min)}
                    disabled={!dueAt}
                    className={clsx("px-3 py-1.5 rounded-lg text-[12px] font-semibold border cursor-pointer disabled:opacity-50", reminders.includes(o.min) ? "bg-primary text-white border-primary" : "bg-slate-50 border-border text-ink-soft")}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {!dueAt ? <div className="text-[11px] text-muted mt-1">برای فعال‌شدن یادآوری، ابتدا موعد را مشخص کنید.</div> : null}
            </div>

            <div>
              <label className={LABEL}>تکرار</label>
              <div className="flex flex-wrap items-center gap-2">
                <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as TaskRecurrence)} className={clsx(FIELD, "!w-auto")}>
                  {(Object.keys(RECURRENCE_LABEL) as TaskRecurrence[]).map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABEL[r]}
                    </option>
                  ))}
                </select>
                {recurrence !== "NONE" ? (
                  <>
                    <span className="text-[12px] text-muted">هر</span>
                    <input type="number" min={1} max={365} value={interval} onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value) || 1))} className={clsx(FIELD, "!w-20")} />
                    <span className="text-[12px] text-muted">{recurrence === "DAILY" ? "روز" : recurrence === "WEEKLY" ? "هفته" : "ماه"}</span>
                  </>
                ) : null}
              </div>
              {recurrence !== "NONE" ? (
                <div className="mt-2">
                  <label className={LABEL}>پایان تکرار (اختیاری)</label>
                  <JalaliDateTimeInput value={recurrenceEnd} onChange={setRecurrenceEnd} placeholder="بدون پایان" />
                </div>
              ) : null}
            </div>

            {linkedModule ? (
              <div className="text-[12px] text-ink-soft">
                مرتبط با: <span className="font-bold">{linkedModule}</span>
              </div>
            ) : null}

            <div>
              <label className={LABEL}>برچسب‌ها</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={FIELD} placeholder="با ویرگول جدا کنید؛ مثلاً: مالی، پیگیری" />
            </div>

            <div>
              <label className={LABEL}>یادداشت</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={FIELD} placeholder="یادداشت داخلی" />
            </div>

            {!editing ? (
              <div>
                <label className={LABEL}>پیوست‌ها</label>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])].slice(0, 10));
                    e.target.value = "";
                  }}
                />
                <div className="flex flex-col gap-1.5">
                  {files.map((f, i) => (
                    <div key={`${f.name}${i}`} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 text-[12px]">
                      <span className="flex-1 truncate">{f.name}</span>
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-danger cursor-pointer" aria-label="حذف فایل">
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-[12px] font-bold text-primary cursor-pointer self-start">
                    <PlusIcon className="w-3.5 h-3.5" />
                    افزودن فایل یا عکس
                  </button>
                </div>
              </div>
            ) : null}

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
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-danger font-semibold">{error}</div> : null}
        <button type="submit" disabled={submitting || title.trim().length < 2} className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50">
          {submitting ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : sendLater ? "ثبت و زمان‌بندی ارسال" : "ثبت وظیفه"}
        </button>
      </form>
    </Modal>
  );
}
