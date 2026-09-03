import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createWorkCenter, ApiError } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewWorkCenterModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [sequenceOrder, setSequenceOrder] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createWorkCenter({ name: name.trim(), sequenceOrder: Number(sequenceOrder || 0) });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="ایستگاه تولید جدید" onClose={onClose} width="max-w-[420px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام ایستگاه</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً خط پلت" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>ترتیب نمایش</label>
          <input
            value={sequenceOrder}
            onChange={(e) => setSequenceOrder(e.target.value.replace(/[^0-9]/g, ""))}
            className={inputClass}
            dir="ltr"
            inputMode="numeric"
          />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ذخیره..." : "ذخیره ایستگاه"}
        </button>
      </form>
    </Modal>
  );
}
