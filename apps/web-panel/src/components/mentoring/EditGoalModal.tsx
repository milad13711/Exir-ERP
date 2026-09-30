import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { updateMentoringGoal, ApiError, type MentoringGoal, type MentoringGoalStatus } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const STATUS_LABELS: Record<MentoringGoalStatus, string> = {
  IN_PROGRESS: "در حال پیگیری",
  ACHIEVED: "محقق‌شده",
  MISSED: "محقق‌نشده",
  CANCELLED: "لغوشده",
};

export function EditGoalModal({ goal, onClose, onSaved }: { goal: MentoringGoal; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(goal.title);
  const [unit, setUnit] = useState(goal.unit ?? "");
  const [targetValue, setTargetValue] = useState(goal.targetValue != null ? String(goal.targetValue) : "");
  const [targetDate, setTargetDate] = useState(goal.targetDate ? goal.targetDate.slice(0, 10) : "");
  const [status, setStatus] = useState<MentoringGoalStatus>(goal.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateMentoringGoal(goal.id, {
        title: title.trim(),
        unit: unit.trim() || undefined,
        targetValue: targetValue ? Number(targetValue) : undefined,
        targetDate: targetDate || undefined,
        status,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ویرایش هدف ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ویرایش هدف" onClose={onClose} width="max-w-[460px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>عنوان هدف</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>

        {goal.type === "QUANTITATIVE" && (
          <div className="flex gap-2.5">
            <div className="flex-1">
              <label className={labelClass}>مقدار هدف</label>
              <input value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className={inputClass} />
            </div>
            <div className="flex-1">
              <label className={labelClass}>واحد</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="مثلاً کیلوگرم" className={inputClass} />
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>تاریخ هدف (اختیاری)</label>
          <JalaliDateInput value={targetDate} onChange={setTargetDate} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>وضعیت</label>
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(STATUS_LABELS) as MentoringGoalStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer ${status === s ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !title.trim()} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
        </button>
      </form>
    </Modal>
  );
}
