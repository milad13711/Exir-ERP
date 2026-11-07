"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Badge, type Tone } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  fetchEntityReferrals,
  fetchUsers,
  referDocument,
  respondReferral,
  type DocumentReferral,
  type EntityReferralInfo,
  type ReferralStatus,
  type TenantUser,
} from "@/lib/api";

export const REFERRAL_STATUS_TONE: Record<ReferralStatus, Tone> = {
  PENDING: "warning",
  ACCEPTED: "primary",
  DONE: "success",
  RETURNED: "danger",
  CANCELLED: "neutral",
  FORWARDED: "neutral",
  REVOKED: "neutral",
};

const FIELD = "w-full bg-white border border-border rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-primary";
const BTN = "text-[11.5px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50";

/**
 * پنل ارجاع سند — روی هر موجودیت قابل‌ارجاع: نشان «مسئول پیگیری»، دکمه‌ی «ارجاع»، تاریخچه، و
 * اقدام‌های پذیرش/برگشت/انجام برای گیرنده. entityType همان نام پیوست‌هاست (SalesInvoice، Report، ...).
 */
export function ReferralPanel({ entityType, entityId, onChanged, className, hideRefer }: { entityType: string; entityId: string; onChanged?: () => void; className?: string; hideRefer?: boolean }) {
  const [info, setInfo] = useState<EntityReferralInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [additional, setAdditional] = useState(false);
  const [responseNote, setResponseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchEntityReferrals(entityType, entityId)
      .then((r) => {
        setInfo(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [entityType, entityId]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function openForm() {
    setFormOpen((v) => !v);
    if (users.length === 0) fetchUsers().then((u) => setUsers(u.filter((x) => x.status !== "DISABLED"))).catch(() => undefined);
  }

  if (failed || !info) return failed ? null : <div className={clsx("text-[11.5px] text-muted", className)}>در حال بارگذاری ارجاع...</div>;

  const { current, additional: others, history, myActive } = info;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toUserId) return;
    void run(
      () => referDocument({ entityType, entityId, toUserId, note: note.trim() || undefined, dueAt: dueAt ? new Date(`${dueAt}T23:59:00`).toISOString() : undefined, additional }),
      () => {
        setFormOpen(false);
        setToUserId("");
        setNote("");
        setDueAt("");
        setAdditional(false);
      },
    );
  }

  return (
    <div className={clsx("flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3", className)} data-testid="referral-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <ReferralBadge current={current} completed={info.completed} />
        {others.map((o) => (
          <Badge key={o.id} tone={REFERRAL_STATUS_TONE[o.status]}>
            همکار: {o.toName}
          </Badge>
        ))}
        <div className="flex-1" />
        {info.canRefer && !hideRefer ? (
          <button type="button" onClick={openForm} className={clsx(BTN, "text-primary bg-primary-soft")}>
            {current ? "ارجاع مجدد" : "ارجاع"}
          </button>
        ) : null}
        {history.length > 0 ? (
          <button type="button" onClick={() => setHistoryOpen((v) => !v)} className={clsx(BTN, "text-ink-soft bg-slate-100")}>
            تاریخچه ({toPersianDigits(history.length)})
          </button>
        ) : null}
      </div>

      {myActive ? (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <div className="text-[12px] text-ink-soft">
            این سند به شما ارجاع شده است{myActive.fromName ? ` (از طرف ${myActive.fromName})` : ""}
            {myActive.note ? ` — «${myActive.note}»` : ""}
            {myActive.dueAt ? ` · موعد: ${formatJalaliDateTime(myActive.dueAt)}` : ""}
          </div>
          <input value={responseNote} onChange={(e) => setResponseNote(e.target.value)} placeholder="یادداشت (اختیاری؛ هنگام برگشت توضیح دهید)" className={FIELD} maxLength={500} />
          <div className="flex flex-wrap gap-2">
            {myActive.status === "PENDING" ? (
              <button type="button" disabled={busy} onClick={() => run(() => respondReferral(myActive.id, "accept", responseNote.trim() || undefined), () => setResponseNote(""))} className={clsx(BTN, "bg-primary text-white")}>
                پذیرش و شروع پیگیری
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => run(() => respondReferral(myActive.id, "complete", responseNote.trim() || undefined), () => setResponseNote(""))} className={clsx(BTN, "bg-success text-white")}>
              انجام شد
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => respondReferral(myActive.id, "return", responseNote.trim() || undefined), () => setResponseNote(""))} className={clsx(BTN, "bg-danger-soft text-danger")}>
              برگشت به ارجاع‌دهنده
            </button>
          </div>
        </div>
      ) : null}

      {current && !myActive && current.fromUserId && info.canRefer && !hideRefer ? (
        <div>
          <button type="button" disabled={busy} onClick={() => run(() => respondReferral(current.id, "cancel"))} className={clsx(BTN, "text-ink-soft bg-slate-100")}>
            لغو ارجاع فعلی
          </button>
        </div>
      ) : null}

      {formOpen ? (
        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-2">
          <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} className={FIELD} required>
            <option value="">انتخاب کارشناس...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح برای کارشناس (اختیاری)" rows={2} maxLength={1000} className={FIELD} />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11.5px] text-muted">موعد پیگیری (اختیاری):</span>
            <JalaliDateInput value={dueAt} onChange={setDueAt} placeholder="بدون موعد" />
          </div>
          {current ? (
            <label className="flex items-center gap-2 text-[11.5px] text-ink-soft cursor-pointer">
              <input type="checkbox" checked={additional} onChange={(e) => setAdditional(e.target.checked)} />
              به‌عنوان همکار اضافه شود (مسئول فعلی جایگزین نشود)
            </label>
          ) : null}
          <div className="text-[11px] text-muted">گیرنده تا پایان ارجاع می‌تواند همین سند را ببیند و ویرایش کند (طبق قواعد وضعیت سند؛ بدون حذف/ابطال/تأیید/پرداخت) و پس از «انجام شد» همچنان فقط می‌تواند آن را ببیند.</div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !toUserId} className={clsx(BTN, "bg-primary text-white")}>
              {busy ? "..." : "ارسال ارجاع"}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className={clsx(BTN, "bg-slate-100 text-ink-soft")}>
              انصراف
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="text-[12px] text-danger font-semibold">{error}</div> : null}

      {historyOpen ? (
        <ReferralTimeline
          items={history}
          busy={busy}
          onRevoke={(id) => {
            if (window.confirm("دسترسی مشاهده‌ی این سند برای گیرنده لغو شود؟")) void run(() => respondReferral(id, "revoke"));
          }}
        />
      ) : null}
    </div>
  );
}

