"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { ApiError, cancelInvoiceSignRequest, fetchInvoiceSigningState, requestInvoiceSignature, type InvoiceSigningState } from "@/lib/api";

/**
 * امضای داخلی فاکتور از کارتابل مدیر: دکمه‌ی «درخواست امضا» → امضاکننده (پیش‌فرض مالک) → فقط تأیید با امضا / مهر و امضا یا رد با دلیل.
 * در حالت «الزامی» فاکتور بدون امضا صادر نمی‌شود. وضعیت کهنه‌شدن امضا (تغییر محتوا پس از امضا) هم اینجا هشدار داده می‌شود.
 */
export function InvoiceSigningPanel({ invoiceId, status, refreshKey, onChanged }: { invoiceId: string; status: string; refreshKey?: number; onChanged: () => void }) {
  const [state, setState] = useState<InvoiceSigningState | null>(null);
  const [signerId, setSignerId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchInvoiceSigningState(invoiceId)
      .then((s) => {
        setState(s);
        setSignerId((cur) => cur || s.signers.find((x) => x.isDefault)?.userId || s.signers[0]?.userId || "");
      })
      .catch(() => setState(null));
  }, [invoiceId]);
  useEffect(load, [load, refreshKey]);

  if (!state || state.policy === "off" || status === "CANCELLED") return null;

  async function request() {
    setBusy(true);
    setError(null);
    try {
      await requestInvoiceSignature(invoiceId, { signerUserId: signerId || undefined, note: note.trim() || undefined });
      setNote("");
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ثبت درخواست ناموفق بود");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await cancelInvoiceSignRequest(invoiceId);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "لغو ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border rounded-xl p-3.5 bg-surface">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[12.5px] font-bold">امضای داخلی فاکتور</div>
        <Badge tone={state.policy === "required" ? "warning" : "neutral"}>{state.policy === "required" ? "الزامی پیش از صدور" : "اختیاری"}</Badge>
        {state.signed ? <Badge tone="success">{state.signatureKind === "STAMP_AND_SIGNATURE" ? "با مهر و امضای شرکت" : "امضا شد"}</Badge> : null}
      </div>

      {state.stale ? (
        <div className="text-[12px] text-danger bg-danger-soft rounded-lg px-3 py-2">محتوای فاکتور پس از امضا تغییر کرده و امضا معتبر نیست؛ دوباره درخواست امضا بدهید.</div>
      ) : null}
      {state.signatureInvalidatedAt && !state.signed ? (
        <div className="text-[12px] text-warning bg-warning-soft rounded-lg px-3 py-2">
          امضای قبلی بی‌اعتبار شد ({formatJalaliDateTime(state.signatureInvalidatedAt)}){state.signatureInvalidReason ? ` — ${state.signatureInvalidReason}` : ""}
        </div>
      ) : null}
      {state.lastRejection && !state.pending ? (
        <div className="text-[12px] text-danger bg-danger-soft rounded-lg px-3 py-2">درخواست قبلی رد شد{state.lastRejection.note ? ` — ${state.lastRejection.note}` : ""}</div>
      ) : null}

      {state.pending ? (
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
          <span>در کارتابل {state.pending.assigneeName ?? "مدیر"} در انتظار امضاست — {formatJalaliDateTime(state.pending.createdAt)}</span>
          <button onClick={cancel} disabled={busy} className="text-[12px] font-bold text-danger cursor-pointer disabled:opacity-50">
            لغو درخواست
          </button>
          {state.canDecide ? <a href={`/approvals?open=${state.pending.requestId}`} className="text-[12px] font-bold text-primary">تصمیم در کارتابل ←</a> : null}
        </div>
      ) : state.canRequest ? (
        !state.hasSignatureImage ? (
          <div className="text-[12px] text-muted">برای درخواست امضا، مالک باید امضای شرکت را در تنظیمات ← عمومی بارگذاری کند.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {state.signers.length > 1 ? (
              <select value={signerId} onChange={(e) => setSignerId(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-[13px] bg-white">
                {state.signers.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name} {s.role === "OWNER" ? "(مالک)" : "(دارنده‌ی مهر و امضا)"}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-[12px] text-muted">امضاکننده: {state.signers[0]?.name ?? "—"}</div>
            )}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="توضیح برای امضاکننده (اختیاری)" className="border border-border rounded-lg px-3 py-2 text-[13px] bg-white" />
            <button onClick={request} disabled={busy || !signerId} className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
              {busy ? "در حال ثبت..." : "درخواست امضا"}
            </button>
          </div>
        )
      ) : state.blockedReason && !state.signed ? (
        <div className="text-[12px] text-muted">{state.blockedReason}</div>
      ) : null}
      {error ? <div className="text-[12px] text-danger">{error}</div> : null}
    </div>
  );
}
