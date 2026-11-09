"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { agentsApproveShebaChange, agentsRejectShebaChange, agentsShebaChanges, type AgentShebaChange, type AgentShebaChangeStatus } from "@/lib/api";
import { btnDanger, btnGhost, btnPrimary, CopyButton, errMsg, Field, fa, fmtDate, inputClass, Loading } from "./agent-ui";

const STATUS_LABELS: Record<AgentShebaChangeStatus, string> = { PENDING: "در انتظار تأیید", APPROVED: "تأییدشده", REJECTED: "ردشده", SUPERSEDED: "جایگزین‌شده" };

/**
 * صف تأیید تغییر شبا: نماینده شبای جدید را از پنلش با کد پیامکی تأیید می‌کند، اما تا تأیید مدیر (مالک/مدیر + 2FA)
 * واریزها به شبای قبلی است. شبای کامل قدیم و جدید برای مقایسه (و تماس تلفنی در صورت شک) نمایش داده می‌شود.
 */
export function ShebaApprovals({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const [status, setStatus] = useState<AgentShebaChangeStatus>("PENDING");
  const [rows, setRows] = useState<AgentShebaChange[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AgentShebaChange | null>(null);

  const load = useCallback(() => {
    agentsShebaChanges(status)
      .then((r) => { setErr(null); setRows(r); onChanged?.(); })
      .catch((e) => setErr(errMsg(e)));
  }, [status, onChanged]);
  useEffect(load, [load]);

  async function approve(c: AgentShebaChange) {
    if (!window.confirm(`شبای ${c.agentName} به ${c.newSheba} تغییر کند؟ از این پس واریز تسویه‌ها به این شبا انجام می‌شود.`)) return;
    setBusy(c.id);
    try { await agentsApproveShebaChange(c.id); load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-ink-soft">
        نماینده شبای جدید را با کد پیامکی تأیید کرده است. تا تأیید شما، شبای قبلی معتبر می‌ماند. پیشنهاد: پیش از تأیید با شماره‌ی نماینده تماس بگیرید و مالکیت حساب را بررسی کنید.
      </div>
      <select className={`${inputClass} sm:max-w-[200px]`} value={status} onChange={(e) => setStatus(e.target.value as AgentShebaChangeStatus)}>
        {(Object.keys(STATUS_LABELS) as AgentShebaChangeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
      {err ? <div className="text-[12px] text-danger">{err}</div> : null}
      {!rows ? <Loading rows={null} /> : !rows.length ? <div className="text-[12.5px] text-muted py-6 text-center">درخواستی در این وضعیت نیست.</div> : rows.map((c) => (
        <Card key={c.id} className="p-3.5 flex flex-col gap-2 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px]">{c.agentName}</b>
            {c.agentPhone ? <span className="text-muted" dir="ltr">{c.agentPhone}</span> : null}
            <Badge tone={c.status === "PENDING" ? "warning" : c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "danger" : "neutral"}>{STATUS_LABELS[c.status]}</Badge>
            <span className="ms-auto text-muted">{fmtDate(c.requestedAt)}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-1">
            <div>شبای فعلی: <b dir="ltr" className="font-mono">{c.currentSheba ?? "—"}</b></div>
            <div>شبای جدید: <b dir="ltr" className="font-mono text-primary">{c.newSheba}</b> <CopyButton text={c.newSheba} /></div>
          </div>
          {c.rejectReason ? <div className="text-danger">دلیل رد: {c.rejectReason}</div> : null}
          {canEdit && c.status === "PENDING" ? (
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy === c.id} onClick={() => approve(c)}>تأیید شبای جدید</button>
              <button className={btnDanger} onClick={() => setRejecting(c)}>رد</button>
            </div>
          ) : null}
        </Card>
      ))}
      {rejecting ? <RejectShebaModal c={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} /> : null}
    </div>
  );
}

function RejectShebaModal({ c, onClose, onDone }: { c: AgentShebaChange; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await agentsRejectShebaChange(c.id, reason.trim()); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`رد تغییر شبای ${c.agentName}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="text-[12.5px] text-ink-soft">شبای فعلی بدون تغییر می‌ماند و دلیل با پیامک به نماینده ({fa(c.agentPhone ?? "")}) ارسال می‌شود.</div>
        <Field label="دلیل رد"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>انصراف</button><button className={btnDanger} disabled={busy || reason.trim().length < 2}>{busy ? "..." : "رد درخواست"}</button></div>
      </form>
    </Modal>
  );
}
