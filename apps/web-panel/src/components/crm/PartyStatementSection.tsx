import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchPartyStatement,
  createPartyTransaction,
  createPartyTransfer,
  updateCrmContact,
  fetchCrmContacts,
  ApiError,
  type PartyStatement,
  type CrmContactDetail,
  type CrmContact,
} from "@/lib/api";

const KIND_LABELS: Record<string, string> = {
  SALES_INVOICE: "فاکتور فروش",
  SALES_PAYMENT: "دریافت وجه فاکتور",
  SALES_RETURN: "مرجوعی فروش",
  PURCHASE_ORDER: "سفارش خرید",
  PURCHASE_PAYMENT: "پرداخت وجه سفارش",
  PURCHASE_RETURN: "مرجوعی خرید",
  PARTY_RECEIPT: "دریافت وجه",
  PARTY_PAYMENT: "پرداخت وجه",
  CHECK_RECEIVED: "چک دریافتی",
  CHECK_ISSUED: "چک صادرشده",
};

export function PartyStatementSection({
  contact,
  onChanged,
}: {
  contact: CrmContactDetail;
  onChanged: () => void;
}) {
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [togglingSupplier, setTogglingSupplier] = useState(false);
  const [txOpen, setTxOpen] = useState<"RECEIPT" | "PAYMENT" | null>(null);
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [transferOtherId, setTransferOtherId] = useState("");
  const [transferDirection, setTransferDirection] = useState<"THIS_PAYS_OTHER" | "OTHER_PAYS_THIS">(
    "THIS_PAYS_OTHER",
  );
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    if (transferOpen) fetchCrmContacts().then(setContacts).catch(() => setContacts([]));
  }, [transferOpen]);

  async function handleSubmitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferOtherId || !Number(transferAmount)) return;
    setTransferSubmitting(true);
    setTransferError(null);
    try {
      const [fromContactId, toContactId] =
        transferDirection === "THIS_PAYS_OTHER" ? [contact.id, transferOtherId] : [transferOtherId, contact.id];
      await createPartyTransfer({
        fromContactId,
        toContactId,
        amount: Number(transferAmount),
        note: transferNote.trim() || undefined,
      });
      setTransferAmount("");
      setTransferNote("");
      setTransferOtherId("");
      setTransferOpen(false);
      reload();
    } catch (err) {
      setTransferError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setTransferSubmitting(false);
    }
  }

  function reload() {
    fetchPartyStatement(contact.id).then(setStatement).catch(() => {});
  }
  useEffect(reload, [contact.id]);

  async function handleToggleSupplier() {
    setTogglingSupplier(true);
    try {
      await updateCrmContact(contact.id, { isSupplier: !contact.isSupplier });
      onChanged();
    } finally {
      setTogglingSupplier(false);
    }
  }

  async function handleSubmitTx(e: React.FormEvent) {
    e.preventDefault();
    if (!txOpen || !Number(txAmount)) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPartyTransaction(contact.id, {
        type: txOpen,
        amount: Number(txAmount),
        note: txNote.trim() || undefined,
      });
      setTxAmount("");
      setTxNote("");
      setTxOpen(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">گردش حساب</span>
          {contact.isSupplier ? <Badge tone="accent">تأمین‌کننده</Badge> : null}
        </div>
        <button
          onClick={handleToggleSupplier}
          disabled={togglingSupplier}
          className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        >
          {contact.isSupplier ? "حذف از تأمین‌کنندگان" : "این مخاطب تأمین‌کننده هم هست"}
        </button>
      </div>

      {statement ? (
        <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-border rounded-xl p-3.5 mb-3">
          <div>
            <div className="text-[11px] text-muted">طلب ما از این مخاطب (فروش)</div>
            <div className={`text-[14px] font-extrabold mt-0.5 ${statement.arBalance > 0 ? "text-danger" : "text-ink"}`}>
              {formatToman(statement.arBalance)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">بدهی ما به این مخاطب (خرید)</div>
            <div className={`text-[14px] font-extrabold mt-0.5 ${statement.apBalance > 0 ? "text-warning" : "text-ink"}`}>
              {formatToman(statement.apBalance)}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setTxOpen(txOpen === "RECEIPT" ? null : "RECEIPT")}
          className="flex-1 py-2 rounded-lg bg-success-soft text-success text-[12px] font-bold cursor-pointer"
        >
          ثبت دریافت
        </button>
        <button
          onClick={() => setTxOpen(txOpen === "PAYMENT" ? null : "PAYMENT")}
          className="flex-1 py-2 rounded-lg bg-danger-soft text-danger text-[12px] font-bold cursor-pointer"
        >
          ثبت پرداخت
        </button>
      </div>

      {txOpen ? (
        <form onSubmit={handleSubmitTx} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-3">
          <input
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مبلغ (تومان)"
            dir="ltr"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <input
            value={txNote}
            onChange={(e) => setTxNote(e.target.value)}
            placeholder="توضیحات (اختیاری)"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={submitting || !Number(txAmount)}
            className="py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : txOpen === "RECEIPT" ? "ثبت دریافت وجه" : "ثبت پرداخت وجه"}
          </button>
        </form>
      ) : null}

      <button
        onClick={() => setTransferOpen((v) => !v)}
        className="w-full py-2 rounded-lg bg-accent-soft text-accent text-[12px] font-bold cursor-pointer mb-3"
      >
        تسویه‌ی مستقیم با یک طرف‌حساب دیگر (بدون عبور از صندوق/بانک ما)
      </button>

      {transferOpen ? (
        <form onSubmit={handleSubmitTransfer} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-3">
          <select
            value={transferDirection}
            onChange={(e) => setTransferDirection(e.target.value as "THIS_PAYS_OTHER" | "OTHER_PAYS_THIS")}
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          >
            <option value="THIS_PAYS_OTHER">این مخاطب مستقیم به طرف زیر پرداخت کرد</option>
            <option value="OTHER_PAYS_THIS">طرف زیر مستقیم به این مخاطب پرداخت کرد</option>
          </select>
          <select
            value={transferOtherId}
            onChange={(e) => setTransferOtherId(e.target.value)}
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          >
            <option value="">انتخاب طرف دیگر...</option>
            {contacts
              .filter((c) => c.id !== contact.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.name}
                </option>
              ))}
          </select>
          <input
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مبلغ (تومان)"
            dir="ltr"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <input
            value={transferNote}
            onChange={(e) => setTransferNote(e.target.value)}
            placeholder="توضیحات (اختیاری)"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          {transferError ? <div className="text-[11.5px] text-danger">{transferError}</div> : null}
          <button
            type="submit"
            disabled={transferSubmitting || !transferOtherId || !Number(transferAmount)}
            className="py-2 rounded-lg bg-accent text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
          >
            {transferSubmitting ? "در حال ثبت..." : "ثبت تسویه"}
          </button>
        </form>
      ) : null}

      {statement && statement.lines.length > 0 ? (
        <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
          {statement.lines
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={`${l.kind}-${l.refId}-${i}`} className="flex items-center justify-between text-[12px] px-2 py-1.5">
                <div>
                  <span className="text-ink-soft">{KIND_LABELS[l.kind] ?? l.kind}</span>
                  <span className="text-muted"> — {l.description}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted">{formatJalaliDate(l.date)}</span>
                  {l.arDelta !== 0 ? (
                    <span className={l.arDelta > 0 ? "text-danger font-bold" : "text-success font-bold"} dir="ltr">
                      {l.arDelta > 0 ? "+" : ""}
                      {l.arDelta.toLocaleString("en-US")}
                    </span>
                  ) : null}
                  {l.apDelta !== 0 ? (
                    <span className={l.apDelta > 0 ? "text-warning font-bold" : "text-success font-bold"} dir="ltr">
                      {l.apDelta > 0 ? "+" : ""}
                      {l.apDelta.toLocaleString("en-US")}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
