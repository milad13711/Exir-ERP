import { useState } from "react";
import { CloseIcon } from "@/components/icons";
import { suspendTenant, ApiError, type AdminTenant } from "@/lib/api";

export function SuspendTenantModal({
  tenant,
  onClose,
  onSuspended,
}: {
  tenant: AdminTenant;
  onClose: () => void;
  onSuspended: (tenant: AdminTenant) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await suspendTenant(tenant.id, reason.trim());
      onSuspended(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-[420px] shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-extrabold">تعلیق «{tenant.name}»</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-slate-100 cursor-pointer">
            <CloseIcon className="w-4.5 h-4.5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5">
          <p className="text-[12px] text-muted">دسترسی کاربران این تننت بلافاصله مسدود می‌شود.</p>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="دلیل تعلیق (مثلاً عدم پرداخت)..."
            rows={3}
            className="w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 resize-none focus:border-primary"
          />
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={submitting || !reason.trim()}
            className="w-full py-2.5 rounded-xl bg-danger text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال تعلیق..." : "تعلیق تننت"}
          </button>
        </form>
      </div>
    </div>
  );
}
