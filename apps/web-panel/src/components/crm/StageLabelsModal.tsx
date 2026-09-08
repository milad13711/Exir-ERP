"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { updateFunnelStageLabels } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";

const STAGE_ORDER = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "CUSTOMER", "REPEAT_CUSTOMER"] as const;

export function StageLabelsModal({
  labels,
  onClose,
  onSaved,
}: {
  labels: Record<string, string>;
  onClose: () => void;
  onSaved: (labels: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(labels);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await updateFunnelStageLabels(draft);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره‌ی عنوان‌ها ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ویرایش عنوان مراحل قیف" onClose={onClose} width="max-w-[440px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-[12px] text-muted -mt-1 mb-1">فقط عنوان نمایشی هر مرحله عوض می‌شود — نحوه‌ی محاسبه‌ی هر مرحله همان است.</p>
        {STAGE_ORDER.map((stage) => (
          <div key={stage}>
            <label className="text-[11.5px] font-semibold text-ink-soft mb-1 block">{labels[stage]}</label>
            <input value={draft[stage] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [stage]: e.target.value }))} className={inputClass} />
          </div>
        ))}
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        <button type="submit" disabled={saving} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </form>
    </Modal>
  );
}
