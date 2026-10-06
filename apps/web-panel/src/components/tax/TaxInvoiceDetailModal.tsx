"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { ApiError, chainTaxInvoice, fetchTaxInvoice, taxInvoiceAction, updateTaxInvoice, type TaxInvoiceDetail } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { HEADER_LABELS, TAX_STATUS_LABELS, TAX_STATUS_TONES, TAX_SUBJECT_LABELS, inputClass, labelClass } from "./constants";

const btn = "text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50";

/** جزئیات یک صورتحساب مالیاتی: نواقص، پیش‌نمایش JSON مودیان، خط زمانی و اقدام‌های مرحله‌به‌مرحله. */
export function TaxInvoiceDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
  const [d, setD] = useState<TaxInvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taxid, setTaxid] = useState("");
  const [postal, setPostal] = useState("");
  const [showJson, setShowJson] = useState(false);

  function apply(next: TaxInvoiceDetail) {
    setD(next);
    setTaxid(next.taxid ?? "");
    setPostal(String(next.overrides?.buyerPostalCode ?? ""));
    onChanged();
  }

  useEffect(() => {
    let alive = true;
    fetchTaxInvoice(id)
      .then((r) => {
        if (!alive) return;
        setD(r);
        setTaxid(r.taxid ?? "");
        setPostal(String(r.overrides?.buyerPostalCode ?? ""));
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "بارگذاری ناموفق بود"));
    return () => {
      alive = false;
    };
  }, [id]);

  async function run(fn: () => Promise<TaxInvoiceDetail>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      const body = e instanceof ApiError ? e.message : "عملیات ناموفق بود";
      setError(body);
    } finally {
      setBusy(false);
    }
  }

  if (!d) {
    return (
      <Modal title="صورتحساب مالیاتی" onClose={onClose} width="max-w-[780px]">
        <div className="text-center text-muted text-sm py-6">{error ?? "در حال بارگذاری..."}</div>
      </Modal>
    );
  }

  const editable = d.status === "DRAFT";
  const blocking = d.issues.filter((i) => i.severity === "BLOCKING");
  const h = d.preview.payload.header;

  return (
    <Modal title={`صورتحساب مالیاتی — فاکتور ${toPersianDigits(d.salesInvoice.invoiceNo)}`} onClose={onClose} width="max-w-[780px]">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge tone={TAX_STATUS_TONES[d.status]}>{TAX_STATUS_LABELS[d.status]}</Badge>
        <Badge tone="neutral">{TAX_SUBJECT_LABELS[d.subject]}</Badge>
        <span className="text-[12.5px] text-ink-soft">{d.salesInvoice.contact.company || d.salesInvoice.contact.name}</span>
        <span className="text-[12.5px] font-bold">{formatToman(d.salesInvoice.total)}</span>
      </div>

      {error ? <div className="text-[12.5px] text-danger bg-danger-soft rounded-xl px-3 py-2 mb-3 whitespace-pre-line">{error}</div> : null}

      {d.errors?.length ? (
        <div className="bg-danger-soft rounded-xl p-3 mb-3">
          <div className="text-[12px] font-bold text-danger mb-1">خطاهای دریافتی</div>
          <ul className="list-disc pr-5 text-[12.5px] text-danger space-y-0.5">
            {d.errors.map((e, i) => (
              <li key={i}>
                {e.fa}
                {e.code ? <span className="text-muted"> ({e.code})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-3">
        <div className="text-[12px] font-bold mb-1">نواقص و هشدارها</div>
        {d.issues.length === 0 ? (
          <div className="text-[12.5px] text-success">مورد مسدودکننده‌ای نیست.</div>
        ) : (
          <ul className="space-y-1">
            {d.issues.map((i, n) => (
              <li key={n} className={`text-[12.5px] rounded-lg px-3 py-1.5 ${i.severity === "BLOCKING" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
                {i.severity === "BLOCKING" ? "مسدودکننده: " : "هشدار: "}
                {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editable ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={labelClass}>شماره منحصر به فرد مالیاتی (۲۲ نویسه‌ی هگز)</label>
            <input dir="ltr" value={taxid} onChange={(e) => setTaxid(e.target.value.trim())} maxLength={22} placeholder="AA56CD0E0620002F2B4E78" className={inputClass} />
            <div className="text-[11px] text-muted mt-1">ساخت خودکار هنوز راستی‌آزمایی نشده؛ شماره را از کارپوشه‌ی مودی وارد کنید.</div>
          </div>
          <div>
            <label className={labelClass}>کد پستی خریدار (۱۰ رقم)</label>
            <input dir="ltr" value={postal} onChange={(e) => setPostal(e.target.value.trim())} maxLength={10} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <button
              disabled={busy}
              onClick={() => run(() => updateTaxInvoice(d.id, { taxid, ...(postal ? { overrides: { buyerPostalCode: postal } } : {}) }))}
              className={`${btn} bg-surface border border-border text-ink-soft`}
            >
              ذخیره و بازبینی
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-[12px] mb-3">
          <div>
            <span className="text-muted">شماره مالیاتی: </span>
            <span dir="ltr" className="font-mono">{d.taxid ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted">شماره رهگیری: </span>
            <span dir="ltr" className="font-mono">{d.referenceNumber ?? "—"}</span>
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[12px] font-bold">
            پیش‌نمایش {d.preview.frozen ? "(منجمدشده در لحظه‌ی تأیید)" : "(زنده)"} <span className="text-muted font-normal">— نسخه‌ی نگاشت {d.preview.mappingVersion}</span>
          </div>
          <button onClick={() => setShowJson((v) => !v)} className="text-[11.5px] text-primary cursor-pointer">
            {showJson ? "پنهان‌کردن JSON" : "نمایش JSON کامل"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px] bg-slate-50 rounded-xl p-3">
          {Object.entries(HEADER_LABELS).map(([k, label]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-muted">{label}</span>
              <span dir="ltr" className="font-mono">{h[k] === null || h[k] === undefined ? "—" : String(h[k])}</span>
            </div>
          ))}
        </div>
        {showJson ? <pre dir="ltr" className="mt-2 text-[11px] bg-slate-50 rounded-xl p-3 overflow-auto max-h-[260px]">{JSON.stringify(d.preview.payload, null, 2)}</pre> : null}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {d.status === "DRAFT" ? (
          <>
            <button
              disabled={busy || blocking.length > 0}
              title={blocking.length ? "ابتدا نواقص مسدودکننده را برطرف کنید" : undefined}
              onClick={() => run(() => taxInvoiceAction(d.id, "request-approval"))}
              className={`${btn} bg-primary text-white`}
            >
              درخواست تأیید مدیر
            </button>
            <button disabled={busy} onClick={() => run(() => taxInvoiceAction(d.id, "discard"), "این صورتحساب پیش‌نویس لغو شود؟")} className={`${btn} bg-surface border border-border text-danger`}>
              لغو
            </button>
          </>
        ) : null}
        {d.status === "PENDING_APPROVAL" ? (
          isManager ? (
            <>
              <button
                disabled={busy}
                onClick={() => run(() => taxInvoiceAction(d.id, "approve"), "با تأیید، محتوای این صورتحساب منجمد و برای ارسال به سامانه مودیان در صف قرار می‌گیرد (ارسال فقط در صورت فعال‌بودن ارسال واقعی انجام می‌شود). تأیید می‌کنید؟")}
                className={`${btn} bg-success text-white`}
              >
                تأیید مدیر
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const note = window.prompt("دلیل رد (اختیاری)") ?? undefined;
                  void run(() => taxInvoiceAction(d.id, "reject", { note }));
                }}
                className={`${btn} bg-surface border border-border text-danger`}
              >
                رد
              </button>
            </>
          ) : (
            <span className="text-[12.5px] text-muted">در انتظار تأیید مدیر است.</span>
          )
        ) : null}
        {d.status === "APPROVED" ? (
          <button disabled={busy} onClick={() => run(() => taxInvoiceAction(d.id, "send"), "این صورتحساب همین حالا به سامانه مودیان ارسال شود؟")} className={`${btn} bg-primary text-white`}>
            ارسال همین حالا
          </button>
        ) : null}
        {d.status === "SENT" ? (
          <button disabled={busy} onClick={() => run(() => taxInvoiceAction(d.id, "inquire"))} className={`${btn} bg-primary text-white`}>
            استعلام نتیجه
          </button>
        ) : null}
        {d.status === "FAILED" ? (
          <button disabled={busy} onClick={() => run(() => taxInvoiceAction(d.id, "resend"))} className={`${btn} bg-primary text-white`}>
            ارسال مجدد (همان uid)
          </button>
        ) : null}
        {d.status === "REJECTED" ? (
          <button disabled={busy} onClick={() => run(() => taxInvoiceAction(d.id, "resend"), "صورتحساب به پیش‌نویس برمی‌گردد؛ پس از اصلاح نواقص باید دوباره تأیید مدیر بگیرد.")} className={`${btn} bg-primary text-white`}>
            بازگشایی برای اصلاح
          </button>
        ) : null}
        {d.status === "ACCEPTED" && d.subject !== "CANCELLATION" ? (
          <>
            <button
              disabled={busy}
              onClick={() => run(() => chainTaxInvoice(d.id, "CANCELLATION"), "برای ابطال این صورتحساب، یک صورتحساب «ابطالی» پیش‌نویس ساخته می‌شود که باید جداگانه تأیید و ارسال شود. ادامه می‌دهید؟")}
              className={`${btn} bg-surface border border-border text-danger`}
            >
              صدور ابطالی
            </button>
            <button disabled={busy} onClick={() => run(() => chainTaxInvoice(d.id, "CORRECTION"))} className={`${btn} bg-surface border border-border text-ink-soft`}>
              صدور اصلاحی
            </button>
          </>
        ) : null}
      </div>

      {d.chain.length ? (
        <div className="mb-3 text-[12px]">
          <div className="font-bold mb-1">ابطالی/اصلاحی‌های مرتبط</div>
          {d.chain.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Badge tone="neutral">{TAX_SUBJECT_LABELS[c.subject]}</Badge>
              <Badge tone={TAX_STATUS_TONES[c.status]}>{TAX_STATUS_LABELS[c.status]}</Badge>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="text-[12px] font-bold mb-1">خط زمانی و لاگ تماس‌ها</div>
        {d.logs.length === 0 ? (
          <div className="text-[12px] text-muted">هنوز رویدادی ثبت نشده است.</div>
        ) : (
          <ul className="space-y-1 max-h-[180px] overflow-auto">
            {d.logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-[11.5px] bg-slate-50 rounded-lg px-3 py-1.5">
                <span className={l.ok ? "text-success font-semibold" : "text-danger font-semibold"}>{l.kind}</span>
                <span className="text-muted">{l.errorCode ? `کد ${l.errorCode}` : l.httpStatus ? `HTTP ${l.httpStatus}` : ""}</span>
                <span className="text-muted">{formatJalaliDateTime(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
