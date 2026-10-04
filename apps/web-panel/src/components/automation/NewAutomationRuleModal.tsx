import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons";
import {
  fetchTriggers,
  fetchUsers,
  createAutomationRule,
  updateAutomationRule,
  ApiError,
  type AutomationRule,
  type TriggerDefinition,
  type TenantUser,
  type AutomationActionType,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
const smallInputClass = "text-[12px] bg-surface border border-border rounded-lg px-2.5 py-2 outline-none min-w-0";

const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  NOTIFY_IN_APP: "اعلان داخل پنل",
  SEND_SMS: "پیامک",
  CREATE_TASK: "ایجاد وظیفه",
};

type NotifyDraft = { type: "NOTIFY_IN_APP"; targetMode: "FIXED" | "FIELD"; fixedUserId: string; payloadField: string; title: string; body: string; link: string };
type SmsDraft = { type: "SEND_SMS"; phoneMode: "FIXED" | "FIELD"; fixedPhone: string; payloadField: string; message: string };
type TaskDraft = { type: "CREATE_TASK"; assigneeMode: "NONE" | "FIXED" | "FIELD"; fixedUserId: string; payloadField: string; title: string; priority: "NORMAL" | "MEDIUM" | "URGENT" };
type ActionDraft = NotifyDraft | SmsDraft | TaskDraft;

function emptyNotify(): NotifyDraft {
  return { type: "NOTIFY_IN_APP", targetMode: "FIXED", fixedUserId: "", payloadField: "", title: "", body: "", link: "" };
}
function emptySms(): SmsDraft {
  return { type: "SEND_SMS", phoneMode: "FIXED", fixedPhone: "", payloadField: "", message: "" };
}
function emptyTask(): TaskDraft {
  return { type: "CREATE_TASK", assigneeMode: "NONE", fixedUserId: "", payloadField: "", title: "", priority: "NORMAL" };
}

/** اقدام ذخیره‌شده‌ی یک قانون را به پیش‌نویس قابل‌ویرایش تبدیل می‌کند (مقدارهای خالی -> رشته‌ی خالی). */
function draftFromAction(a: AutomationRule["actions"][number]): ActionDraft {
  const c = a.config as Record<string, string | undefined>;
  if (a.type === "NOTIFY_IN_APP") {
    return { ...emptyNotify(), targetMode: (c.targetMode as NotifyDraft["targetMode"]) ?? "FIXED", fixedUserId: c.fixedUserId ?? "", payloadField: c.payloadField ?? "", title: c.title ?? "", body: c.body ?? "", link: c.link ?? "" };
  }
  if (a.type === "SEND_SMS") {
    return { ...emptySms(), phoneMode: (c.phoneMode as SmsDraft["phoneMode"]) ?? "FIXED", fixedPhone: c.fixedPhone ?? "", payloadField: c.payloadField ?? "", message: c.message ?? "" };
  }
  return { ...emptyTask(), assigneeMode: (c.assigneeMode as TaskDraft["assigneeMode"]) ?? "NONE", fixedUserId: c.fixedUserId ?? "", payloadField: c.payloadField ?? "", title: c.title ?? "", priority: (c.priority as TaskDraft["priority"]) ?? "NORMAL" };
}