/** نشان «مسئول پیگیری: نام» — برای سرتیتر سند. */
export function ReferralBadge({ current, completed }: { current: DocumentReferral | null; completed?: DocumentReferral | null }) {
  if (!current && completed) {
    return (
      <Badge tone="success" title={completed.resolvedAt ? formatJalaliDateTime(completed.resolvedAt) : undefined}>
        انجام‌شده توسط {completed.toName ?? "—"}
        {completed.resolvedAt ? ` · ${formatJalaliDateTime(completed.resolvedAt)}` : ""}
      </Badge>
    );
  }
  if (!current) return <span className="text-[12px] text-muted">مسئول پیگیری: —</span>;
  return (
    <Badge tone={current.overdue ? "danger" : REFERRAL_STATUS_TONE[current.status]} title={current.statusLabel}>
      مسئول پیگیری: {current.toName ?? "—"} · {current.statusLabel}
      {current.overdue ? " · دیرکرد" : ""}
    </Badge>
  );
}

function ReferralTimeline({ items, busy, onRevoke }: { items: DocumentReferral[]; busy: boolean; onRevoke: (id: string) => void }) {
  return (
    <ol className="flex flex-col gap-2 border-t border-border pt-2 text-[12px]">
      {[...items].reverse().map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5 bg-white border border-border rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold">
              {r.fromName ?? "سیستم"} ← {r.toName ?? "—"}
            </span>
            <Badge tone={REFERRAL_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
            <span className="text-muted text-[11px]">{formatJalaliDateTime(r.createdAt)}</span>
          </div>
          {r.note ? <div className="text-ink-soft">یادداشت: {r.note}</div> : null}
          {r.dueAt ? <div className="text-muted">موعد: {formatJalaliDateTime(r.dueAt)}</div> : null}
          {r.acceptedAt ? <div className="text-muted">پذیرفته شد: {formatJalaliDateTime(r.acceptedAt)}</div> : null}
          {r.canRevoke ? (
            <div>
              <button type="button" disabled={busy} onClick={() => onRevoke(r.id)} className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer disabled:opacity-50">
                لغو دسترسی
              </button>
            </div>
          ) : null}
          {r.resolvedAt ? (
            <div className="text-muted">
              {r.statusLabel}: {formatJalaliDateTime(r.resolvedAt)}
              {r.resolvedByName ? ` · ${r.resolvedByName}` : ""}
              {r.resolvedNote ? ` — ${r.resolvedNote}` : ""}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
