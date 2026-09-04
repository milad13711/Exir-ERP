import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { signContract, terminateContract, renewContract, type Contract, type ContractStatus } from "@/lib/api";

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  EXPIRED: "منقضی‌شده",
  TERMINATED: "فسخ‌شده",
};
const STATUS_TONES: Record<ContractStatus, "primary" | "success" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  EXPIRED: "danger",
  TERMINATED: "danger",
};

export function ContractDetailModal({
  contract,
  onClose,
  onChanged,
}: {
  contract: Contract;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [renewOpen, setRenewOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");

  async function handleSign() {
    setBusy(true);
    setError(null);
    try {
      await signContract(contract.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "امضای قرارداد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleTerminate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await terminateContract(contract.id, terminateReason.trim() || undefined);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فسخ قرارداد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenew(e: React.FormEvent) {
    e.preventDefault();
    if (!newEndDate) return;
    setBusy(true);
    setError(null);
    try {
      await renewContract(contract.id, newEndDate);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تمدید قرارداد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`قرارداد شماره ${contract.contractNo}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold">{contract.title}</div>
            <div className="text-[12.5px] text-muted mt-1">
              {contract.contact.name}
              {contract.contact.company ? ` — ${contract.contact.company}` : ""}
            </div>
          </div>
          <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">ارزش قرارداد</div>
            <div className="text-[13.5px] font-extrabold">{formatToman(contract.value)}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">نوع</div>
            <div className="text-[13.5px] font-bold">{contract.type === "SALES" ? "فروش" : "خرید"}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">تاریخ شروع</div>
            <div className="text-[13px] font-bold">{formatJalaliDate(contract.startDate)}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">تاریخ پایان</div>
            <div className="text-[13px] font-bold">{formatJalaliDate(contract.endDate)}</div>
          </div>
        </div>

        {contract.terms && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">شرح بندها و شرایط</div>
            <div className="text-[12.5px] text-ink-soft leading-relaxed bg-slate-50 rounded-xl p-3 whitespace-pre-wrap">
              {contract.terms}
            </div>
          </div>
        )}

        {contract.status === "TERMINATED" && contract.terminationReason && (
          <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl p-3">
            دلیل فسخ: {contract.terminationReason}
          </div>
        )}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        {terminateOpen ? (
          <form onSubmit={handleTerminate} className="flex flex-col gap-2.5 bg-danger-soft rounded-xl p-3.5">
            <label className="text-[12px] font-semibold text-danger">دلیل فسخ (اختیاری)</label>
            <input
              value={terminateReason}
              onChange={(e) => setTerminateReason(e.target.value)}
              className="text-[13px] outline-none bg-white border border-border rounded-lg px-3 py-2"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="text-[12px] font-bold text-white bg-danger px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                تأیید فسخ
              </button>
              <button type="button" onClick={() => setTerminateOpen(false)} className="text-[12px] font-bold text-ink-soft">
                انصراف
              </button>
            </div>
          </form>
        ) : renewOpen ? (
          <form onSubmit={handleRenew} className="flex flex-col gap-2.5 bg-primary-soft rounded-xl p-3.5">
            <label className="text-[12px] font-semibold text-primary">تاریخ پایان جدید</label>
            <JalaliDateInput
              value={newEndDate}
              onChange={setNewEndDate}
              className="text-[13px] outline-none bg-white border border-border rounded-lg px-3 py-2"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !newEndDate}
                className="text-[12px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                تأیید تمدید
              </button>
              <button type="button" onClick={() => setRenewOpen(false)} className="text-[12px] font-bold text-ink-soft">
                انصراف
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {contract.status === "DRAFT" && (
              <button
                onClick={handleSign}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                امضا و فعال‌سازی
              </button>
            )}
            {(contract.status === "ACTIVE" || contract.status === "EXPIRED") && (
              <button
                onClick={() => setRenewOpen(true)}
                className="flex-1 py-2.5 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold cursor-pointer"
              >
                تمدید
              </button>
            )}
            {contract.status === "ACTIVE" && (
              <button
                onClick={() => setTerminateOpen(true)}
                className="flex-1 py-2.5 rounded-xl border border-danger/30 text-danger text-[12.5px] font-bold cursor-pointer"
              >
                فسخ قرارداد
              </button>
            )}
          </div>
        )}

        <AttachmentsSection entityType="Contract" entityId={contract.id} />
      </div>
    </Modal>
  );
}
