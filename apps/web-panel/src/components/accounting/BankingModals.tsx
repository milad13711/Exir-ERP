"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import {
  createBank,
  updateBank,
  createCashBox,
  updateCashBox,
  createChequeBook,
  createBankTransaction,
  type BankAccountRow,
  type CashBoxRow,
  type BankTxInput,
  type BankTx,
} from "@/lib/accounting-api";
import { fetchAccounts, fetchUsers, type Account, type TenantUser } from "@/lib/api";
import { isValidCardNumber, isValidSheba, normalizeCard, normalizeDigits, normalizeSheba } from "@/lib/iran-bank";

export const fieldInput =
  "w-full min-h-[44px] text-[16px] sm:text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
export const fieldLabel = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
const submitCls = "mt-1.5 w-full min-h-[44px] py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "خطایی رخ داد");
const digits = (v: string) => normalizeDigits(v).replace(/[^0-9]/g, "");

function useCashAccounts(excludeIds: string[]) {
  const [list, setList] = useState<Account[]>([]);
  useEffect(() => {
    fetchAccounts()
      .then((all) => setList(all.filter((a) => a.type === "ASSET" && !excludeIds.includes(a.id))))
      .catch(() => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeIds.join(",")]);
  return list;
}

// ── حساب بانکی ─────────────────────────────────────────────────────────────

export function BankFormModal({ bank, linkedIds, onClose, onSaved }: { bank?: BankAccountRow; linkedIds: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(bank?.name ?? "");
  const [bankName, setBankName] = useState(bank?.bankName ?? "");
  const [branch, setBranch] = useState(bank?.branch ?? "");
  const [accountNumber, setAccountNumber] = useState(bank?.accountNumber ?? "");
  const [sheba, setSheba] = useState(bank?.sheba ?? "");
  const [card, setCard] = useState(bank?.cardNumber ?? "");
  const [opening, setOpening] = useState("");
  const [openingNeg, setOpeningNeg] = useState(false);
  const [openingDate, setOpeningDate] = useState(today());
  const [linked, setLinked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = useCashAccounts(linkedIds);

  const shebaBad = sheba.trim() !== "" && !isValidSheba(sheba);
  const cardBad = card.trim() !== "" && !isValidCardNumber(card);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || shebaBad || cardBad) return;
    setBusy(true);
    setError(null);
    try {
      const common = {
        name: name.trim(),
        bankName: bankName.trim(),
        branch: branch.trim(),
        accountNumber: normalizeDigits(accountNumber).trim(),
        sheba: normalizeSheba(sheba),
        cardNumber: normalizeCard(card),
      };
      if (bank) await updateBank(bank.id, common);
      else {
        const amount = Number(digits(opening) || 0) * (openingNeg ? -1 : 1);
        await createBank({ ...common, openingBalance: amount, openingDate: amount ? openingDate : undefined, linkedAccountId: linked || undefined });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={bank ? "ویرایش حساب بانکی" : "حساب بانکی جدید"} onClose={onClose} width="max-w-[560px]">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <label className={fieldLabel}>عنوان حساب</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً ملی - جاری شرکت" className={fieldInput} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>نام بانک</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>شعبه</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} className={fieldInput} />
          </div>
        </div>
        <div>
          <label className={fieldLabel}>شماره حساب</label>
          <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} dir="ltr" inputMode="numeric" className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>شماره شبا</label>
          <input value={sheba} onChange={(e) => setSheba(e.target.value)} dir="ltr" placeholder="IR000000000000000000000000" className={fieldInput} aria-invalid={shebaBad} />
          {shebaBad ? <p className="text-[11.5px] text-danger mt-1">شماره شبا معتبر نیست (IR و ۲۴ رقم، با کنترل صحت)</p> : null}
        </div>
        <div>
          <label className={fieldLabel}>شماره کارت</label>
          <input value={card} onChange={(e) => setCard(e.target.value)} dir="ltr" inputMode="numeric" placeholder="0000 0000 0000 0000" className={fieldInput} aria-invalid={cardBad} />
          {cardBad ? <p className="text-[11.5px] text-danger mt-1">شماره کارت معتبر نیست (۱۶ رقم، با کنترل صحت)</p> : null}
        </div>
        {!bank ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>مانده‌ی افتتاحیه (تومان)</label>
                <input value={opening} onChange={(e) => setOpening(digits(e.target.value))} dir="ltr" inputMode="numeric" className={fieldInput} />
                <label className="flex items-center gap-2 text-[12px] text-ink-soft mt-2 cursor-pointer min-h-[32px]">
                  <input type="checkbox" checked={openingNeg} onChange={(e) => setOpeningNeg(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary)]" />
                  مانده بدهکاری (اضافه‌برداشت)
                </label>
              </div>
              <div>
                <label className={fieldLabel}>تاریخ افتتاحیه</label>
                <JalaliDateInput value={openingDate} onChange={setOpeningDate} />
              </div>
            </div>
            <div>
              <label className={fieldLabel}>حساب دفتر کل</label>
              <select value={linked} onChange={(e) => setLinked(e.target.value)} className={fieldInput}>
                <option value="">ایجاد خودکار (زیرحساب بانک ۱۰۲۰)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted mt-1">مانده‌ی بانک همیشه از روی همین حساب دفتر کل محاسبه می‌شود.</p>
            </div>
          </>
        ) : (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer min-h-[40px]">
            <input type="checkbox" defaultChecked={bank.isActive} onChange={(e) => void updateBank(bank.id, { isActive: e.target.checked }).then(onSaved).catch((er) => setError(errMsg(er)))} className="w-4 h-4 accent-[var(--color-primary)]" />
            حساب فعال است (غیرفعال: تراکنش و دسته‌چک جدید ثبت نمی‌شود)
          </label>
        )}
        {error ? <div className="text-[12px] text-danger" role="alert">{error}</div> : null}
        <button type="submit" disabled={busy || !name.trim() || shebaBad || cardBad} className={submitCls}>
          {busy ? "در حال ذخیره..." : bank ? "ذخیره تغییرات" : "افزودن حساب بانکی"}
        </button>
      </form>
    </Modal>
  );
}

// ── صندوق ──────────────────────────────────────────────────────────────────

export function CashBoxFormModal({ box, linkedIds, onClose, onSaved }: { box?: CashBoxRow; linkedIds: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(box?.name ?? "");
  const [custodian, setCustodian] = useState(box?.custodianUserId ?? "");
  const [opening, setOpening] = useState("");
  const [openingDate, setOpeningDate] = useState(today());
  const [linked, setLinked] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = useCashAccounts(linkedIds);
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (box) await updateCashBox(box.id, { name: name.trim(), custodianUserId: custodian || undefined });
      else {
        const amount = Number(digits(opening) || 0);
        await createCashBox({ name: name.trim(), custodianUserId: custodian || undefined, openingBalance: amount, openingDate: amount ? openingDate : undefined, linkedAccountId: linked || undefined });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={box ? "ویرایش صندوق" : "صندوق جدید"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <label className={fieldLabel}>نام صندوق</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً صندوق اصلی" className={fieldInput} />
        </div>
        <div>
          <label className={fieldLabel}>مسئول صندوق</label>
          <select value={custodian} onChange={(e) => setCustodian(e.target.value)} className={fieldInput}>
            <option value="">بدون مسئول</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        {!box ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>موجودی افتتاحیه (تومان)</label>
                <input value={opening} onChange={(e) => setOpening(digits(e.target.value))} dir="ltr" inputMode="numeric" className={fieldInput} />
              </div>
              <div>
                <label className={fieldLabel}>تاریخ افتتاحیه</label>
                <JalaliDateInput value={openingDate} onChange={setOpeningDate} />
              </div>
            </div>
            <div>
              <label className={fieldLabel}>حساب دفتر کل</label>
              <select value={linked} onChange={(e) => setLinked(e.target.value)} className={fieldInput}>
                <option value="">ایجاد خودکار (زیرحساب صندوق ۱۰۱۰)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft cursor-pointer min-h-[40px]">
            <input type="checkbox" defaultChecked={box.isActive} onChange={(e) => void updateCashBox(box.id, { isActive: e.target.checked }).then(onSaved).catch((er) => setError(errMsg(er)))} className="w-4 h-4 accent-[var(--color-primary)]" />
            صندوق فعال است
          </label>
        )}
        {error ? <div className="text-[12px] text-danger" role="alert">{error}</div> : null}
        <button type="submit" disabled={busy || !name.trim()} className={submitCls}>
          {busy ? "در حال ذخیره..." : box ? "ذخیره تغییرات" : "افزودن صندوق"}
        </button>
      </form>
    </Modal>
  );
}

// ── دسته‌چک ────────────────────────────────────────────────────────────────

export function ChequeBookFormModal({ banks, onClose, onSaved }: { banks: BankAccountRow[]; onClose: () => void; onSaved: () => void }) {
  const active = banks.filter((b) => b.isActive);
  const [bankId, setBankId] = useState(active[0]?.id ?? "");
  const [name, setName] = useState("");
  const [series, setSeries] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = Number(start) && Number(end) ? Number(end) - Number(start) + 1 : 0;
  const bad = count < 1 || count > 500;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankId || !name.trim() || bad) return;
    setBusy(true);
    setError(null);
    try {
      await createChequeBook({ bankAccountId: bankId, name: name.trim(), series: series.trim() || undefined, startSerial: Number(start), endSerial: Number(end), note: note.trim() || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="دسته‌چک جدید" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <label className={fieldLabel}>حساب بانکی</label>
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={fieldInput}>
            {active.length === 0 ? <option value="">ابتدا یک حساب بانکی تعریف کنید</option> : null}
            {active.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>نام دسته‌چک</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً دسته‌چک ۱۴۰۵-۱" className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>سری (اختیاری)</label>
            <input value={series} onChange={(e) => setSeries(e.target.value)} dir="ltr" className={fieldInput} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>سریال شروع</label>
            <input value={start} onChange={(e) => setStart(digits(e.target.value))} dir="ltr" inputMode="numeric" className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>سریال پایان</label>
            <input value={end} onChange={(e) => setEnd(digits(e.target.value))} dir="ltr" inputMode="numeric" className={fieldInput} />
          </div>
        </div>
        {count !== 0 ? <p className={`text-[12px] ${bad ? "text-danger" : "text-muted"}`}>{bad ? "تعداد برگ‌ها باید بین ۱ تا ۵۰۰ باشد" : `${count.toLocaleString("fa-IR")} برگ ساخته می‌شود`}</p> : null}
        <div>
          <label className={fieldLabel}>یادداشت</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldInput} />
        </div>
        {error ? <div className="text-[12px] text-danger" role="alert">{error}</div> : null}
        <button type="submit" disabled={busy || !bankId || !name.trim() || bad} className={submitCls}>
          {busy ? "در حال ثبت..." : "ثبت دسته‌چک"}
        </button>
      </form>
    </Modal>
  );
}

// ── تراکنش بانک/صندوق ──────────────────────────────────────────────────────

export function TransactionFormModal({
  banks,
  boxes,
  presetHolder,
  onClose,
  onSaved,
}: {
  banks: BankAccountRow[];
  boxes: CashBoxRow[];
  presetHolder?: { kind: "BANK" | "CASH"; id: string };
  onClose: () => void;
  onSaved: (tx: BankTx) => void;
}) {
  const [type, setType] = useState<BankTxInput["type"]>("RECEIPT");
  const [holder, setHolder] = useState(presetHolder ? `${presetHolder.kind}:${presetHolder.id}` : "");
  const [dest, setDest] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [counterMode, setCounterMode] = useState<"contact" | "account">("contact");
  const [contactId, setContactId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(BankTx & { journalNumber: number }) | null>(null);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const holders = [
    ...banks.filter((b) => b.isActive).map((b) => ({ v: `BANK:${b.id}`, label: `بانک — ${b.name}` })),
    ...boxes.filter((b) => b.isActive).map((b) => ({ v: `CASH:${b.id}`, label: `صندوق — ${b.name}` })),
  ];
  const split = (v: string) => {
    const [kind, id] = v.split(":");
    return kind === "BANK" ? { bankAccountId: id } : kind === "CASH" ? { cashBoxId: id } : {};
  };
  const splitDest = (v: string) => {
    const [kind, id] = v.split(":");
    return kind === "BANK" ? { toBankAccountId: id } : kind === "CASH" ? { toCashBoxId: id } : {};
  };
  const n = Number(amount);
  const valid = holder && n > 0 && date && (type === "TRANSFER" ? !!dest && dest !== holder : counterMode === "contact" ? !!contactId : !!counterAccountId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const body: BankTxInput = {
        type,
        date,
        amount: n,
        description: description.trim() || undefined,
        referenceNo: referenceNo.trim() || undefined,
        ...split(holder),
        ...(type === "TRANSFER" ? splitDest(dest) : counterMode === "contact" ? { contactId } : { counterAccountId }),
      };
      const tx = await createBankTransaction(body);
      setCreated(tx);
      onSaved(tx);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal title={`تراکنش شماره ${created.number.toLocaleString("fa-IR")} ثبت شد`} onClose={onClose} width="max-w-[520px]">
        <p className="text-[12.5px] text-ink-soft mb-3">سند حسابداری شماره {created.journalNumber.toLocaleString("fa-IR")} به‌طور خودکار ثبت شد. در صورت نیاز رسید یا تصویر فیش را پیوست کنید.</p>
        <AttachmentsSection entityType="bank_transaction" entityId={created.id} />
        <button onClick={onClose} className={submitCls}>تمام</button>
      </Modal>
    );
  }

  const TYPES: Array<[BankTxInput["type"], string]> = [
    ["RECEIPT", "دریافت"],
    ["PAYMENT", "پرداخت"],
    ["TRANSFER", "انتقال"],
  ];

  return (
    <Modal title="تراکنش جدید بانک/صندوق" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex gap-2" role="tablist">
          {TYPES.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)} className={`flex-1 min-h-[44px] rounded-xl text-[13px] font-bold cursor-pointer ${type === t ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}>
              {label}
            </button>
          ))}
        </div>
        <div>
          <label className={fieldLabel}>{type === "TRANSFER" ? "از (مبدأ)" : "بانک یا صندوق"}</label>
          <select value={holder} onChange={(e) => setHolder(e.target.value)} className={fieldInput}>
            <option value="">انتخاب کنید</option>
            {holders.map((h) => (
              <option key={h.v} value={h.v}>{h.label}</option>
            ))}
          </select>
        </div>
        {type === "TRANSFER" ? (
          <div>
            <label className={fieldLabel}>به (مقصد)</label>
            <select value={dest} onChange={(e) => setDest(e.target.value)} className={fieldInput}>
              <option value="">انتخاب کنید</option>
              {holders.filter((h) => h.v !== holder).map((h) => (
                <option key={h.v} value={h.v}>{h.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <div className="flex gap-2 mb-2">
              {([
                ["contact", type === "RECEIPT" ? "از مشتری" : "به تأمین‌کننده"],
                ["account", "حساب دفتر کل"],
              ] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setCounterMode(m)} className={`flex-1 min-h-[40px] rounded-lg text-[12.5px] font-bold cursor-pointer ${counterMode === m ? "bg-primary-soft text-primary" : "bg-slate-100 text-ink-soft"}`}>
                  {label}
                </button>
              ))}
            </div>
            {counterMode === "contact" ? (
              <ContactCombobox key={type} value={contactId} onChange={setContactId} source={type === "RECEIPT" ? "customer" : "supplier"} allowCreate={false} placeholder="جستجوی طرف‌حساب..." />
            ) : (
              <select value={counterAccountId} onChange={(e) => setCounterAccountId(e.target.value)} className={fieldInput}>
                <option value="">انتخاب حساب مقابل</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="text-[11.5px] text-muted mt-1">
              {counterMode === "contact" ? (type === "RECEIPT" ? "از حساب‌های دریافتنی (۱۰۳۰) کم می‌شود." : "از حساب‌های پرداختنی (۲۰۱۰) کم می‌شود.") : "سند بین حساب بانک/صندوق و حساب انتخابی ثبت می‌شود (مثلاً هزینه‌ی کارمزد)."}
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>مبلغ (تومان)</label>
            <input value={amount} onChange={(e) => setAmount(digits(e.target.value))} dir="ltr" inputMode="numeric" className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>تاریخ</label>
            <JalaliDateInput value={date} onChange={setDate} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>شرح</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldInput} />
          </div>
          <div>
            <label className={fieldLabel}>شماره مرجع / پیگیری</label>
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} dir="ltr" className={fieldInput} />
          </div>
        </div>
        {error ? <div className="text-[12px] text-danger" role="alert">{error}</div> : null}
        <button type="submit" disabled={busy || !valid} className={submitCls}>
          {busy ? "در حال ثبت..." : "ثبت تراکنش و سند حسابداری"}
        </button>
      </form>
    </Modal>
  );
}
