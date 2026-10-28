"use client";

import { useCallback, useEffect, useState } from "react";
import { useKeyedLoad } from "./use-keyed-load";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { formatToman, formatNumber, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { formatCard } from "@/lib/iran-bank";
import { downloadCsv } from "@/lib/csv";
import {
  fetchBanks,
  fetchCashBoxes,
  fetchChequeBooks,
  fetchChequeBook,
  fetchBankTransactions,
  fetchHolderStatement,
  voidBankTransaction,
  seedDefaultCashBox,
  setLeafStatus,
  updateChequeBook,
  type BankAccountRow,
  type CashBoxRow,
  type ChequeBookRow,
  type ChequeBookDetail,
  type BankTx,
  type HolderStatement,
  type LeafStatus,
  type PeriodSel,
} from "@/lib/accounting-api";
import { PeriodPicker, currentMonthKey } from "./PeriodPicker";
import { BankFormModal, CashBoxFormModal, ChequeBookFormModal, TransactionFormModal } from "./BankingModals";
import { PlusIcon, PencilIcon } from "@/components/icons";

type Sub = "banks" | "cash" | "cheques" | "tx";
const SUBS: Array<[Sub, string]> = [
  ["banks", "حساب‌های بانکی"],
  ["cash", "صندوق‌ها"],
  ["cheques", "دسته‌چک‌ها"],
  ["tx", "تراکنش‌ها"],
];

const btn = "min-h-[40px] px-3.5 rounded-xl text-[12.5px] font-bold cursor-pointer";
const TX_LABEL = { RECEIPT: "دریافت", PAYMENT: "پرداخت", TRANSFER: "انتقال" } as const;
const TX_TONE: Record<string, Tone> = { RECEIPT: "success", PAYMENT: "danger", TRANSFER: "primary" };
export const LEAF_LABEL: Record<LeafStatus, string> = { UNUSED: "مصرف‌نشده", ISSUED: "صادرشده", CLEARED: "پاس‌شده", BOUNCED: "برگشتی", VOID: "باطل", LOST: "مفقود" };
const LEAF_CLS: Record<LeafStatus, string> = {
  UNUSED: "bg-slate-50 border-border text-ink-soft",
  ISSUED: "bg-primary-soft border-primary/30 text-primary",
  CLEARED: "bg-success-soft border-success/30 text-success",
  BOUNCED: "bg-danger-soft border-danger/30 text-danger",
  VOID: "bg-slate-100 border-border text-muted line-through",
  LOST: "bg-warning-soft border-warning/30 text-warning",
};

export function BankingTab({ onOpenReconciliation }: { onOpenReconciliation: (accountId: string) => void }) {
  const [sub, setSub] = useState<Sub>("banks");
  const [banks, setBanks] = useState<BankAccountRow[] | null>(null);
  const [boxes, setBoxes] = useState<CashBoxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState<BankAccountRow | "new" | null>(null);
  const [boxForm, setBoxForm] = useState<CashBoxRow | "new" | null>(null);
  const [txForm, setTxForm] = useState<{ kind: "BANK" | "CASH"; id: string } | "new" | null>(null);
  const [statement, setStatement] = useState<{ kind: "BANK" | "CASH"; id: string; linkedAccountId: string } | null>(null);
  const [txReload, setTxReload] = useState(0);

  const reload = useCallback(() => {
    Promise.all([fetchBanks(), fetchCashBoxes()])
      .then(([b, c]) => {
        setError(null);
        setBanks(b);
        setBoxes(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "بارگذاری ناموفق بود"));
  }, []);
  useEffect(reload, [reload]);

  const linkedIds = [...(banks ?? []).map((b) => b.linkedAccountId), ...(boxes ?? []).map((b) => b.linkedAccountId)];
  const totalBank = (banks ?? []).reduce((s, b) => s + b.balance, 0);
  const totalCash = (boxes ?? []).reduce((s, b) => s + b.balance, 0);

  return (
    <div className="mt-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-surface border border-border rounded-2xl p-4"><div className="text-[12px] text-muted">جمع موجودی بانک‌ها</div><div className="text-lg font-extrabold mt-1">{formatToman(totalBank)}</div></div>
        <div className="bg-surface border border-border rounded-2xl p-4"><div className="text-[12px] text-muted">جمع موجودی صندوق‌ها</div><div className="text-lg font-extrabold mt-1">{formatToman(totalCash)}</div></div>
        <div className="bg-surface border border-border rounded-2xl p-4"><div className="text-[12px] text-muted">جمع نقد و بانک</div><div className="text-lg font-extrabold mt-1 text-primary">{formatToman(totalBank + totalCash)}</div></div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto" role="tablist">
          {SUBS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)} className={clsx(btn, "shrink-0 whitespace-nowrap", sub === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {sub === "banks" ? <button onClick={() => setBankForm("new")} className={clsx(btn, "bg-primary text-white flex items-center gap-1.5")}><PlusIcon className="w-4 h-4" />حساب بانکی</button> : null}
          {sub === "cash" ? <button onClick={() => setBoxForm("new")} className={clsx(btn, "bg-primary text-white flex items-center gap-1.5")}><PlusIcon className="w-4 h-4" />صندوق</button> : null}
          {sub === "tx" ? <button onClick={() => setTxForm("new")} className={clsx(btn, "bg-primary text-white flex items-center gap-1.5")}><PlusIcon className="w-4 h-4" />تراکنش جدید</button> : null}
        </div>
      </div>

      {error ? <div className="p-4 text-danger text-sm" role="alert">{error}</div> : null}

      {sub === "banks" ? (
        <Card className="p-2">
          {banks === null ? <Loading /> : banks.length === 0 ? <Empty text="هنوز حساب بانکی تعریف نشده است. با «حساب بانکی» شروع کنید." /> : banks.map((b, i) => (
            <div key={b.id} className={clsx("flex flex-wrap items-center gap-3 px-4 py-3.5", i < banks.length - 1 && "border-b border-border")}>
              <div className="flex-1 min-w-[200px]">
                <div className="text-[13.5px] font-bold flex items-center gap-2">{b.name}{!b.isActive ? <Badge tone="neutral">غیرفعال</Badge> : null}</div>
                <div className="text-[11.5px] text-muted mt-0.5">{[b.bankName, b.branch].filter(Boolean).join(" — ") || "—"}</div>
                <div className="text-[11.5px] text-muted mt-0.5" dir="ltr" style={{ textAlign: "start" }}>{b.sheba ?? ""}{b.cardNumber ? `  ${formatCard(b.cardNumber)}` : ""}</div>
              </div>
              <div className="text-[14px] font-extrabold" title="مانده از دفتر کل">{formatToman(b.balance)}</div>
              <div className="flex gap-1.5 flex-wrap">
                <button className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => setStatement({ kind: "BANK", id: b.id, linkedAccountId: b.linkedAccountId })}>صورت‌حساب</button>
                <button className={clsx(btn, "bg-slate-100 text-ink-soft")} onClick={() => setTxForm({ kind: "BANK", id: b.id })}>تراکنش</button>
                <button className={clsx(btn, "bg-slate-100 text-ink-soft")} aria-label="ویرایش" onClick={() => setBankForm(b)}><PencilIcon className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      {sub === "cash" ? (
        <Card className="p-2">
          {boxes === null ? <Loading /> : boxes.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">
              هنوز صندوقی تعریف نشده است.
              <div className="mt-3"><button className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => void seedDefaultCashBox().then(reload).catch((e) => setError(e instanceof Error ? e.message : "ناموفق"))}>ساخت «صندوق اصلی» (روی حساب ۱۰۱۰)</button></div>
            </div>
          ) : boxes.map((b, i) => (
            <div key={b.id} className={clsx("flex flex-wrap items-center gap-3 px-4 py-3.5", i < boxes.length - 1 && "border-b border-border")}>
              <div className="flex-1 min-w-[200px]">
                <div className="text-[13.5px] font-bold flex items-center gap-2">{b.name}{!b.isActive ? <Badge tone="neutral">غیرفعال</Badge> : null}</div>
                <div className="text-[11.5px] text-muted mt-0.5">مسئول: {b.custodianName ?? "—"} — حساب {toPersianDigits(b.linkedAccount.code)}</div>
              </div>
              <div className="text-[14px] font-extrabold">{formatToman(b.balance)}</div>
              <div className="flex gap-1.5 flex-wrap">
                <button className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => setStatement({ kind: "CASH", id: b.id, linkedAccountId: b.linkedAccountId })}>صورت‌حساب</button>
                <button className={clsx(btn, "bg-slate-100 text-ink-soft")} onClick={() => setTxForm({ kind: "CASH", id: b.id })}>تراکنش</button>
                <button className={clsx(btn, "bg-slate-100 text-ink-soft")} aria-label="ویرایش" onClick={() => setBoxForm(b)}><PencilIcon className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      {sub === "cheques" ? <ChequeBooksView banks={banks ?? []} /> : null}
      {sub === "tx" ? <TransactionsView banks={banks ?? []} boxes={boxes ?? []} reloadKey={txReload} /> : null}

      {bankForm ? <BankFormModal bank={bankForm === "new" ? undefined : bankForm} linkedIds={linkedIds} onClose={() => setBankForm(null)} onSaved={reload} /> : null}
      {boxForm ? <CashBoxFormModal box={boxForm === "new" ? undefined : boxForm} linkedIds={linkedIds} onClose={() => setBoxForm(null)} onSaved={reload} /> : null}
      {txForm ? (
        <TransactionFormModal
          banks={banks ?? []}
          boxes={boxes ?? []}
          presetHolder={txForm === "new" ? undefined : txForm}
          onClose={() => setTxForm(null)}
          onSaved={() => {
            reload();
            setTxReload((n) => n + 1);
          }}
        />
      ) : null}
      {statement ? <StatementModal target={statement} onClose={() => setStatement(null)} onReconcile={(id) => { setStatement(null); onOpenReconciliation(id); }} /> : null}
    </div>
  );
}

function Loading() {
  return <div className="p-8 text-center text-muted text-sm" role="status">در حال بارگذاری...</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-muted text-sm">{text}</div>;
}

// ── صورت‌حساب بانک/صندوق ───────────────────────────────────────────────────

function StatementModal({ target, onClose, onReconcile }: { target: { kind: "BANK" | "CASH"; id: string; linkedAccountId: string }; onClose: () => void; onReconcile: (accountId: string) => void }) {
  const [sel, setSel] = useState<PeriodSel>({ mode: "month", key: currentMonthKey() });
  const { data, error, loading } = useKeyedLoad<HolderStatement>(JSON.stringify([target.kind, target.id, sel]), () => fetchHolderStatement(target.kind, target.id, sel));

  function csv() {
    if (!data) return;
    downloadCsv(`statement-${data.holder.name}-${data.period.key ?? data.period.mode}.csv`, [
      ["تاریخ", "سند", "شرح", "بدهکار (ورود)", "بستانکار (خروج)", "مانده", "مغایرت‌گیری"],
      ["", "", "مانده ابتدای دوره", "", "", data.openingBalance, ""],
      ...data.rows.map((r) => [formatJalaliDate(r.date), r.entryNumber, r.description ?? "", r.debit, r.credit, r.runningBalance, r.reconciled ? "بله" : "خیر"]),
      ["", "", "مانده پایان دوره", data.totalDebit, data.totalCredit, data.closingBalance, ""],
    ]);
  }

  return (
    <Modal title={`صورت‌حساب ${data?.holder.name ?? ""}`} onClose={onClose} width="max-w-[860px]">
      <div className="flex flex-col gap-3">
        <PeriodPicker value={sel} onChange={setSel} allowedModes={["month", "fiscal", "all", "custom"]} />
        {loading ? <Loading /> : error ? <div className="text-danger text-sm" role="alert">{error}</div> : data ? (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[12.5px] text-muted">{data.period.label} — مانده پایان: <b className="text-ink">{formatToman(data.closingBalance)}</b></div>
              <div className="flex gap-2">
                <button className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => onReconcile(target.linkedAccountId)}>مغایرت‌گیری با صورت‌حساب بانک</button>
                <button className={clsx(btn, "bg-slate-100 text-ink-soft")} onClick={csv}>CSV</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b border-border">
                    {["تاریخ", "سند", "شرح", "ورود", "خروج", "مانده", "مغایرت"].map((h) => (<th key={h} className="text-start text-[11px] text-muted font-semibold py-2 px-2.5">{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border bg-slate-50 font-bold text-[12px]">
                    <td className="py-2 px-2.5" colSpan={5}>مانده ابتدای دوره</td>
                    <td className="py-2 px-2.5">{formatNumber(data.openingBalance)}</td>
                    <td />
                  </tr>
                  {data.rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted text-[12.5px]">در این بازه گردشی نیست</td></tr> : null}
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0 text-[12px]">
                      <td className="py-2 px-2.5 whitespace-nowrap">{formatJalaliDate(r.date)}</td>
                      <td className="py-2 px-2.5">{toPersianDigits(r.entryNumber)}</td>
                      <td className="py-2 px-2.5">{r.description ?? ""}{r.transaction?.status === "VOIDED" ? <Badge tone="neutral" className="ms-1.5">باطل</Badge> : null}</td>
                      <td className="py-2 px-2.5 text-success">{r.debit ? formatNumber(r.debit) : ""}</td>
                      <td className="py-2 px-2.5 text-danger">{r.credit ? formatNumber(r.credit) : ""}</td>
                      <td className="py-2 px-2.5 font-bold whitespace-nowrap">{formatNumber(r.runningBalance)}</td>
                      <td className="py-2 px-2.5">{r.reconciled ? <Badge tone="success">تطبیق‌شده</Badge> : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ── تراکنش‌ها ──────────────────────────────────────────────────────────────

function TransactionsView({ banks, boxes, reloadKey }: { banks: BankAccountRow[]; boxes: CashBoxRow[]; reloadKey: number }) {
  const [sel, setSel] = useState<PeriodSel>({ mode: "month", key: currentMonthKey() });
  const [holder, setHolder] = useState("");
  const [voiding, setVoiding] = useState<BankTx | null>(null);
  const [attach, setAttach] = useState<BankTx | null>(null);
  const [tick, setTick] = useState(0);
  const { data: rows, error } = useKeyedLoad<BankTx[]>(JSON.stringify([sel, holder, reloadKey, tick]), () => {
    const [kind, id] = holder.split(":");
    return fetchBankTransactions({ bankAccountId: kind === "BANK" ? id : undefined, cashBoxId: kind === "CASH" ? id : undefined }, sel);
  });

  const where = (t: BankTx) => [t.bankAccount?.name ?? t.cashBox?.name, t.toBankAccount?.name ?? t.toCashBox?.name].filter(Boolean).join(" ← ");

  return (
    <div className="flex flex-col gap-3">
      <PeriodPicker value={sel} onChange={setSel} />
      <select value={holder} onChange={(e) => setHolder(e.target.value)} className="min-h-[44px] text-[16px] sm:text-[13px] bg-surface border border-border rounded-xl px-3" aria-label="فیلتر بانک یا صندوق">
        <option value="">همه‌ی بانک‌ها و صندوق‌ها</option>
        {banks.map((b) => (<option key={b.id} value={`BANK:${b.id}`}>بانک — {b.name}</option>))}
        {boxes.map((b) => (<option key={b.id} value={`CASH:${b.id}`}>صندوق — {b.name}</option>))}
      </select>
      <Card className="p-2">
        {error ? <div className="p-4 text-danger text-sm" role="alert">{error}</div> : rows === null ? <Loading /> : rows.length === 0 ? <Empty text="در این بازه تراکنشی ثبت نشده است" /> : rows.map((t, i) => (
          <div key={t.id} className={clsx("flex flex-wrap items-center gap-3 px-4 py-3", i < rows.length - 1 && "border-b border-border", t.status === "VOIDED" && "opacity-60")}>
            <Badge tone={TX_TONE[t.type]}>{TX_LABEL[t.type]}</Badge>
            <div className="flex-1 min-w-[180px]">
              <div className={clsx("text-[13px] font-bold", t.status === "VOIDED" && "line-through")}>{where(t)}{t.contactName ? ` — ${t.contactName}` : ""}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{formatJalaliDate(t.date)} — شماره {toPersianDigits(t.number)}{t.referenceNo ? ` — مرجع ${toPersianDigits(t.referenceNo)}` : ""}{t.description ? ` — ${t.description}` : ""}</div>
              {t.status === "VOIDED" ? <div className="text-[11.5px] text-danger mt-0.5">باطل شد: {t.voidReason}</div> : null}
            </div>
            <div className="text-[13.5px] font-extrabold">{formatToman(t.amount)}</div>
            <div className="flex gap-1.5">
              <button className={clsx(btn, "bg-slate-100 text-ink-soft")} onClick={() => setAttach(t)}>پیوست</button>
              {t.status === "POSTED" ? <button className={clsx(btn, "bg-danger-soft text-danger")} onClick={() => setVoiding(t)}>ابطال</button> : null}
            </div>
          </div>
        ))}
      </Card>
      {voiding ? (
        <ReasonDialog
          title={`ابطال تراکنش ${toPersianDigits(voiding.number)}`}
          description="تراکنش حذف نمی‌شود؛ یک سند معکوس ثبت می‌شود و تراکنش «باطل» علامت می‌خورد. در ماه بسته‌شده ممکن نیست."
          confirmLabel="ابطال تراکنش"
          onConfirm={async (reason) => {
            await voidBankTransaction(voiding.id, reason);
            setTick((n) => n + 1);
          }}
          onClose={() => setVoiding(null)}
        />
      ) : null}
      {attach ? (
        <Modal title={`پیوست‌های تراکنش ${toPersianDigits(attach.number)}`} onClose={() => setAttach(null)} width="max-w-[520px]">
          <AttachmentsSection entityType="bank_transaction" entityId={attach.id} />
        </Modal>
      ) : null}
    </div>
  );
}

// ── دسته‌چک‌ها ─────────────────────────────────────────────────────────────

function ChequeBooksView({ banks }: { banks: BankAccountRow[] }) {
  const [books, setBooks] = useState<ChequeBookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchChequeBooks().then(setBooks).catch((e) => setError(e instanceof Error ? e.message : "بارگذاری ناموفق بود"));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button className={clsx(btn, "bg-primary text-white flex items-center gap-1.5")} onClick={() => setForm(true)}><PlusIcon className="w-4 h-4" />دسته‌چک جدید</button>
      </div>
      <Card className="p-2">
        {error ? <div className="p-4 text-danger text-sm" role="alert">{error}</div> : books === null ? <Loading /> : books.length === 0 ? <Empty text="هنوز دسته‌چکی ثبت نشده است" /> : books.map((b, i) => (
          <button key={b.id} onClick={() => setOpen(b.id)} className={clsx("w-full text-start flex flex-wrap items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50", i < books.length - 1 && "border-b border-border")}>
            <div className="flex-1 min-w-[180px]">
              <div className="text-[13.5px] font-bold">{b.name}{b.series ? ` — سری ${b.series}` : ""}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{b.bankAccount.name} — سریال {toPersianDigits(b.startSerial)} تا {toPersianDigits(b.endSerial)}</div>
            </div>
            <div className="text-[12px] text-ink-soft">{toPersianDigits(b.unused)} از {toPersianDigits(b.leafCount)} برگ مانده</div>
            <Badge tone={b.status === "ACTIVE" ? "success" : b.status === "EXHAUSTED" ? "warning" : "neutral"}>{b.status === "ACTIVE" ? "فعال" : b.status === "EXHAUSTED" ? "تمام‌شده" : "بسته"}</Badge>
          </button>
        ))}
      </Card>
      {form ? <ChequeBookFormModal banks={banks} onClose={() => setForm(false)} onSaved={load} /> : null}
      {open ? <ChequeBookModal id={open} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </div>
  );
}

function ChequeBookModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [book, setBook] = useState<ChequeBookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetchChequeBook(id).then(setBook).catch((e) => setError(e instanceof Error ? e.message : "بارگذاری ناموفق بود"));
  }, [id]);
  useEffect(load, [load]);

  const leaf = book?.leaves.find((l) => l.id === picked) ?? null;

  async function mark(status: "UNUSED" | "VOID" | "LOST") {
    if (!leaf) return;
    setBusy(true);
    setError(null);
    try {
      await setLeafStatus(leaf.id, status);
      setPicked(null);
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const counts = (book?.leaves ?? []).reduce<Record<string, number>>((m, l) => ({ ...m, [l.status]: (m[l.status] ?? 0) + 1 }), {});

  return (
    <Modal title={book ? `${book.name} — ${book.bankAccount.name}` : "دسته‌چک"} onClose={onClose} width="max-w-[720px]">
      {!book ? (error ? <div className="text-danger text-sm" role="alert">{error}</div> : <Loading />) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LEAF_LABEL) as LeafStatus[]).map((s) => (
              <span key={s} className={clsx("text-[11.5px] font-bold px-2.5 py-1 rounded-lg border", LEAF_CLS[s])}>{LEAF_LABEL[s]}: {toPersianDigits(counts[s] ?? 0)}</span>
            ))}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
            {book.leaves.map((l) => (
              <button key={l.id} onClick={() => setPicked(l.id === picked ? null : l.id)} aria-pressed={picked === l.id} className={clsx("min-h-[48px] rounded-xl border text-[12.5px] font-bold cursor-pointer px-1", LEAF_CLS[l.status], picked === l.id && "ring-2 ring-primary")} title={LEAF_LABEL[l.status]}>
                {toPersianDigits(l.serial)}
                <div className="text-[10px] font-semibold opacity-80">{LEAF_LABEL[l.status]}</div>
              </button>
            ))}
          </div>
          {leaf ? (
            <div className="bg-slate-50 border border-border rounded-xl p-3.5 text-[12.5px] flex flex-col gap-2">
              <div className="font-bold">برگ {toPersianDigits(leaf.serial)} — {LEAF_LABEL[leaf.status]}</div>
              {leaf.linkedCheck ? (
                <div className="text-ink-soft">چک صیادی {toPersianDigits(leaf.linkedCheck.sayadId)} — {formatToman(leaf.linkedCheck.amount)} — سررسید {formatJalaliDate(leaf.linkedCheck.dueDate)}{leaf.linkedCheck.contact ? ` — ${leaf.linkedCheck.contact.name}` : ""}</div>
              ) : null}
              {leaf.statusNote ? <div className="text-muted">{leaf.statusNote}</div> : null}
              {!leaf.linkedCheck && (leaf.status === "UNUSED" || leaf.status === "VOID" || leaf.status === "LOST") ? (
                <div className="flex gap-2 flex-wrap">
                  {leaf.status === "UNUSED" ? (<><button disabled={busy} className={clsx(btn, "bg-slate-200 text-ink-soft")} onClick={() => mark("VOID")}>باطل کردن برگ</button><button disabled={busy} className={clsx(btn, "bg-warning-soft text-warning")} onClick={() => mark("LOST")}>مفقود شد</button></>) : (<button disabled={busy} className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => mark("UNUSED")}>بازگرداندن به مصرف‌نشده</button>)}
                </div>
              ) : null}
              {leaf.status === "UNUSED" ? <p className="text-[11.5px] text-muted">برای استفاده از این برگ، هنگام ثبت «چک صادرشده» در بخش چک‌ها همین دسته‌چک را انتخاب کنید.</p> : null}
            </div>
          ) : null}
          {error ? <div className="text-danger text-[12px]" role="alert">{error}</div> : null}
          <div className="flex gap-2">
            {book.status !== "CLOSED" ? (
              <button className={clsx(btn, "bg-slate-100 text-ink-soft")} onClick={() => void updateChequeBook(book.id, { status: "CLOSED" }).then(() => { load(); onChanged(); })}>بستن دسته‌چک</button>
            ) : (
              <button className={clsx(btn, "bg-primary-soft text-primary")} onClick={() => void updateChequeBook(book.id, { status: "ACTIVE" }).then(() => { load(); onChanged(); })}>فعال‌سازی دوباره</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
