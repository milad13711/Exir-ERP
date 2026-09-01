import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  markCheckDeposited,
  markCheckCleared,
  markCheckBounced,
  cancelCheck,
  endorseCheck,
  updateCheckReminderDays,
  fetchCrmContacts,
  ApiError,
  type Check,
  type CrmContact,
} from "@/lib/api";

const STATUS_LABELS_BY_DIRECTION: Record<Check["direction"], Record<Check["status"], string>> = {
  RECEIVED: {
    PENDING: "ثبت‌شده",
    DEPOSITED: "واگذار به بانک",
    CLEARED: "پاس‌شده",
    BOUNCED: "برگشت‌خورده",
    CANCELLED: "باطل‌شده",
    ENDORSED: "پشت‌نویسی‌شده",
  },
  ISSUED: {
    PENDING: "صادرشده",
    DEPOSITED: "نزد بانک طرف مقابل",
    CLEARED: "پاس‌شده",
    BOUNCED: "برگشت‌خورده",
    CANCELLED: "باطل‌شده",
    ENDORSED: "پشت‌نویسی‌شده",
  },
};

const STATUS_TONES: Record<Check["status"], "neutral" | "warning" | "success" | "danger" | "primary"> = {
  PENDING: "warning",
  DEPOSITED: "primary",
  CLEARED: "success",
  BOUNCED: "danger",
  CANCELLED: "neutral",
  ENDORSED: "primary",
};

export function CheckDetailModal({
  check,
  onClose,
  onChanged,
}: {
  check: Check;
  onClose: () => void;
  onChanged: (updated: Check) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderDays, setReminderDays] = useState(String(check.reminderDaysBefore));
  const [endorseOpen, setEndorseOpen] = useState(false);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [endorseToId, setEndorseToId] = useState("");

  const party = check.contact;

  useEffect(() => {
    if (endorseOpen) fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
  }, [endorseOpen]);

  async function run(action: () => Promise<Check>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      onChanged(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveReminder() {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateCheckReminderDays(check.id, Number(reminderDays) || 0);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`چک ${check.direction === "RECEIVED" ? "دریافتی" : "صادرشده"}`} onClose={onClose} width="max-w-[480px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-extrabold">{party?.company || party?.name || "—"}</div>
            <div className="text-[11.5px] text-muted mt-0.5" dir="ltr">
              صیادی: {check.sayadId}
            </div>
          </div>
          <Badge tone={STATUS_TONES[check.status]}>{STATUS_LABELS_BY_DIRECTION[check.direction][check.status]}</Badge>
        </div>

        <div className="bg-slate-50 border border-border rounded-xl px-3.5 py-3 flex flex-col gap-1.5 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-muted">مبلغ</span>
            <span className="font-bold">{formatToman(check.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">سررسید</span>
            <span className="font-bold">{formatJalaliDate(check.dueDate)}</span>
          </div>
          {check.bankName ? (
            <div className="flex justify-between">
              <span className="text-muted">بانک</span>
              <span className="font-bold">{check.bankName}</span>
            </div>
          ) : null}
          {check.invoice ? (
            <div className="flex justify-between">
              <span className="text-muted">فاکتور مرتبط</span>
              <span className="font-bold">#{check.invoice.invoiceNo}</span>
            </div>
          ) : null}
          {check.purchaseOrder ? (
            <div className="flex justify-between">
              <span className="text-muted">سفارش خرید مرتبط</span>
              <span className="font-bold">#{check.purchaseOrder.orderNo}</span>
            </div>
          ) : null}
          {check.reminderSentAt ? (
            <div className="flex justify-between text-success">
              <span>یادآوری ارسال‌شده</span>
              <span>{formatJalaliDate(check.reminderSentAt)}</span>
            </div>
          ) : null}
          {check.endorsedToContact ? (
            <div className="flex justify-between">
              <span className="text-muted">پشت‌نویسی به</span>
              <span className="font-bold">{check.endorsedToContact.company || check.endorsedToContact.name}</span>
            </div>
          ) : null}
        </div>

        {check.status === "PENDING" || check.status === "DEPOSITED" ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-muted mb-1 block">یادآوری چند روز قبل از سررسید</label>
              <input
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value.replace(/[^0-9]/g, ""))}
                dir="ltr"
                className="w-full text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2"
              />
            </div>
            <button
              onClick={handleSaveReminder}
              disabled={busy}
              className="mt-5 py-2 px-3 rounded-lg bg-slate-100 text-ink-soft text-[12px] font-bold cursor-pointer disabled:opacity-50"
            >
              ذخیره
            </button>
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        {check.status === "PENDING" ? (
          <button
            onClick={() => run(() => markCheckDeposited(check.id))}
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            واگذاری به بانک (در جریان وصول)
          </button>
        ) : null}

        {check.status === "PENDING" && check.direction === "RECEIVED" ? (
          <>
            {!endorseOpen ? (
              <button
                onClick={() => setEndorseOpen(true)}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-accent-soft text-accent text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                پشت‌نویسی و واگذاری به شخص دیگر
              </button>
            ) : (
              <div className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3">
                <select
                  value={endorseToId}
                  onChange={(e) => setEndorseToId(e.target.value)}
                  className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                >
                  <option value="">واگذاری به...</option>
                  {contacts
                    .filter((c) => c.id !== check.contact?.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company || c.name}
                      </option>
                    ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEndorseOpen(false)}
                    className="flex-1 py-2 rounded-lg bg-slate-100 text-ink-soft text-[12px] font-bold cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    onClick={() => run(() => endorseCheck(check.id, endorseToId))}
                    disabled={busy || !endorseToId}
                    className="flex-1 py-2 rounded-lg bg-accent text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    تأیید پشت‌نویسی
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}

        {check.status === "PENDING" || check.status === "DEPOSITED" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => run(() => markCheckCleared(check.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-success text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              پاس شد
            </button>
            <button
              onClick={() => run(() => markCheckBounced(check.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-danger text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              برگشت خورد
            </button>
            <button
              onClick={() => run(() => cancelCheck(check.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              لغو
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
