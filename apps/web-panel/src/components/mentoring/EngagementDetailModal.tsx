import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon } from "@/components/icons";
import { formatJalaliDateTime, formatToman } from "@/lib/persian";
import {
  fetchMentoringEngagement,
  updateMentoringEngagement,
  completeMentoringSession,
  cancelMentoringSession,
  markMentoringSessionNoShow,
  fetchMentoringSessionSuggestedAmount,
  createMentoringSessionInvoice,
  createMentoringGoal,
  addMentoringGoalCheckIn,
  type MentoringEngagement,
  type MentoringSession,
  type MentoringSessionStatus,
  type MentoringGoalType,
} from "@/lib/api";
import { NewSessionModal } from "./NewSessionModal";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";

const SESSION_STATUS_LABELS: Record<MentoringSessionStatus, string> = {
  SCHEDULED: "زمان‌بندی‌شده",
  COMPLETED: "برگزار شده",
  CANCELLED: "لغو شده",
  NO_SHOW: "عدم حضور",
};
const SESSION_STATUS_TONES: Record<MentoringSessionStatus, "primary" | "success" | "danger" | "neutral"> = {
  SCHEDULED: "primary",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};
const MODE_LABEL_FA: Record<string, string> = { ONLINE: "آنلاین", PHONE: "تلفنی", IN_PERSON: "حضوری" };
const GOAL_STATUS_LABELS: Record<string, string> = { IN_PROGRESS: "در حال پیگیری", ACHIEVED: "محقق‌شده", MISSED: "محقق‌نشده", CANCELLED: "لغوشده" };

