"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { DispatchTaskPanel } from "@/components/dispatch/DispatchTaskPanel";
import { useWorkspace } from "@/lib/workspace-context";
import { TaskFormModal, AssigneePicker } from "@/components/tasks/TaskFormModal";
import { CheckIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  fetchTask,
  fetchUsers,
  markTaskSeen,
  startTask,
  submitTaskResult,
  reportTaskProblem,
  addTaskComment,
  requestTaskExtension,
  decideTaskExtension,
  approveTask,
  returnTask,
  resolveTaskProblem,
  reassignTask,
  cancelTask,
  reopenTask,
  updateTaskChecklistItem,
  ApiError,
  type ApiTask,
  type ApiTaskDetail,
  type TenantUser,
} from "@/lib/api";
import { TickIcon } from "@/components/tasks/TaskTicks";
import { EVENT_LABEL, FIELD, LABEL, PRIORITY_LABEL, PRIORITY_TONE, RECURRENCE_LABEL, STATUS_LABEL, STATUS_TONE, filesToInputs, toIso, uploadErrorText } from "@/components/tasks/task-ui";

type Panel = null | "result" | "problem" | "extension" | "return" | "resolve" | "reassign" | "cancel";

const BTN = "px-3.5 py-2 rounded-xl text-[12.5px] font-bold cursor-pointer disabled:opacity-50";

