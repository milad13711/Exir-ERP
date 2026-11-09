"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import {
  AGENT_LEVEL_LABELS, AGENT_PAYOUT_STATUS_LABELS, AGENT_STATUS_LABELS,
  agentsApprovePayout, agentsCreatePayout, agentsMarkPayoutPaid, agentsMeCancelPayout, agentsMePayouts, agentsMeRequestPayout, agentsMeWallet, agentsPayouts,
  agentsPerformanceReport, agentsRejectPayout,
  type AgentBusinessCard, type AgentMembershipStatus, type AgentPayout, type AgentPayoutList, type AgentPayoutStatus, type AgentPerformanceReport, type AgentProduct, type AgentWalletBalances,
} from "@/lib/api";
import { btnDanger, btnGhost, btnPrimary, CopyButton, errMsg, Field, fa, fmtDate, fmtMoney, inputClass, Loading } from "./agent-ui";

const payoutTone: Record<AgentPayoutStatus, Tone> = { REQUESTED: "warning", APPROVED: "accent", PAID: "success", REJECTED: "danger", CANCELLED: "neutral" };
export const PayoutBadge = ({ s }: { s: AgentPayoutStatus }) => <Badge tone={payoutTone[s]}>{AGENT_PAYOUT_STATUS_LABELS[s]}</Badge>;

