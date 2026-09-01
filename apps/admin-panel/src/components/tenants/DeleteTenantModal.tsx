import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { deleteTenant, ApiError, type AdminTenant } from "@/lib/api";

export function DeleteTenantModal({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: AdminTenant;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await deleteTenant(tenant.id, confirmText.trim());
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="حذف دائمی تننت" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl p-3.5 leading-relaxed">
          این عمل دیتابیس مجزای «{tenant.name}» و همه‌ی داده‌های آن (کاربران، فاکتورها، اسناد) را برای همیشه
          حذف می‌کند و غیرقابل بازگشت است.
        </div>
        <div>
          <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">
            برای تأیید، شناسه‌ی تننت را دقیقاً تایپ کنید:{" "}
            <code className="font-mono text-danger" dir="ltr">
              {tenant.slug}
            </code>
          </label>
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-danger transition-colors font-mono"
            dir="ltr"
          />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || confirmText.trim() !== tenant.slug}
          className="w-full py-2.5 rounded-xl bg-danger text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال حذف..." : "حذف دائمی تننت"}
        </button>
      </form>
    </Modal>
  );
}