/** پنجره‌ی جزئیات و گردش‌کار وظیفه: وضعیت، اقدام‌های مجاز نقش، نتیجه، مشکل، تمدید و تاریخچه. */
export function TaskDetailModal({ task: initial, onClose, onChanged }: { task: ApiTask; onClose: () => void; onChanged: (t: ApiTask) => void }) {
  const { installedModules } = useWorkspace();
  const [task, setTask] = useState<ApiTaskDetail | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await fetchTask(initial.id);
    setTask(t);
    return t;
  }, [initial.id]);

  // با باز شدن، ارجاع‌گیرنده خودکار «دیده‌شده» ثبت می‌شود؛ سپس جزئیات کامل بارگذاری می‌شود.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const first = await fetchTask(initial.id);
        if (!alive) return;
        setTask(first);
        const me = first.role?.assignee && first.isPublished !== false;
        const unseen = me && (first.status === "NEW" || first.status === "OPEN" || first.assignees?.some((a) => a.seenAt === null));
        if (unseen) {
          const updated = await markTaskSeen(initial.id);
          onChanged(updated);
          if (alive) await load();
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "بارگذاری وظیفه ناموفق بود");
      }
    })();
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  function resetPanel(next: Panel) {
    setPanel(next);
    setText("");
    setFiles([]);
    setNote("");
    setDueLocal("");
    setError(null);
    if (next === "reassign") setAssigneeIds(task?.assignees?.map((a) => a.userId) ?? []);
  }

  async function run(fn: () => Promise<ApiTask | unknown>, close = true) {
    setBusy(true);
    setError(null);
    try {
      const res = (await fn()) as ApiTask | undefined;
      if (close) resetPanel(null);
      const fresh = await load();
      onChanged(res && typeof res === "object" && "id" in res ? { ...(res as ApiTask) } : fresh);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : uploadErrorText(e, "عملیات ناموفق بود"));
    } finally {
      setBusy(false);
    }
  }

  if (editing && task) {
    return (
      <TaskFormModal
        task={task}
        onClose={() => setEditing(false)}
        onSaved={(t) => {
          onChanged(t);
          void load();
        }}
      />
    );
  }

  const t = task;
  const actions = new Set(t?.actions ?? []);
  const role = t?.role;
  const pendingExtension = t?.extensionRequests.find((x) => x.status === "PENDING");
  const rootComments = t?.comments.filter((c) => !c.parentId) ?? [];
  const closed = t?.status === "APPROVED" || t?.status === "CANCELLED";

  return (
    <Modal title={t ? `${t.code ?? "وظیفه"} · ${t.title}` : initial.title || "وظیفه"} onClose={onClose} width="max-w-[680px]">
      {!t ? (
        <div className="text-center text-muted text-sm py-6">{error ?? "در حال بارگذاری..."}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
            <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
            {t.isOverdue ? <Badge tone="danger">دارای تأخیر</Badge> : null}
            {t.isPublished === false ? <Badge tone="neutral">زمان‌بندی‌شده برای {t.sendAt ? formatJalaliDateTime(t.sendAt) : "—"}</Badge> : null}
            {t.recurrence && t.recurrence !== "NONE" ? <Badge tone="accent">{RECURRENCE_LABEL[t.recurrence]}</Badge> : null}
            {role?.canManage && !closed ? (
              <button type="button" onClick={() => setEditing(true)} className="mr-auto text-[12px] font-bold text-primary cursor-pointer">
                ویرایش
              </button>
            ) : null}
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
            <div>
              <span className="text-muted">ارجاع به: </span>
              {(t.assignees ?? []).length === 0 ? "—" : null}
              {(t.assignees ?? []).map((a, i) => (
                <span key={a.userId} className="font-semibold">
                  {i > 0 ? "، " : ""}
                  {a.name}
                  {t.tick && t.tick !== "none" ? (
                    <span className="inline-flex align-middle ms-1" title={a.seenAt ? `دیده شد ${formatJalaliDateTime(a.seenAt)}` : a.deliveredAt ? `دریافت شد ${formatJalaliDateTime(a.deliveredAt)}` : "ارسال شد"}>
                      <TickIcon state={a.seenAt ? "seen" : a.deliveredAt ? "delivered" : "sent"} />
                    </span>
                  ) : a.seenAt ? (
                    <span className="text-success" title={`دیده‌شده ${formatJalaliDateTime(a.seenAt)}`}> ✓</span>
                  ) : null}
                </span>
              ))}
            </div>
            <div>
              <span className="text-muted">سازنده: </span>
              <span className="font-semibold">{t.createdBy?.name ?? "سیستم"}</span>
            </div>
            <div>
              <span className="text-muted">موعد: </span>
              <span className={clsx("font-semibold", t.isOverdue && "text-danger")}>{t.dueAt ? formatJalaliDateTime(t.dueAt) : "بدون موعد"}</span>
            </div>
            {t.startAt ? (
              <div>
                <span className="text-muted">شروع: </span>
                <span className="font-semibold">{formatJalaliDateTime(t.startAt)}</span>
              </div>
            ) : null}
            {t.tags && t.tags.length ? (
              <div className="sm:col-span-2 flex flex-wrap gap-1.5">
                {t.tags.map((g) => (
                  <Badge key={g}>{g}</Badge>
                ))}
              </div>
            ) : null}
          </div>

          {t.description ? <p className="text-[13px] leading-6 whitespace-pre-wrap bg-slate-50 border border-border rounded-xl p-3">{t.description}</p> : null}
          {t.notes ? <p className="text-[12px] text-muted whitespace-pre-wrap">یادداشت: {t.notes}</p> : null}

          {(t.checklist ?? []).length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>چک‌لیست</span>
              {(t.checklist ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={closed || !(role?.canManage || role?.assignee)}
                  onClick={() => run(() => updateTaskChecklistItem(t.id, item.id, { done: !item.done }), false)}
                  className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 text-right cursor-pointer disabled:cursor-default"
                >
                  <span className={clsx("w-4.5 h-4.5 rounded-md shrink-0 flex items-center justify-center", item.done ? "bg-success" : "border-2 border-border")}>
                    {item.done ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
                  </span>
                  <span className={clsx("text-[12.5px]", item.done && "line-through text-muted")}>{item.text}</span>
                </button>
              ))}
            </div>
          ) : null}

          <AttachmentsSection entityType="Task" entityId={t.id} readOnly={!role?.canManage || closed} />

          {t.relatedModule === "Shipment" && t.relatedEntityId && installedModules.has("dispatch") ? <DispatchTaskPanel shipmentId={t.relatedEntityId} /> : null}

          {/* ── اقدام‌ها ── */}
          {error ? <div className="text-[12px] text-danger font-semibold">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            {role?.assignee && actions.has("START") ? (
              <button type="button" disabled={busy} onClick={() => run(() => startTask(t.id), false)} className={clsx(BTN, "bg-primary text-white")}>
                شروع کار
              </button>
            ) : null}
            {role?.assignee && actions.has("SUBMIT") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("result")} className={clsx(BTN, "bg-success text-white")}>
                ثبت نتیجه
              </button>
            ) : null}
            {role?.assignee && actions.has("REPORT_PROBLEM") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("problem")} className={clsx(BTN, "bg-danger-soft text-danger")}>
                گزارش مشکل
              </button>
            ) : null}
            {role?.assignee && !closed && t.status !== "DONE" && !pendingExtension ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("extension")} className={clsx(BTN, "bg-slate-100 text-ink-soft")}>
                درخواست تمدید موعد
              </button>
            ) : null}
            {role?.canManage && actions.has("APPROVE") ? (
              <button type="button" disabled={busy} onClick={() => run(() => approveTask(t.id), false)} className={clsx(BTN, "bg-success text-white")}>
                تأیید نتیجه
              </button>
            ) : null}
            {role?.canManage && actions.has("RETURN") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("return")} className={clsx(BTN, "bg-warning-soft text-warning")}>
                بازگشت برای اصلاح
              </button>
            ) : null}
            {role?.canManage && actions.has("RESOLVE_PROBLEM") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("resolve")} className={clsx(BTN, "bg-primary text-white")}>
                رفع مشکل و ادامه
              </button>
            ) : null}
            {role?.canManage && actions.has("REASSIGN") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("reassign")} className={clsx(BTN, "bg-slate-100 text-ink-soft")}>
                ارجاع مجدد
              </button>
            ) : null}
            {role?.canManage && actions.has("CANCEL") ? (
              <button type="button" disabled={busy} onClick={() => resetPanel("cancel")} className={clsx(BTN, "bg-slate-100 text-danger")}>
                لغو وظیفه
              </button>
            ) : null}
            {role?.canManage && actions.has("REOPEN") ? (
              <button type="button" disabled={busy} onClick={() => run(() => reopenTask(t.id), false)} className={clsx(BTN, "bg-slate-100 text-ink-soft")}>
                بازگشایی
              </button>
            ) : null}
          </div>

          {panel ? (
            <div className="border border-border rounded-2xl p-3.5 bg-slate-50 flex flex-col gap-3">
              {panel === "result" ? (
                <>
                  <label className={LABEL}>نتیجه‌ی کار</label>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={FIELD} placeholder="چه کاری انجام شد؟" />
                  <FilePicker files={files} setFiles={setFiles} fileRef={fileRef} />
                  <PanelButtons
                    busy={busy}
                    disabled={!text.trim() && files.length === 0}
                    submitLabel="ثبت نتیجه"
                    onCancel={() => resetPanel(null)}
                    onSubmit={() =>
                      run(async () => submitTaskResult(t.id, { text: text.trim() || undefined, files: files.length ? await filesToInputs(files) : undefined }))
                    }
                  />
                </>
              ) : null}
              {panel === "problem" ? (
                <>
                  <label className={LABEL}>شرح مشکل</label>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={FIELD} placeholder="چه مشکلی پیش آمده؟" />
                  <FilePicker files={files} setFiles={setFiles} fileRef={fileRef} />
                  <PanelButtons
                    busy={busy}
                    disabled={text.trim().length < 2}
                    submitLabel="ثبت گزارش مشکل"
                    onCancel={() => resetPanel(null)}
                    onSubmit={() => run(async () => reportTaskProblem(t.id, { body: text.trim(), files: files.length ? await filesToInputs(files) : undefined }))}
                  />
                </>
              ) : null}
              {panel === "extension" ? (
                <>
                  <label className={LABEL}>موعد پیشنهادی</label>
                  <JalaliDateTimeInput value={dueLocal} onChange={setDueLocal} placeholder="انتخاب موعد جدید" />
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD} placeholder="دلیل درخواست تمدید" />
                  <PanelButtons
                    busy={busy}
                    disabled={!dueLocal}
                    submitLabel="ارسال درخواست"
                    onCancel={() => resetPanel(null)}
                    onSubmit={() => run(() => requestTaskExtension(t.id, { proposedDueAt: toIso(dueLocal)!, reason: note.trim() || undefined }))}
                  />
                </>
              ) : null}
              {panel === "return" ? (
                <>
                  <label className={LABEL}>دلیل بازگشت (الزامی)</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={FIELD} placeholder="چه چیزی باید اصلاح شود؟" />
                  <PanelButtons busy={busy} disabled={note.trim().length < 2} submitLabel="بازگشت برای اصلاح" onCancel={() => resetPanel(null)} onSubmit={() => run(() => returnTask(t.id, note.trim()))} />
                </>
              ) : null}
              {panel === "resolve" ? (
                <>
                  <label className={LABEL}>توضیح (اختیاری)</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD} />
                  <label className={LABEL}>موعد جدید (اختیاری)</label>
                  <JalaliDateTimeInput value={dueLocal} onChange={setDueLocal} placeholder="بدون تغییر" />
                  <PanelButtons busy={busy} submitLabel="رفع مشکل" onCancel={() => resetPanel(null)} onSubmit={() => run(() => resolveTaskProblem(t.id, { note: note.trim() || undefined, dueAt: toIso(dueLocal) }))} />
                </>
              ) : null}
              {panel === "reassign" ? (
                <>
                  <label className={LABEL}>ارجاع‌گیرندگان جدید</label>
                  <AssigneePicker users={users} value={assigneeIds} onChange={setAssigneeIds} />
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD} placeholder="توضیح (اختیاری)" />
                  <PanelButtons busy={busy} disabled={assigneeIds.length === 0} submitLabel="ارجاع مجدد" onCancel={() => resetPanel(null)} onSubmit={() => run(() => reassignTask(t.id, assigneeIds, note.trim() || undefined))} />
                </>
              ) : null}
              {panel === "cancel" ? (
                <>
                  <label className={LABEL}>دلیل لغو (اختیاری)</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD} />
                  <PanelButtons busy={busy} submitLabel="لغو وظیفه" onCancel={() => resetPanel(null)} onSubmit={() => run(() => cancelTask(t.id, note.trim() || undefined))} />
                </>
              ) : null}
            </div>
          ) : null}

          {/* ── درخواست‌های تمدید ── */}
          {t.extensionRequests.length > 0 ? (
            <Section title="درخواست‌های تمدید">
              {t.extensionRequests.map((x) => (
                <div key={x.id} className="bg-slate-50 border border-border rounded-xl p-3 text-[12.5px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{x.requestedByName}</span>
                    <span className="text-muted">موعد پیشنهادی: {formatJalaliDateTime(x.proposedDueAt)}</span>
                    <Badge tone={x.status === "PENDING" ? "warning" : x.status === "APPROVED" ? "success" : "danger"}>
                      {x.status === "PENDING" ? "در انتظار" : x.status === "APPROVED" ? "تأیید شد" : "رد شد"}
                    </Badge>
                  </div>
                  {x.reason ? <div className="mt-1 text-ink-soft">{x.reason}</div> : null}
                  {x.decisionNote ? <div className="mt-1 text-muted">پاسخ {x.decidedByName}: {x.decisionNote}</div> : null}
                  {x.status === "PENDING" && role?.canManage ? (
                    <div className="flex gap-2 mt-2">
                      <button type="button" disabled={busy} onClick={() => run(() => decideTaskExtension(t.id, x.id, true), false)} className={clsx(BTN, "bg-success text-white !py-1.5")}>
                        تأیید
                      </button>
                      <button type="button" disabled={busy} onClick={() => run(() => decideTaskExtension(t.id, x.id, false), false)} className={clsx(BTN, "bg-slate-200 text-ink-soft !py-1.5")}>
                        رد
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </Section>
          ) : null}

          {/* ── نتایج ── */}
          {t.results.length > 0 ? (
            <Section title="نتیجه‌های ثبت‌شده">
              {t.results.map((r) => (
                <div key={r.id} className="bg-slate-50 border border-border rounded-xl p-3 text-[12.5px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{r.authorName}</span>
                    <span className="text-muted">{formatJalaliDateTime(r.createdAt)}</span>
                    <Badge tone={r.status === "APPROVED" ? "success" : r.status === "RETURNED" ? "warning" : "primary"}>
                      {r.status === "APPROVED" ? "تأیید شد" : r.status === "RETURNED" ? "برگشت خورد" : "منتظر بررسی"}
                    </Badge>
                  </div>
                  {r.text ? <div className="mt-1.5 whitespace-pre-wrap">{r.text}</div> : null}
                  {r.reviewNote ? <div className="mt-1 text-muted">بازخورد {r.reviewedByName}: {r.reviewNote}</div> : null}
                  <div className="mt-2">
                    <AttachmentsSection entityType="TaskResult" entityId={r.id} readOnly />
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {/* ── گفتگو و مشکل‌ها ── */}
          <Section title="گفتگو و گزارش مشکل">
            {rootComments.length === 0 ? <div className="text-[12px] text-muted">هنوز پیامی نیست</div> : null}
            {rootComments.map((c) => (
              <div key={c.id} className={clsx("border rounded-xl p-3 text-[12.5px]", c.isProblem ? "border-danger/40 bg-danger-soft/40" : "border-border bg-slate-50")}>
                <CommentView c={c} />
                {c.isProblem ? <AttachmentsSection entityType="TaskComment" entityId={c.id} readOnly /> : null}
                {t.comments.filter((r) => r.parentId === c.id).map((r) => (
                  <div key={r.id} className="mt-2 mr-4 border-r-2 border-border pr-3">
                    <CommentView c={r} />
                  </div>
                ))}
                <button type="button" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="text-[11.5px] font-bold text-primary mt-2 cursor-pointer">
                  پاسخ
                </button>
                {replyTo === c.id ? (
                  <CommentBox
                    value={comment}
                    onChange={setComment}
                    busy={busy}
                    onSubmit={() =>
                      run(async () => {
                        await addTaskComment(t.id, { body: comment.trim(), parentId: c.id });
                        setComment("");
                        setReplyTo(null);
                        return undefined;
                      }, false)
                    }
                  />
                ) : null}
              </div>
            ))}
            {replyTo === null ? (
              <CommentBox
                value={comment}
                onChange={setComment}
                busy={busy}
                onSubmit={() =>
                  run(async () => {
                    await addTaskComment(t.id, { body: comment.trim() });
                    setComment("");
                    return undefined;
                  }, false)
                }
              />
            ) : null}
          </Section>

          {/* ── تاریخچه ── */}
          <Section title="تاریخچه‌ی فعالیت">
            <ol className="relative border-r-2 border-border mr-1.5 flex flex-col gap-3">
              {t.events.map((e) => (
                <li key={e.id} className="pr-4 relative">
                  <span className="absolute -right-[7px] top-1 w-3 h-3 rounded-full bg-primary border-2 border-surface" />
                  <div className="text-[12.5px] font-semibold">{EVENT_LABEL[e.type] ?? e.type}</div>
                  <div className="text-[11.5px] text-muted">
                    {e.actorName ?? "سیستم"} · {formatJalaliDateTime(e.createdAt)}
                    {e.toStatus && e.fromStatus !== e.toStatus ? ` · ${e.fromStatus ? STATUS_LABEL[e.fromStatus] + " ← " : ""}${STATUS_LABEL[e.toStatus]}` : ""}
                  </div>
                  {e.note ? <div className="text-[12px] text-ink-soft mt-0.5 whitespace-pre-wrap">{e.note}</div> : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-extrabold">{title}</span>
      {children}
    </div>
  );
}

function CommentView({ c }: { c: { authorName: string | null; body: string; createdAt: string; isProblem?: boolean } }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="font-bold text-ink">{c.authorName ?? "کاربر"}</span>
        <span>{formatJalaliDateTime(c.createdAt)}</span>
        {c.isProblem ? <Badge tone="danger">گزارش مشکل</Badge> : null}
      </div>
      <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
    </div>
  );
}

function CommentBox({ value, onChange, onSubmit, busy }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean }) {
  return (
    <div className="flex items-start gap-2 mt-2">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={clsx(FIELD, "flex-1")} placeholder="پیام یا پاسخ..." />
      <button type="button" disabled={busy || !value.trim()} onClick={onSubmit} className={clsx(BTN, "bg-primary text-white")}>
        ارسال
      </button>
    </div>
  );
}

function FilePicker({ files, setFiles, fileRef }: { files: File[]; setFiles: (f: File[]) => void; fileRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10));
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="text-[12px] font-bold text-primary cursor-pointer">
          + افزودن فایل یا عکس
        </button>
        {files.map((f, i) => (
          <span key={`${f.name}${i}`} className="text-[11.5px] bg-surface border border-border rounded-lg px-2 py-1">
            {f.name}{" "}
            <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-muted cursor-pointer" aria-label="حذف">
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function PanelButtons({ busy, disabled, submitLabel, onSubmit, onCancel }: { busy: boolean; disabled?: boolean; submitLabel: string; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" disabled={busy || disabled} onClick={onSubmit} className={clsx(BTN, "bg-primary text-white")}>
        {busy ? "در حال ثبت..." : submitLabel}
      </button>
      <button type="button" onClick={onCancel} className={clsx(BTN, "text-ink-soft")}>
        انصراف
      </button>
    </div>
  );
}