export function NewAutomationRuleModal({ onClose, onCreated, rule }: { onClose: () => void; onCreated: () => void; rule?: AutomationRule }) {
  const [triggers, setTriggers] = useState<TriggerDefinition[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [name, setName] = useState(rule?.name ?? "");
  const [triggerCode, setTriggerCode] = useState(rule?.triggerCode ?? "");
  const [actions, setActions] = useState<ActionDraft[]>(rule?.actions.length ? rule.actions.map(draftFromAction) : [emptyNotify()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTriggers().then(setTriggers).catch(() => setTriggers([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const trigger = triggers.find((t) => t.code === triggerCode);
  const userIdFields = trigger?.payloadFields.filter((f) => f.type === "USER_ID") ?? [];
  const phoneFields = trigger?.payloadFields.filter((f) => f.type === "PHONE") ?? [];

  function updateAction(i: number, patch: Partial<ActionDraft>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? ({ ...a, ...patch } as ActionDraft) : a)));
  }
  function setActionType(i: number, type: AutomationActionType) {
    setActions((prev) =>
      prev.map((a, idx) => (idx === i ? (type === "NOTIFY_IN_APP" ? emptyNotify() : type === "SEND_SMS" ? emptySms() : emptyTask()) : a)),
    );
  }

  const valid =
    name.trim() &&
    triggerCode &&
    actions.every((a) => {
      if (a.type === "NOTIFY_IN_APP") return a.title.trim() && a.body.trim() && (a.targetMode === "FIXED" ? a.fixedUserId : a.payloadField);
      if (a.type === "SEND_SMS") return a.message.trim() && (a.phoneMode === "FIXED" ? a.fixedPhone.trim() : a.payloadField);
      return a.title.trim() && (a.assigneeMode !== "FIELD" || a.payloadField) && (a.assigneeMode !== "FIXED" || a.fixedUserId);
    });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const save = rule ? (data: Parameters<typeof createAutomationRule>[0]) => updateAutomationRule(rule.id, data) : createAutomationRule;
      await save({
        name: name.trim(),
        triggerCode,
        actions: actions.map((a, i) => {
          if (a.type === "NOTIFY_IN_APP") {
            return {
              type: a.type,
              sequenceOrder: i,
              config: { type: a.type, targetMode: a.targetMode, fixedUserId: a.fixedUserId || undefined, payloadField: a.payloadField || undefined, title: a.title.trim(), body: a.body.trim(), link: a.link.trim() || undefined },
            };
          }
          if (a.type === "SEND_SMS") {
            return {
              type: a.type,
              sequenceOrder: i,
              config: { type: a.type, phoneMode: a.phoneMode, fixedPhone: a.fixedPhone.trim() || undefined, payloadField: a.payloadField || undefined, message: a.message.trim() },
            };
          }
          return {
            type: a.type,
            sequenceOrder: i,
            config: { type: a.type, assigneeMode: a.assigneeMode, fixedUserId: a.fixedUserId || undefined, payloadField: a.payloadField || undefined, title: a.title.trim(), priority: a.priority },
          };
        }),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={rule ? "ویرایش قانون اتوماسیون" : "قانون اتوماسیون جدید"} onClose={onClose} width="max-w-[640px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام قانون</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="مثلاً: اطلاع مسئول مرحله‌ی بعد" />
        </div>

        <div>
          <label className={labelClass}>تریگر (رویداد)</label>
          <select value={triggerCode} onChange={(e) => setTriggerCode(e.target.value)} className={inputClass}>
            <option value="">انتخاب کنید...</option>
            {triggers.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          {trigger?.description ? <p className="text-[11px] text-muted mt-1.5">{trigger.description}</p> : null}
          {trigger ? (
            <p className="text-[11px] text-muted mt-1.5">
              متغیرهای قابل استفاده در متن: {trigger.payloadFields.map((f) => `{${f.key}}`).join("، ")}
            </p>
          ) : null}
        </div>

        {trigger ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold text-ink-soft">اقدام‌ها</label>
              <button
                type="button"
                onClick={() => setActions((prev) => [...prev, emptyNotify()])}
                className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                افزودن اقدام
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {actions.map((a, i) => (
                <div key={i} className="bg-slate-50 border border-border rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <select value={a.type} onChange={(e) => setActionType(i, e.target.value as AutomationActionType)} className={`${smallInputClass} flex-1`}>
                      {(Object.keys(ACTION_TYPE_LABELS) as AutomationActionType[]).map((t) => (
                        <option key={t} value={t}>
                          {ACTION_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    {actions.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger cursor-pointer shrink-0"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {a.type === "NOTIFY_IN_APP" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <select value={a.targetMode} onChange={(e) => updateAction(i, { targetMode: e.target.value as never })} className={smallInputClass}>
                          <option value="FIXED">کاربر ثابت</option>
                          <option value="FIELD">مشخص‌شده در تریگر</option>
                        </select>
                        {a.targetMode === "FIXED" ? (
                          <select value={a.fixedUserId} onChange={(e) => updateAction(i, { fixedUserId: e.target.value })} className={`${smallInputClass} flex-1`}>
                            <option value="">کاربر...</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select value={a.payloadField} onChange={(e) => updateAction(i, { payloadField: e.target.value })} className={`${smallInputClass} flex-1`}>
                            <option value="">فیلد...</option>
                            {userIdFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <input value={a.title} onChange={(e) => updateAction(i, { title: e.target.value })} placeholder="عنوان اعلان" className={smallInputClass} />
                      <textarea value={a.body} onChange={(e) => updateAction(i, { body: e.target.value })} placeholder="متن اعلان" rows={2} className={`${smallInputClass} resize-none`} />
                    </>
                  ) : null}

                  {a.type === "SEND_SMS" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <select value={a.phoneMode} onChange={(e) => updateAction(i, { phoneMode: e.target.value as never })} className={smallInputClass}>
                          <option value="FIXED">شماره ثابت</option>
                          <option value="FIELD">مشخص‌شده در تریگر</option>
                        </select>
                        {a.phoneMode === "FIXED" ? (
                          <input value={a.fixedPhone} onChange={(e) => updateAction(i, { fixedPhone: e.target.value })} dir="ltr" placeholder="09xxxxxxxxx" className={`${smallInputClass} flex-1`} />
                        ) : (
                          <select value={a.payloadField} onChange={(e) => updateAction(i, { payloadField: e.target.value })} className={`${smallInputClass} flex-1`}>
                            <option value="">فیلد...</option>
                            {phoneFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <textarea value={a.message} onChange={(e) => updateAction(i, { message: e.target.value })} placeholder="متن پیامک" rows={2} className={`${smallInputClass} resize-none`} />
                    </>
                  ) : null}

                  {a.type === "CREATE_TASK" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <select value={a.assigneeMode} onChange={(e) => updateAction(i, { assigneeMode: e.target.value as never })} className={smallInputClass}>
                          <option value="NONE">بدون مسئول</option>
                          <option value="FIXED">کاربر ثابت</option>
                          <option value="FIELD">مشخص‌شده در تریگر</option>
                        </select>
                        {a.assigneeMode === "FIXED" ? (
                          <select value={a.fixedUserId} onChange={(e) => updateAction(i, { fixedUserId: e.target.value })} className={`${smallInputClass} flex-1`}>
                            <option value="">کاربر...</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        ) : a.assigneeMode === "FIELD" ? (
                          <select value={a.payloadField} onChange={(e) => updateAction(i, { payloadField: e.target.value })} className={`${smallInputClass} flex-1`}>
                            <option value="">فیلد...</option>
                            {userIdFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <select value={a.priority} onChange={(e) => updateAction(i, { priority: e.target.value as never })} className={smallInputClass}>
                          <option value="NORMAL">عادی</option>
                          <option value="MEDIUM">متوسط</option>
                          <option value="URGENT">فوری</option>
                        </select>
                      </div>
                      <input value={a.title} onChange={(e) => updateAction(i, { title: e.target.value })} placeholder="عنوان وظیفه" className={smallInputClass} />
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !valid}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : rule ? "ذخیره‌ی تغییرات" : "ثبت قانون"}
        </button>
      </form>
    </Modal>
  );
}