function SessionRow({ session, onChanged }: { session: MentoringSession; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [amount, setAmount] = useState("");

  async function handleComplete() {
    const minutesNote = window.prompt("صورت‌جلسه (اختیاری):") ?? undefined;
    setBusy(true);
    try {
      await completeMentoringSession(session.id, minutesNote || undefined);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    const reason = window.prompt("دلیل لغو (اختیاری):") ?? undefined;
    setBusy(true);
    try {
      await cancelMentoringSession(session.id, reason || undefined);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleNoShow() {
    setBusy(true);
    try {
      await markMentoringSessionNoShow(session.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function openInvoice() {
    setInvoiceOpen(true);
    const suggested = await fetchMentoringSessionSuggestedAmount(session.id).catch(() => null);
    if (suggested?.amount != null) setAmount(String(suggested.amount));
  }

  async function submitInvoice() {
    if (!amount) return;
    setBusy(true);
    try {
      await createMentoringSessionInvoice(session.id, Number(amount));
      setInvoiceOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[13px] font-bold">{formatJalaliDateTime(session.scheduledAt)}</div>
          <div className="text-[11.5px] text-muted mt-0.5">
            {MODE_LABEL_FA[session.mode]} · {session.durationMinutes} دقیقه
            {session.location ? ` · ${session.location}` : ""}
          </div>
        </div>
        <Badge tone={SESSION_STATUS_TONES[session.status]}>{SESSION_STATUS_LABELS[session.status]}</Badge>
      </div>

      {session.minutesNote && <div className="text-[12px] text-ink-soft bg-slate-50 rounded-lg p-2 mt-2 whitespace-pre-wrap">{session.minutesNote}</div>}

      {session.survey?.rating != null && (
        <div className="text-[11.5px] text-muted mt-2">نظرسنجی: {session.survey.rating} از ۵{session.survey.note ? ` — ${session.survey.note}` : ""}</div>
      )}

      {session.status === "SCHEDULED" && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button disabled={busy} onClick={handleComplete} className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-success-soft text-success cursor-pointer disabled:opacity-50">
            تکمیل جلسه
          </button>
          <button disabled={busy} onClick={handleCancel} className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-ink-soft cursor-pointer disabled:opacity-50">
            لغو
          </button>
          <button disabled={busy} onClick={handleNoShow} className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-danger-soft text-danger cursor-pointer disabled:opacity-50">
            عدم حضور
          </button>
        </div>
      )}

      {session.status === "COMPLETED" && !session.invoiceId && (
        <div className="mt-3">
          {invoiceOpen ? (
            <div className="flex items-center gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="مبلغ (تومان)" className={`${inputClass} flex-1`} />
              <button disabled={busy || !amount} onClick={submitInvoice} className="text-[11.5px] font-bold px-3 py-2 rounded-lg bg-primary text-white cursor-pointer disabled:opacity-50">
                صدور فاکتور
              </button>
            </div>
          ) : (
            <button onClick={openInvoice} className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-primary-soft text-primary cursor-pointer">
              صدور فاکتور جلسه
            </button>
          )}
        </div>
      )}
      {session.invoiceId && <div className="text-[11.5px] text-success font-semibold mt-2">فاکتور صادر شد</div>}
    </div>
  );
}

function NewGoalForm({ engagementId, onCreated }: { engagementId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MentoringGoalType>("QUALITATIVE");
  const [unit, setUnit] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[11.5px] font-bold text-primary cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" /> افزودن هدف
      </button>
    );
  }

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createMentoringGoal({ engagementId, title: title.trim(), type, unit: unit.trim() || undefined, targetValue: targetValue ? Number(targetValue) : undefined });
      setTitle("");
      setUnit("");
      setTargetValue("");
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3 flex flex-col gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان هدف" className={inputClass} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setType("QUALITATIVE")} className={`flex-1 text-[11.5px] font-bold py-1.5 rounded-lg border cursor-pointer ${type === "QUALITATIVE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}>
          کیفی
        </button>
        <button type="button" onClick={() => setType("QUANTITATIVE")} className={`flex-1 text-[11.5px] font-bold py-1.5 rounded-lg border cursor-pointer ${type === "QUANTITATIVE" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}>
          کمی
        </button>
      </div>
      {type === "QUANTITATIVE" && (
        <div className="flex gap-2">
          <input value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="مقدار هدف" className={inputClass} />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="واحد (مثلاً کیلوگرم)" className={inputClass} />
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={saving || !title.trim()} onClick={submit} className="flex-1 text-[12px] font-bold py-2 rounded-lg bg-primary text-white cursor-pointer disabled:opacity-50">
          ثبت هدف
        </button>
        <button onClick={() => setOpen(false)} className="text-[12px] font-bold py-2 px-3 rounded-lg bg-slate-100 text-ink-soft cursor-pointer">
          انصراف
        </button>
      </div>
    </div>
  );
}

export function EngagementDetailModal({ engagementId, onClose, onChanged }: { engagementId: string; onClose: () => void; onChanged: () => void }) {
  const [engagement, setEngagement] = useState<MentoringEngagement | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  function refetch() {
    fetchMentoringEngagement(engagementId).then(setEngagement).catch(() => setEngagement(null));
  }
  useEffect(refetch, [engagementId]);

  function reload() {
    refetch();
    onChanged();
  }

  async function handleStatusChange(status: "PAUSED" | "ACTIVE" | "COMPLETED" | "CANCELLED") {
    await updateMentoringEngagement(engagementId, { status });
    reload();
  }

  async function submitCheckIn(goalId: string) {
    const note = window.prompt("یادداشت پیشرفت (یا مقدار عددی):");
    if (note == null) return;
    const asNumber = Number(note);
    await addMentoringGoalCheckIn(goalId, Number.isFinite(asNumber) && note.trim() !== "" && /^-?\d+(\.\d+)?$/.test(note.trim()) ? { value: asNumber } : { note });
    reload();
  }

  if (!engagement) {
    return (
      <Modal title="در حال بارگذاری..." onClose={onClose} width="max-w-[640px]">
        <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={engagement.title} onClose={onClose} width="max-w-[640px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12.5px] text-muted">
            {engagement.contact.name} · مشاور: {engagement.advisor.name}
          </div>
          <div className="flex items-center gap-1.5">
            {engagement.status === "ACTIVE" && (
              <button onClick={() => handleStatusChange("PAUSED")} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-warning-soft text-warning cursor-pointer">
                توقف موقت
              </button>
            )}
            {engagement.status === "PAUSED" && (
              <button onClick={() => handleStatusChange("ACTIVE")} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-success-soft text-success cursor-pointer">
                از سرگیری
              </button>
            )}
            {(engagement.status === "ACTIVE" || engagement.status === "PAUSED") && (
              <button onClick={() => handleStatusChange("COMPLETED")} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-primary-soft text-primary cursor-pointer">
                پایان همکاری
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-extrabold">جلسات</h3>
            {engagement.status === "ACTIVE" && (
              <button onClick={() => setNewSessionOpen(true)} className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer">
                <PlusIcon className="w-3.5 h-3.5" /> جلسه جدید
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            {(engagement.sessions ?? []).length === 0 ? (
              <div className="text-[12.5px] text-muted">هنوز جلسه‌ای ثبت نشده</div>
            ) : (
              engagement.sessions!.map((s) => <SessionRow key={s.id} session={s} onChanged={reload} />)
            )}
          </div>
        </div>

        <div>
          <h3 className="text-[13px] font-extrabold mb-2">اهداف و پیشرفت</h3>
          <div className="flex flex-col gap-2.5">
            {(engagement.goals ?? []).map((g) => (
              <div key={g.id} className="border border-border rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12.5px] font-bold">{g.title}</div>
                  <Badge tone={g.status === "ACHIEVED" ? "success" : g.status === "MISSED" ? "danger" : "neutral"}>{GOAL_STATUS_LABELS[g.status]}</Badge>
                </div>
                {g.type === "QUANTITATIVE" && g.targetValue != null && (
                  <div className="text-[11.5px] text-muted mt-1">
                    هدف: {g.targetValue} {g.unit ?? ""}
                  </div>
                )}
                {(g.checkIns ?? []).length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {g.checkIns!.slice(0, 3).map((ci) => (
                      <div key={ci.id} className="text-[11px] text-ink-soft bg-slate-50 rounded-lg px-2 py-1">
                        {formatJalaliDateTime(ci.recordedAt)} — {ci.value != null ? ci.value : ci.note}
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => submitCheckIn(g.id)} className="text-[11px] font-bold text-primary mt-2 cursor-pointer">
                  ثبت پیشرفت
                </button>
              </div>
            ))}
            <NewGoalForm engagementId={engagement.id} onCreated={reload} />
          </div>
        </div>

        {engagement.pricingModel === "PACKAGE" && engagement.packagePrice != null && (
          <div className="text-[12px] text-muted">قیمت بسته: {formatToman(engagement.packagePrice)}</div>
        )}
      </div>

      {newSessionOpen && <NewSessionModal engagement={engagement} onClose={() => setNewSessionOpen(false)} onCreated={reload} />}
    </Modal>
  );
}
