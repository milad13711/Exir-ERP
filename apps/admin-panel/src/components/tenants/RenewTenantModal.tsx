import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { renewTenant, ApiError } from "@/lib/api";

export function RenewTenantModal({
  tenantId,
  tenantName,
  onClose,
  onRenewed,
}: {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await renewTenant(tenantId, months);
      onRenewed();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`تمدید اشتراک «${tenantName}»`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <p className="text-[12px] text-muted">
          تاریخ انقضا از امروز (یا پایان دوره‌ی فعلی، هرکدام دیرتر بود) به تعداد ماه انتخابی جلو می‌رود و یک
          فاکتور پرداخت‌شده صادر می‌شود.
        </p>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تعداد ماه</label>
          <div className="flex items-center gap-2">
            {[1, 3, 6, 12].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={`flex-1 py-2 rounded-xl text-[13px] font-bold cursor-pointer border ${
                  months === m ? "bg-primary text-white border-primary" : "border-border text-ink-soft"
                }`}
              >
                {m} ماه
              </button>
            ))}
          </div>
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "تمدید و صدور فاکتور"}
        </button>
      </form>
    </Modal>
  );
}
