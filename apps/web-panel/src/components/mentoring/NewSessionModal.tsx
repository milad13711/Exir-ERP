import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { createMentoringSession, updateMentoringSession, ApiError, type MentoringEngagement, type MentoringSession, type MentoringSessionMode } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const MODE_LABELS: Record<MentoringSessionMode, string> = { ONLINE: "آنلاین", PHONE: "تلفنی", IN_PERSON: "حضوری" };

/** برای ساخت جلسه‌ی جدید `engagement` بدهید؛ برای ویرایش جلسه‌ی زمان‌بندی‌شده، `session` را هم بدهید. */
export function NewSessionModal({
  engagement,
  session,
  onClose,
  onCreated,
}: {
  engagement: MentoringEngagement;
  session?: MentoringSession;
  onClose: () => void;
  onCreated: () => void;
}) {
  const editing = !!session;
  const [mode, setMode] = useState<MentoringSessionMode>(session?.mode ?? "ONLINE");
  // بدون مقدار پیش‌فرض عمداً — محاسبه‌ی «اکنون» در بدنه‌ی رندر (برای مقدار اولیه‌ی state) طبق قانون react-hooks/purity مجاز نیست
  const [scheduledAt, setScheduledAt] = useState(session?.scheduledAt ?? "");
  const [durationMinutes, setDurationMinutes] = useState(session ? String(session.durationMinutes) : "60");
  const [location, setLocation] = useState(session?.location ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = !!scheduledAt && (mode !== "IN_PERSON" || !!location.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateMentoringSession(session.id, {
          mode,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes) || 60,
          location: location.trim() || undefined,
        });
      } else {
        await createMentoringSession({
          engagementId: engagement.id,
          mode,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes) || 60,
          location: location.trim() || undefined,
        });
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : editing ? "ویرایش جلسه ناموفق بود" : "ثبت جلسه ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? `ویرایش جلسه — ${engagement.title}` : `جلسه‌ی جدید — ${engagement.title}`} onClose={onClose} width="max-w-[460px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نحوه‌ی برگزاری</label>
          <div className="flex gap-2">
            {(Object.keys(MODE_LABELS) as MentoringSessionMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 text-[12px] font-bold py-2 rounded-xl border cursor-pointer ${mode === m ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>زمان جلسه</label>
          <JalaliDateTimeInput value={scheduledAt} onChange={setScheduledAt} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>مدت جلسه (دقیقه)</label>
          <input value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
        </div>

        {mode === "IN_PERSON" ? (
          <div>
            <label className={labelClass}>آدرس محل جلسه</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
          </div>
        ) : mode === "ONLINE" ? (
          <div>
            <label className={labelClass}>لینک جلسه‌ی آنلاین (اختیاری)</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} dir="ltr" placeholder="https://..." className={inputClass} />
          </div>
        ) : null}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !formValid} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ثبت..." : editing ? "ذخیره تغییرات" : "ثبت جلسه"}
        </button>
      </form>
    </Modal>
  );
}