/** ورودی مبلغ: ارقام فارسی/عربی را می‌پذیرد، فقط عدد نگه می‌دارد. */
function latinDigits(v: string) {
  return v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function digits(v: string) {
  return latinDigits(v).replace(/\D/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// ادمین / مالی: صف تسویه‌ها — تأیید، رد، ثبت واریز دستی با شماره‌ی پیگیری
// ─────────────────────────────────────────────────────────────────────────────

export function AdminPayoutsPanel({ products, canEdit, onChanged }: { products: AgentProduct[]; canEdit: boolean; onChanged?: () => void }) {
  const [status, setStatus] = useState<string>("REQUESTED");
  const [productId, setProductId] = useState("");
  const [data, setData] = useState<AgentPayoutList | null>(null);
  const [items, setItems] = useState<AgentPayout[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState<AgentPayout | null>(null);
  const [rejecting, setRejecting] = useState<AgentPayout | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback((cursor?: string) => {
    agentsPayouts({ status: status || undefined, productId: productId || undefined, cursor })
      .then((r) => { setErr(null); setData(r); setItems((prev) => (cursor ? [...prev, ...r.items] : r.items)); if (!cursor) onChanged?.(); })
      .catch((e) => setErr(errMsg(e)));
  }, [status, productId, onChanged]);
  useEffect(() => { load(); }, [load]);

  async function approve(p: AgentPayout) {
    if (!window.confirm(`درخواست تسویه‌ی شماره ${fa(p.number)} به مبلغ ${fmtMoney(p.amount)} تأیید شود؟`)) return;
    setBusyId(p.id);
    try { await agentsApprovePayout(p.id); load(); } catch (e) { setErr(errMsg(e)); } finally { setBusyId(null); }
  }

  const totals = useMemo(() => new Map((data?.totals ?? []).map((t) => [t.status, t])), [data]);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-ink-soft">
        روند: نماینده درخواست می‌دهد ← مالی تأیید می‌کند ← واریز بانکی به شبای ثبت‌شده انجام و <b>شماره‌ی پیگیری</b> ثبت می‌شود. مبلغ از لحظه‌ی درخواست از موجودی قابل تسویه رزرو می‌شود و با رد/لغو آزاد می‌شود. نتیجه با پیامک به نماینده اطلاع داده می‌شود.
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="وضعیت">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">همه</option>
            {(Object.keys(AGENT_PAYOUT_STATUS_LABELS) as AgentPayoutStatus[]).map((s) => <option key={s} value={s}>{AGENT_PAYOUT_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="محصول">
          <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">همه‌ی محصولات</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {status ? (
          <div className="text-[12.5px] text-ink-soft pb-2.5">
            {fa(totals.get(status as AgentPayoutStatus)?.count ?? 0)} درخواست · جمع {fmtMoney(totals.get(status as AgentPayoutStatus)?.amount ?? 0)}
          </div>
        ) : null}
      </div>
      {err ? <div className="text-[12px] text-danger">{err}</div> : null}
      {!data ? <Loading rows={null} /> : !items.length ? <div className="text-[12.5px] text-muted py-6 text-center">درخواستی در این وضعیت نیست.</div> : (
        <div className="flex flex-col gap-2">
          {items.map((p) => (
            <Card key={p.id} className="p-3 flex flex-col gap-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-muted">#{fa(p.number)}</span>
                <b>{p.agentName ?? "—"}</b>
                <span className="text-ink-soft">{p.productName}</span>
                <PayoutBadge s={p.status} />
                {p.requestedByType === "ADMIN" ? <Badge>ثبت توسط ادمین</Badge> : null}
                <span className="ms-auto text-[15px] font-extrabold">{fmtMoney(p.amount)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-soft">
                <span>شبا: <b dir="ltr" className="font-mono">{p.shebaNumber}</b> {p.shebaNumber ? <CopyButton text={p.shebaNumber} /> : null}</span>
                {p.agentPhone ? <span dir="ltr">{p.agentPhone}</span> : null}
                <span>درخواست: {fmtDate(p.createdAt)}</span>
                {p.paidAt ? <span>واریز: {fmtDate(p.paidAt)} · پیگیری <b dir="ltr" className="font-mono">{p.trackingNumber}</b></span> : null}
              </div>
              {p.agentNote ? <div className="text-muted">یادداشت نماینده: {p.agentNote}</div> : null}
              {p.rejectReason ? <div className="text-danger">دلیل رد: {p.rejectReason}</div> : null}
              {p.paymentNote ? <div className="text-muted">یادداشت پرداخت: {p.paymentNote}</div> : null}
              {canEdit && (p.status === "REQUESTED" || p.status === "APPROVED") ? (
                <div className="flex flex-wrap gap-2">
                  {p.status === "REQUESTED" ? <button className={btnPrimary} disabled={busyId === p.id} onClick={() => approve(p)}>تأیید</button> : null}
                  {p.status === "APPROVED" ? <button className={btnPrimary} onClick={() => setPaying(p)}>ثبت واریز و شماره‌ی پیگیری</button> : null}
                  <button className={btnDanger} onClick={() => setRejecting(p)}>رد</button>
                </div>
              ) : null}
            </Card>
          ))}
          {data.nextCursor ? <button className={clsx(btnGhost, "self-center")} onClick={() => load(data.nextCursor!)}>بیشتر</button> : null}
        </div>
      )}
      {paying ? <MarkPaidModal p={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load(); }} /> : null}
      {rejecting ? <RejectModal p={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} /> : null}
    </div>
  );
}

function MarkPaidModal({ p, onClose, onDone }: { p: AgentPayout; onClose: () => void; onDone: () => void }) {
  const [tracking, setTracking] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[A-Za-z0-9\-_/.]{4,64}$/.test(tracking.trim());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`واریز ${fmtMoney(p.amount)} به ${p.agentName ?? "نماینده"} با شماره‌ی پیگیری ${tracking.trim()} ثبت شود؟ این کار برگشت‌پذیر نیست.`)) return;
    setBusy(true); setErr(null);
    try {
      // تاریخ انتخابی به ظهر همان روز تهران نگاشت می‌شود تا با تغییر منطقه‌ی زمانی روز عوض نشود
      await agentsMarkPayoutPaid(p.id, { trackingNumber: tracking.trim(), paidAt: date ? `${date}T08:30:00.000Z` : undefined, note: note.trim() || undefined });
      onDone();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`ثبت واریز — تسویه‌ی #${fa(p.number)}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="text-[12.5px] text-ink-soft flex flex-col gap-1">
          <div>نماینده: <b>{p.agentName}</b> · {p.productName}</div>
          <div>مبلغ: <b className="text-[14px]">{fmtMoney(p.amount)}</b></div>
          <div>شبای مقصد: <b dir="ltr" className="font-mono">{p.shebaNumber}</b> {p.shebaNumber ? <CopyButton text={p.shebaNumber} /> : null}</div>
        </div>
        <Field label="شماره‌ی پیگیری بانکی" hint="۴ تا ۶۴ نویسه، حروف لاتین و عدد"><input className={`${inputClass} font-mono`} dir="ltr" value={tracking} onChange={(e) => setTracking(latinDigits(e.target.value))} autoFocus /></Field>
        <Field label="تاریخ واریز"><JalaliDateInput value={date} onChange={setDate} /></Field>
        <Field label="یادداشت (اختیاری)"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>انصراف</button><button className={btnPrimary} disabled={busy || !valid}>{busy ? "..." : "ثبت واریز"}</button></div>
      </form>
    </Modal>
  );
}

function RejectModal({ p, onClose, onDone }: { p: AgentPayout; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await agentsRejectPayout(p.id, reason.trim()); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`رد تسویه‌ی #${fa(p.number)}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="text-[12.5px] text-ink-soft">مبلغ {fmtMoney(p.amount)} به موجودی قابل تسویه‌ی نماینده برمی‌گردد و دلیل با پیامک برایش ارسال می‌شود.</div>
        <Field label="دلیل رد"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>انصراف</button><button className={btnDanger} disabled={busy || reason.trim().length < 2}>{busy ? "..." : "رد درخواست"}</button></div>
      </form>
    </Modal>
  );
}

/** ادمین: ثبت درخواست تسویه از طرف نماینده (مثلاً درخواست تلفنی) — همان قواعد موجودی/حداقل/شبا. */
export function AdminRequestPayoutButton({ membershipId, onDone }: { membershipId: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await agentsCreatePayout({ membershipId, amount: Number(amount), note: note.trim() || undefined }); setOpen(false); setAmount(""); setNote(""); onDone?.(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <>
      <button className={btnGhost} onClick={() => setOpen(true)}>ثبت درخواست تسویه</button>
      {open ? (
        <Modal title="ثبت درخواست تسویه از طرف نماینده" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Field label="مبلغ"><input className={inputClass} dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} /></Field>
            <Field label="یادداشت"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {err ? <div className="text-[12px] text-danger">{err}</div> : null}
            <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={() => setOpen(false)}>انصراف</button><button className={btnPrimary} disabled={busy || !amount}>{busy ? "..." : "ثبت"}</button></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// نماینده: درخواست تسویه + سابقه
// ─────────────────────────────────────────────────────────────────────────────

export function AgentPayoutsBox({ membershipId, minSettlement, onChanged }: { membershipId: string; minSettlement: number; onChanged?: () => void }) {
  const [bal, setBal] = useState<AgentWalletBalances | null>(null);
  const [list, setList] = useState<AgentPayout[] | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    agentsMeWallet(membershipId).then((w) => setBal(w.balances)).catch(() => setBal(null));
    agentsMePayouts(membershipId).then((r) => setList(r.items)).catch(() => setList([]));
  }, [membershipId]);
  useEffect(load, [load]);

  const open = list?.find((p) => p.status === "REQUESTED" || p.status === "APPROVED");
  const can = !!bal && bal.withdrawable >= minSettlement && !open;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await agentsMeRequestPayout(membershipId, { amount: Number(amount), note: note.trim() || undefined });
      setAmount(""); setNote(""); setMsg({ ok: true, text: "درخواست ثبت شد؛ پس از واریز، شماره‌ی پیگیری پیامک می‌شود." });
      load(); onChanged?.();
    } catch (x) { setMsg({ ok: false, text: errMsg(x) }); } finally { setBusy(false); }
  }
  async function cancel(p: AgentPayout) {
    if (!window.confirm("درخواست تسویه لغو شود؟")) return;
    try { await agentsMeCancelPayout(p.id); load(); onChanged?.(); } catch (x) { setMsg({ ok: false, text: errMsg(x) }); }
  }
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="text-[13.5px] font-extrabold">درخواست تسویه</div>
      {!bal ? <Loading rows={null} /> : (
        <>
          <div className="text-[12.5px] text-ink-soft">
            قابل درخواست: <b className={bal.withdrawable < 0 ? "text-danger" : "text-success"}>{fmtMoney(Math.max(bal.withdrawable, 0))}</b> · حداقل: {fmtMoney(minSettlement)}
            {bal.withdrawable < 0 ? <span className="text-danger"> (بدهی {fmtMoney(-bal.withdrawable)} بابت بازپرداخت پس از تسویه — از پورسانت‌های بعدی کم می‌شود)</span> : null}
          </div>
          {open ? (
            <div className="text-[12.5px] text-ink-soft">یک درخواست در جریان دارید (#{fa(open.number)} — {AGENT_PAYOUT_STATUS_LABELS[open.status]}).</div>
          ) : (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
              <Field label="مبلغ">
                <div className="flex gap-1.5">
                  <input className={`${inputClass} w-44`} dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} disabled={!can} />
                  <button type="button" className={btnGhost} disabled={!can} onClick={() => setAmount(String(bal.withdrawable))}>همه</button>
                </div>
              </Field>
              <Field label="یادداشت (اختیاری)"><input className={`${inputClass} w-56`} value={note} onChange={(e) => setNote(e.target.value)} disabled={!can} /></Field>
              <button className={btnPrimary} disabled={!can || busy || !amount || Number(amount) < minSettlement || Number(amount) > bal.withdrawable}>{busy ? "..." : "ثبت درخواست"}</button>
            </form>
          )}
          {!can && !open && bal.withdrawable < minSettlement ? <div className="text-[11.5px] text-muted">موجودی قابل تسویه هنوز به حداقل نرسیده است.</div> : null}
          <div className="text-[11.5px] text-muted">واریز فقط به شبای تأییدشده‌ی شما انجام می‌شود (تغییر شبا در «پروفایل من» با تأیید پیامکی).</div>
        </>
      )}
      {msg ? <div className={clsx("text-[12px]", msg.ok ? "text-success" : "text-danger")}>{msg.text}</div> : null}
      {list && list.length ? (
        <div className="flex flex-col gap-1.5">
          {list.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border rounded-xl px-3 py-2 text-[12.5px]">
              <span className="font-mono text-muted">#{fa(p.number)}</span>
              <b>{fmtMoney(p.amount)}</b>
              <PayoutBadge s={p.status} />
              <span className="text-muted">{fmtDate(p.createdAt)}</span>
              {p.trackingNumber ? <span>پیگیری: <b dir="ltr" className="font-mono">{p.trackingNumber}</b> · {fmtDate(p.paidAt)}</span> : null}
              {p.rejectReason ? <span className="text-danger">{p.rejectReason}</span> : null}
              {p.status === "REQUESTED" ? <button className="ms-auto text-[12px] text-danger font-bold cursor-pointer" onClick={() => cancel(p)}>لغو</button> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// کارت ویزیت نماینده (برای هر محصول): نمایش + دانلود PNG
// ─────────────────────────────────────────────────────────────────────────────

const CARD_W = 1050;
const CARD_H = 600;

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    // فقط data URI ها بوم را آلوده نمی‌کنند؛ لوگوی خارجی بدون CORS حذف می‌شود
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function renderCardPng(c: AgentBusinessCard): Promise<Blob | null> {
  await document.fonts?.ready;
  const cv = document.createElement("canvas");
  cv.width = CARD_W; cv.height = CARD_H;
  const g = cv.getContext("2d");
  if (!g) return null;
  const font = getComputedStyle(document.body).fontFamily || "Tahoma";
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, CARD_W, CARD_H);
  g.fillStyle = "#4338ca"; g.fillRect(0, 0, CARD_W, 14);
  g.fillStyle = "#eef2ff"; g.fillRect(0, CARD_H - 90, CARD_W, 90);
  const qr = c.qrSvg ? await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.qrSvg)}`) : null;
  if (qr) g.drawImage(qr, 60, 150, 280, 280);
  const logo = c.productLogoUrl ? await loadImg(c.productLogoUrl) : null;
  g.direction = "rtl"; g.textAlign = "right";
  const x = CARD_W - 60;
  if (logo) {
    const h = 70; const w = Math.min(220, (logo.width / logo.height) * h);
    g.drawImage(logo, x - w, 50, w, h);
  }
  g.fillStyle = "#64748b"; g.font = `600 26px ${font}`; g.fillText(`نماینده‌ی رسمی ${c.productName}`, x, logo ? 160 : 90);
  g.fillStyle = "#0f172a"; g.font = `800 52px ${font}`; g.fillText(c.agentName, x, logo ? 230 : 170);
  g.font = `500 28px ${font}`; g.fillStyle = "#334155";
  let y = logo ? 285 : 225;
  if (c.company) { g.fillText(c.company, x, y); y += 48; }
  g.fillText(`${c.levelLabel}${c.city ? ` · ${c.city}` : ""}`, x, y); y += 48;
  if (c.phone) { g.direction = "ltr"; g.textAlign = "right"; g.fillText(c.phone, x, y); g.direction = "rtl"; y += 48; }
  if (c.referralCode) {
    g.fillStyle = "#4338ca"; g.font = `700 30px ${font}`;
    g.fillText(`کد معرف: ${c.referralCode}`, x, CARD_H - 34);
  }
  if (c.referralUrl) { g.direction = "ltr"; g.textAlign = "left"; g.fillStyle = "#475569"; g.font = `500 20px ${font}`; g.fillText(c.referralUrl.replace(/^https?:\/\//, "").slice(0, 48), 60, CARD_H - 38); }
  try {
    return await new Promise<Blob | null>((res) => cv.toBlob((b) => res(b), "image/png"));
  } catch {
    return null;
  }
}

export function BusinessCardView({ fetchCard }: { fetchCard: () => Promise<AgentBusinessCard> }) {
  const [c, setC] = useState<AgentBusinessCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchCard().then(setC).catch((e) => setErr(errMsg(e))); }, [fetchCard]);
  if (err) return <div className="text-[12px] text-danger">{err}</div>;
  if (!c) return <Loading rows={null} />;
  async function download() {
    if (!c) return;
    setBusy(true);
    try {
      const b = await renderCardPng(c);
      if (!b) { setErr("ساخت تصویر ممکن نشد"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `card-${c.referralCode ?? "agent"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { setBusy(false); }
  }
  const qrSrc = c.qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.qrSvg)}` : null;
  return (
    <div className="flex flex-col gap-3">
      {!c.active ? <div className="text-[12.5px] text-warning">عضویت شما در این محصول فعال نیست؛ لینک معرفی غیرفعال است.</div> : !c.referralUrl ? <div className="text-[12.5px] text-warning">برای این محصول هنوز کد معرف یا لینک معرفی تعریف نشده است.</div> : null}
      <div className="w-full max-w-[560px] aspect-[1.75] rounded-2xl border border-border bg-white shadow-sm overflow-hidden relative flex flex-col">
        <div className="h-1.5 bg-primary" />
        <div className="flex-1 flex gap-4 p-5">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.productLogoUrl ? <img src={c.productLogoUrl} alt="" className="h-8 w-auto self-start object-contain mb-1" /> : null}
            <div className="text-[11.5px] text-muted">نماینده‌ی رسمی {c.productName}</div>
            <div className="text-[19px] font-extrabold truncate">{c.agentName}</div>
            {c.company ? <div className="text-[12.5px] text-ink-soft truncate">{c.company}</div> : null}
            <div className="text-[12.5px] text-ink-soft">{c.levelLabel}{c.city ? ` · ${c.city}` : ""}</div>
            {c.phone ? <div className="text-[12.5px] text-ink-soft" dir="ltr" style={{ textAlign: "right" }}>{c.phone}</div> : null}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qrSrc ? <img src={qrSrc} alt="QR لینک معرفی" className="w-[36%] aspect-square self-center" /> : null}
        </div>
        <div className="bg-primary-soft px-5 py-2 flex items-center justify-between gap-2 text-[12px]">
          <b className="text-primary">کد معرف: <span dir="ltr" className="font-mono">{c.referralCode ?? "—"}</span></b>
          {c.referralUrl ? <span className="text-ink-soft truncate" dir="ltr">{c.referralUrl.replace(/^https?:\/\//, "")}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className={btnPrimary} onClick={download} disabled={busy}>{busy ? "..." : "دانلود تصویر کارت"}</button>
        {c.referralUrl ? <CopyButton text={c.referralUrl} label="کپی لینک معرفی" /> : null}
        {c.referralCode ? <CopyButton text={c.referralCode} label="کپی کد معرف" /> : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// گزارش عملکرد نماینده‌ها
// ─────────────────────────────────────────────────────────────────────────────

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function PerformanceReportPanel({ products }: { products: AgentProduct[] }) {
  const [productId, setProductId] = useState("");
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [r, setR] = useState<AgentPerformanceReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    agentsPerformanceReport({ productId: productId || undefined, from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? `${to}T23:59:59.999Z` : undefined })
      .then((x) => { if (alive) { setR(x); setErr(null); } })
      .catch((e) => { if (alive) setErr(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productId, from, to]);

  function exportCsv() {
    if (!r) return;
    const head = ["نماینده", "محصول", "سطح", "وضعیت", "مشتری جدید", "تعداد تراکنش", "فروش اول", "فروش تمدید/موردی", "بازپرداخت", "فروش خالص", "پورسانت", "تسویه‌ی پرداخت‌شده در بازه", "قابل تسویه", "در انتظار مهلت", "در جریان تسویه"];
    const rows = r.rows.map((x) => [x.agentName, x.productName, AGENT_LEVEL_LABELS[x.level], AGENT_STATUS_LABELS[x.status as AgentMembershipStatus] ?? x.status, x.newCustomers, x.txCount, x.firstSales, x.renewalSales, x.refunds, x.netSales, x.commission, x.paidInPeriod, x.withdrawable, x.held, x.pending]);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      // جلوگیری از تزریق فرمول در اکسل
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+$/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = "﻿" + [head, ...rows].map((row) => row.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `agents-report-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="محصول">
          <select className={inputClass} value={productId} onChange={(e) => { setLoading(true); setProductId(e.target.value); }}>
            <option value="">همه‌ی محصولات</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="از"><JalaliDateInput value={from} onChange={(v) => { setLoading(true); setFrom(v); }} /></Field>
        <Field label="تا"><JalaliDateInput value={to} onChange={(v) => { setLoading(true); setTo(v); }} /></Field>
        <button className={btnGhost} onClick={exportCsv} disabled={!r?.rows.length}>خروجی CSV</button>
        {loading ? <span className="text-[12px] text-muted pb-2.5">…</span> : null}
      </div>
      {err ? <div className="text-[12px] text-danger">{err}</div> : null}
      {!r ? <Loading rows={null} /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="فروش خالص از طریق نماینده‌ها" value={fmtMoney(r.totals.netSales)} />
            <Tile label="فروش بدون نماینده" value={fmtMoney(r.totals.unattributedNetSales)} />
            <Tile label="پورسانت ایجادشده" value={fmtMoney(r.totals.commission)} />
            <Tile label="تسویه‌ی پرداخت‌شده" value={fmtMoney(r.totals.paidInPeriod)} />
            <Tile label="مشتری جدید" value={fa(r.totals.newCustomers)} />
            <Tile label="قابل تسویه (همین لحظه)" value={fmtMoney(r.totals.withdrawable)} />
            <Tile label="در جریان تسویه" value={fmtMoney(r.totals.pending)} />
            <Tile label="در مهلت نگهداری" value={fmtMoney(r.totals.held)} />
          </div>
          {!r.rows.length ? <div className="text-[12.5px] text-muted py-6 text-center">نماینده‌ای در این محصول نیست.</div> : (
            <div className="overflow-x-auto border border-border rounded-xl">
              <table className="w-full text-[12.5px] whitespace-nowrap">
                <thead className="bg-slate-50 text-ink-soft">
                  <tr>{["نماینده", "محصول", "سطح", "مشتری جدید", "تراکنش", "فروش اول", "تمدید/موردی", "بازپرداخت", "فروش خالص", "پورسانت", "پرداخت‌شده", "قابل تسویه"].map((h) => <th key={h} className="text-start font-semibold px-3 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.membershipId} className="border-t border-border">
                      <td className="px-3 py-2 font-bold">{x.agentName}{x.status !== "ACTIVE" ? <span className="text-muted font-normal"> ({AGENT_STATUS_LABELS[x.status as AgentMembershipStatus] ?? x.status})</span> : null}</td>
                      <td className="px-3 py-2">{x.productName}</td>
                      <td className="px-3 py-2">{AGENT_LEVEL_LABELS[x.level]}</td>
                      <td className="px-3 py-2">{fa(x.newCustomers)}</td>
                      <td className="px-3 py-2">{fa(x.txCount)}</td>
                      <td className="px-3 py-2">{fmtMoney(x.firstSales)}</td>
                      <td className="px-3 py-2">{fmtMoney(x.renewalSales)}</td>
                      <td className="px-3 py-2 text-danger">{x.refunds ? fmtMoney(x.refunds) : "—"}</td>
                      <td className="px-3 py-2 font-bold">{fmtMoney(x.netSales)}</td>
                      <td className="px-3 py-2 text-success">{fmtMoney(x.commission)}</td>
                      <td className="px-3 py-2">{fmtMoney(x.paidInPeriod)}</td>
                      <td className={clsx("px-3 py-2", x.withdrawable < 0 && "text-danger")}>{fmtMoney(x.withdrawable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[11.5px] text-muted">فروش و پورسانت بر اساس بازه‌ی انتخابی؛ «قابل تسویه»، «در جریان» و «در مهلت نگهداری» وضعیت همین لحظه‌اند.</div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-[15px] font-extrabold mt-1">{value}</div>
    </Card>
  );
}
