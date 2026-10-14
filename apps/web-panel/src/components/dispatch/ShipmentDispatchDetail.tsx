"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { SignatureEvidencePanel } from "@/components/shared/SignatureEvidencePanel";
import { useWorkspace } from "@/lib/workspace-context";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import {
  DISPATCH_STATUS_LABELS,
  dispatchAction,
  enrollDispatch,
  fetchDispatchDetail,
  fetchDispatchDrivers,
  type DispatchDetail,
  type DispatchDriver,
  type DispatchEvent,
} from "@/lib/dispatch-api";
import { fileToDataUri, uploadErrorMessage } from "@/lib/upload";
import { BTN_DANGER, BTN_PRIMARY, BTN_SOFT, DocUploader, INPUT, LABEL, Section, StatusBadge, StepCard, errText, kgText, type StepState } from "./dispatch-ui";

const EVENT_LABELS: Record<string, string> = {
  created: "ثبت اعلام بار",
  enrolled: "شروع گردش اعلام بار",
  driver_assigned: "تعیین راننده",
  arrived: "رسیدن ماشین",
  cleanliness: "بررسی نظافت",
  tare: "ثبت وزن خالی",
  loaded: "بارگیری",
  gross: "ثبت وزن پر",
  net_edited: "ویرایش دستی وزن خالص",
  weight_confirmed: "تأیید وزن نهایی",
  docs_rules: "فعال‌شدن قانون اسناد",
  doc_added: "افزودن سند",
  doc_removed: "حذف سند",
  docs_override: "عبور از دروازه‌ی اسناد",
  final_check: "کنترل نهایی",
  ready_granted: "مجوز آماده حرکت",
  receipt_link: "لینک رسید راننده",
  receipt_signed: "رسید با امضای راننده",
  receipt_paper: "رسید کاغذی",
  receipt_pdf: "PDF رسید",
  receipt_pdf_failed: "خطا در PDF رسید",
  departed: "حرکت",
  delivered: "تحویل",
  status_auto: "تغییر خودکار وضعیت",
  manual_status: "تغییر دستی وضعیت",
  suspended: "توقف",
  resumed: "ازسرگیری",
  cancelled: "لغو",
  invoice_adjustment_proposed: "پیشنهاد تعدیل فاکتور",
  invoice_adjustment_applied: "اعمال تعدیل فاکتور",
  invoice_adjustment_rejected: "رد تعدیل فاکتور",
  invoice_no_adjustment: "وزن با فاکتور یکی بود",
  invoice_finalized: "نهایی‌شدن فاکتور",
  invoice_finalize_failed: "خطا در نهایی‌کردن فاکتور",
  approval_rejected: "رد در کارتابل",
  evidence_failed: "خطا در ثبت مدرک امضا",
};

function when(d: string | null | undefined) {
  return d ? formatJalaliDateTime(d) : "";
}
const who = (name: string | null | undefined, at: string | null | undefined) => [name, when(at)].filter(Boolean).join(" · ") || null;

/** بخش اسناد: نوع‌های لازم، وضعیت هرکدام، بارگذاری با دوربین/فایل و عبور مدیر با دلیل. */
export function DispatchDocsBlock({ d, onChange }: { d: DispatchDetail; onChange: (d: DispatchDetail) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const typeName = (code: string) => d.docTypes.find((t) => t.code === code)?.name ?? code;
  const required = new Set(d.requiredDocTypes);

  async function run(fn: () => Promise<DispatchDetail>) {
    setBusy(true);
    setErr(null);
    try {
      onChange(await fn());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {d.requiredDocTypes.length === 0 ? <div className="text-[12.5px] text-muted">برای این بار سند الزامی تعریف نشده است.</div> : null}
      <div className="flex flex-wrap gap-1.5">
        {d.requiredDocTypes.map((c) => {
          const ok = !d.missingDocTypes.includes(c);
          return (
            <Badge key={c} tone={ok ? "success" : "warning"}>
              {ok ? "✓ " : ""}
              {typeName(c)}
            </Badge>
          );
        })}
      </div>
      {d.shipment.loading?.docsOverrideAt ? (
        <div className="text-[12px] text-warning font-semibold">
          عبور از دروازه‌ی اسناد توسط {d.shipment.loading.docsOverrideByName} — دلیل: {d.shipment.loading.docsOverrideReason}
        </div>
      ) : null}
      {d.documents.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {d.documents.map((x) => (
            <div key={x.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 text-[12.5px]">
              <Badge tone={required.has(x.docTypeCode) ? "primary" : "neutral"}>{typeName(x.docTypeCode)}</Badge>
              {x.fileUrl ? (
                <a href={x.fileUrl} download={x.title ?? undefined} target={x.fileUrl.startsWith("data:") ? undefined : "_blank"} rel="noreferrer" className="flex-1 min-w-0 truncate font-bold text-primary">
                  {x.title ?? "سند"}
                </a>
              ) : (
                <span className="flex-1 truncate">{x.title ?? "سند"}</span>
              )}
              <span className="text-[10.5px] text-muted shrink-0">{x.createdByName}</span>
              {d.can.docs ? (
                <button onClick={() => window.confirm("این سند حذف شود؟") && run(() => dispatchAction.removeDoc(d.shipment.id, x.id))} disabled={busy} className="text-[11px] font-bold text-danger cursor-pointer">
                  حذف
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {d.can.docs ? <DocUploader shipmentId={d.shipment.id} docTypes={d.docTypes} onDone={onChange} /> : null}
      {d.can.override && d.requiredDocTypes.length > 0 && d.missingDocTypes.length > 0 && !d.shipment.loading?.docsOverrideAt ? (
        overrideOpen ? (
          <div className="flex flex-col gap-2 bg-warning-soft/40 rounded-xl p-3">
            <label className={LABEL}>دلیل عبور بدون تکمیل اسناد (الزامی)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} />
            <div className="flex gap-2">
              <button disabled={busy || reason.trim().length < 3} onClick={() => run(() => dispatchAction.overrideDocs(d.shipment.id, reason.trim()))} className={BTN_DANGER}>
                عبور با مسئولیت من
              </button>
              <button onClick={() => setOverrideOpen(false)} className={BTN_SOFT}>
                انصراف
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOverrideOpen(true)} className="self-start text-[12px] font-bold text-warning cursor-pointer">
            عبور از دروازه‌ی اسناد (دسترسی مدیر)…
          </button>
        )
      ) : null}
      {err ? <div className="text-[12px] text-danger font-semibold">{err}</div> : null}
    </div>
  );
}

/** دکمه‌ی «آماده حرکت» — همین بخش در صفحه‌ی بار و پنل وظیفه‌ی اسناد استفاده می‌شود (فقط همین دو جا). */
export function DispatchReadyBlock({ d, onChange }: { d: DispatchDetail; onChange: (d: DispatchDetail) => void }) {
  const l = d.shipment.loading;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!l) return null;
  if (l.readyGrantedAt) return <div className="text-[12.5px] text-success font-bold">مجوز «آماده حرکت» صادر شد — {who(l.readyGrantedByName, l.readyGrantedAt)}</div>;
  const blockers: string[] = [];
  if (l.finalCheckResult !== "PASS") blockers.push("کنترل نهایی هنوز تأیید نشده");
  if (l.needsWeighing && !l.weightConfirmedAt) blockers.push("وزن نهایی تأیید نشده");
  if (d.requiredDocTypes.length > 0 && !d.docsComplete && !l.docsOverrideAt) blockers.push("اسناد الزامی کامل نیست");
  return (
    <div className="flex flex-col gap-2">
      {blockers.length ? <ul className="text-[12px] text-warning list-disc pr-4">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
      {d.can.ready ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح (اختیاری)" className={INPUT} />
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                onChange(await dispatchAction.ready(d.shipment.id, note.trim() || undefined));
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
            className="px-4 py-3 rounded-xl bg-success text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
          >
            {busy ? "در حال ثبت..." : "صدور مجوز «آماده حرکت»"}
          </button>
        </>
      ) : (
        <div className="text-[12px] text-muted">صدور مجوز فقط برای مسئول اسناد این بار، مجازهای تنظیمات و مدیر ممکن است و پس از رفع موارد بالا فعال می‌شود.</div>
      )}
      {err ? <div className="text-[12px] text-danger font-semibold">{err}</div> : null}
    </div>
  );
}

function Timeline({ events }: { events: DispatchEvent[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="border-r-2 border-border pr-3">
          <div className="text-[12.5px] font-bold">
            {EVENT_LABELS[e.type] ?? e.type}
            {e.toStatus ? <span className="text-muted font-normal"> — {e.fromStatus ? `${DISPATCH_STATUS_LABELS[e.fromStatus as keyof typeof DISPATCH_STATUS_LABELS] ?? e.fromStatus} ← ` : ""}{DISPATCH_STATUS_LABELS[e.toStatus as keyof typeof DISPATCH_STATUS_LABELS] ?? e.toStatus}</span> : null}
          </div>
          <div className="text-[11px] text-muted">
            {e.actorName ?? "سیستم"} · {when(e.createdAt)}
          </div>
          {e.note ? <div className="text-[12px] text-ink-soft mt-0.5 whitespace-pre-wrap">{e.note}</div> : null}
          {e.reason ? <div className="text-[12px] text-warning mt-0.5">دلیل: {e.reason}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function ShipmentDispatchDetail({ shipmentId }: { shipmentId: string }) {
  const { installedModules } = useWorkspace();
  const [d, setD] = useState<DispatchDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [driverId, setDriverId] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [grossKg, setGrossKg] = useState("");
  const [cleanNote, setCleanNote] = useState("");
  const [fcNote, setFcNote] = useState("");
  const [loadingOk, setLoadingOk] = useState(false);
  const [tarpOk, setTarpOk] = useState(false);
  const [netEdit, setNetEdit] = useState<{ kg: string; reason: string } | null>(null);
  const [statusPanel, setStatusPanel] = useState<null | "suspend" | "resume" | "cancel" | "manual">(null);
  const [panelReason, setPanelReason] = useState("");
  const [manualTo, setManualTo] = useState("ACCEPTED");
  const [departOverride, setDepartOverride] = useState("");
  const [paperBusy, setPaperBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetchDispatchDetail(shipmentId)
      .then((r) => {
        setD(r);
        setLoadErr(null);
      })
      .catch((e) => setLoadErr(errText(e, "بار یافت نشد")));
  }, [shipmentId]);
  useEffect(load, [load]);
  useEffect(() => {
    fetchDispatchDrivers().then(setDrivers).catch(() => {});
  }, []);

  async function run(fn: () => Promise<DispatchDetail | { detail: DispatchDetail }>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      setD("detail" in r ? r.detail : r);
      after?.();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const l = d?.shipment.loading ?? null;
  const s = d?.shipment ?? null;
  const can = useMemo(() => d?.can ?? {}, [d]);

  const states = useMemo(() => {
    const st = (done: boolean, allowed: boolean | undefined, failed = false): StepState => (failed ? "failed" : done ? "done" : allowed ? "active" : "locked");
    return {
      driver: st(!!s?.driverId, can.assignDriver),
      arrival: st(!!l?.arrivedAt, can.arrival),
      clean: st(l?.cleanlinessResult === "PASS", can.cleanliness, l?.cleanlinessResult === "FAIL"),
      tare: st(l?.tareKg != null, can.tare),
      loading: st(!!l?.loadedAt, can.loading),
      gross: st(l?.grossKg != null, can.gross),
      weight: st(!!l?.weightConfirmedAt, can.confirmWeight),
      docs: st(!!d && d.requiredDocTypes.length > 0 ? d.docsComplete || !!l?.docsOverrideAt : l?.grossKg != null, can.docs && l?.grossKg != null),
      final: st(l?.finalCheckResult === "PASS", can.finalCheck, l?.finalCheckResult === "FAIL"),
      ready: st(!!l?.readyGrantedAt, can.ready),
      receipt: st(d?.receipt?.status === "SIGNED" || d?.receipt?.status === "PAPER", can.receipt),
      depart: st(!!l?.departedAt, can.depart),
      deliver: st(s?.status === "DELIVERED", can.deliver),
    };
  }, [d, l, s, can]);

  if (loadErr) return <div className="p-8 text-center text-danger text-sm">{loadErr}</div>;
  if (!d || !s) return <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;

  async function paperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !s) return;
    setPaperBusy(true);
    setErr(null);
    try {
      const fileUrl = await fileToDataUri(file);
      setD(await dispatchAction.paperReceipt(s.id, `رسید کاغذی بار ${s.shipmentNo}`, fileUrl));
    } catch (error) {
      setErr(errText(error, uploadErrorMessage(error)));
    } finally {
      setPaperBusy(false);
    }
  }

  const terminal = s.status === "DELIVERED" || s.status === "CANCELLED";
  const adj = d.adjustment;

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-[900px] mx-auto flex flex-col gap-4 pb-24">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link href="/dispatch" className="text-[12px] text-muted">← فهرست اعلام بار</Link>
          <h1 className="text-xl font-extrabold mt-1">
            بار #{toPersianDigits(s.shipmentNo)} — {s.cargoType}
          </h1>
          <div className="text-[12.5px] text-muted mt-0.5">
            {l?.customerName ?? s.contact?.name ?? "بدون مشتری"}
            {s.driver ? ` · ${s.driver.name}${s.driver.plateNumber ? ` (${s.driver.plateNumber})` : ""}` : ""}
          </div>
        </div>
        <StatusBadge status={s.status} />
      </div>

      {err ? <div className="text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3 py-2">{err}</div> : null}

      {!l ? (
        <Section title="گردش اعلام بار شروع نشده">
          <p className="text-[12.5px] text-ink-soft mb-3">این بار در ناوگان ثبت شده ولی چک‌لیست بارگیری، وزن و اسناد برایش فعال نیست.</p>
          {can.edit !== false ? (
            <button disabled={busy} onClick={() => run(() => enrollDispatch(s.id))} className={BTN_PRIMARY}>
              شروع گردش اعلام بار
            </button>
          ) : null}
        </Section>
      ) : (
        <>
          {/* وزن‌ها */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ["وزن خالی", l.tareKg],
              ["وزن پر", l.grossKg],
              ["وزن خالص", l.netKg],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-surface border border-border rounded-2xl p-3 text-center">
                <div className="text-[11px] text-muted">{k}</div>
                <div className="text-[13.5px] font-extrabold mt-1">{kgText(v as number | null)}</div>
              </div>
            ))}
          </div>
          {l.netEdited ? <div className="text-[12px] text-warning font-semibold -mt-2">وزن خالص دستی ویرایش شده — دلیل: {l.netEditReason}</div> : null}

          <Section title="اطلاعات بار و مشتری">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
              <div>مشتری: <b>{l.customerName ?? "—"}</b></div>
              <div>شناسه یکتا: <b>{l.uniqueId ?? "—"}</b></div>
              <div>کد ملی: <b>{l.nationalId ?? "—"}</b></div>
              <div>کد پستی: <b>{l.postalCode ?? "—"}</b></div>
              <div className="sm:col-span-2">آدرس پستی: <b>{l.postalAddress ?? "—"}</b></div>
              <div>مقدار اعلامی: <b>{toPersianDigits(s.quantity)} {s.unit ?? ""}</b></div>
              <div>زمان بارگیری: <b>{formatJalaliDateTime(s.pickupAt)}</b></div>
              <div className="sm:col-span-2">آدرس تحویل: <b>{s.deliveryAddress}</b></div>
              {l.needsWeighing ? <div className="sm:col-span-2"><Badge tone="warning">نیاز به وزن‌کشی — نهایی‌شدن فاکتور مشروط به تأیید وزن است</Badge></div> : null}
            </div>
          </Section>

          <div className="flex flex-col gap-2.5">
            <StepCard n={1} title="راننده" state={states.driver} meta={s.driver ? `${s.driver.name} — ${s.driver.phone}${s.driver.plateNumber ? ` — پلاک ${s.driver.plateNumber}` : ""}` : "در انتظار راننده"}>
              {can.assignDriver ? (
                <div className="flex flex-wrap gap-2">
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={`${INPUT} !w-auto min-w-[200px]`}>
                    <option value="">انتخاب راننده…</option>
                    {drivers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}{x.plateNumber ? ` — ${x.plateNumber}` : ""}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy || !driverId} onClick={() => run(() => dispatchAction.assignDriver(s.id, driverId))} className={BTN_PRIMARY}>
                    {s.driverId ? "تغییر راننده" : "تعیین راننده"}
                  </button>
                  {installedModules.has("fleet") ? (
                    <Link href="/fleet" className={BTN_SOFT}>پیشنهاد به راننده‌ها (ناوگان)</Link>
                  ) : null}
                </div>
              ) : null}
            </StepCard>

            <StepCard n={2} title="رسیدن ماشین" state={states.arrival} meta={who(l.arrivedByName, l.arrivedAt)}>
              {can.arrival ? (
                <button disabled={busy} onClick={() => run(() => dispatchAction.arrival(s.id))} className={BTN_PRIMARY}>ماشین رسید</button>
              ) : null}
            </StepCard>

            <StepCard
              n={3}
              title="نظافت ماشین"
              state={states.clean}
              meta={l.cleanlinessResult ? `${l.cleanlinessResult === "PASS" ? "تأیید" : "مردود"} — ${who(l.cleanlinessByName, l.cleanlinessAt)}${l.cleanlinessNote ? ` — ${l.cleanlinessNote}` : ""}` : null}
            >
              {can.cleanliness ? (
                <>
                  <input value={cleanNote} onChange={(e) => setCleanNote(e.target.value)} placeholder="یادداشت (برای مردودی الزامی)" className={INPUT} />
                  <div className="text-[11px] text-muted">تأییدکننده و زمان به‌صورت خودکار از کاربر واردشده ثبت می‌شود.</div>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => run(() => dispatchAction.cleanliness(s.id, "PASS", cleanNote.trim() || undefined), () => setCleanNote(""))} className="px-4 py-2.5 rounded-xl bg-success text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50">تأیید نظافت</button>
                    <button disabled={busy || cleanNote.trim().length < 2} onClick={() => run(() => dispatchAction.cleanliness(s.id, "FAIL", cleanNote.trim()))} className={BTN_DANGER}>مردود</button>
                  </div>
                </>
              ) : null}
              {can.cleanliness || l.cleanlinessResult || l.arrivedAt ? <AttachmentsSection entityType="ShipmentLoading" entityId={s.id} capture readOnly={!can.cleanliness} /> : null}
            </StepCard>

            <StepCard n={4} title="وزن خالی ماشین (باسکول)" state={states.tare} meta={l.tareKg != null ? `${kgText(l.tareKg)} — ${who(l.tareByName, l.tareAt)}` : null}>
              {can.tare ? (
                <>
                  <div className="flex gap-2 items-center">
                    <input value={tareKg} onChange={(e) => setTareKg(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr" placeholder="وزن خالی (کیلوگرم)" className={INPUT} />
                    <button disabled={busy || !Number(tareKg)} onClick={() => run(() => dispatchAction.tare(s.id, Number(tareKg)))} className={BTN_PRIMARY}>ثبت</button>
                  </div>
                  <div className="text-[11.5px] text-muted">عکس قبض باسکول (خالی):</div>
                  <DocUploader shipmentId={s.id} docTypes={d.docTypes} fixedType="WEIGHBRIDGE_TICKET" step="TARE" onDone={setD} compact />
                </>
              ) : null}
            </StepCard>

            <StepCard n={5} title="بارگیری" state={states.loading} meta={who(l.loaderName, l.loadedAt)}>
              {can.loading ? <button disabled={busy} onClick={() => run(() => dispatchAction.loaded(s.id))} className={BTN_PRIMARY}>بارگیری انجام شد</button> : null}
            </StepCard>

            <StepCard n={6} title="وزن پر و وزن خالص" state={states.gross} meta={l.grossKg != null ? `پر: ${kgText(l.grossKg)} — خالص: ${kgText(l.netKg)} — ${who(l.grossByName, l.grossAt)}` : null}>
              {can.gross ? (
                <>
                  <div className="flex gap-2 items-center">
                    <input value={grossKg} onChange={(e) => setGrossKg(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr" placeholder="وزن پر (کیلوگرم)" className={INPUT} />
                    <button disabled={busy || !Number(grossKg)} onClick={() => run(() => dispatchAction.gross(s.id, Number(grossKg)))} className={BTN_PRIMARY}>ثبت</button>
                  </div>
                  {l.tareKg != null && Number(grossKg) > l.tareKg ? <div className="text-[12px] text-ink-soft">وزن خالص = {kgText(Number(grossKg) - l.tareKg)}</div> : null}
                  <div className="text-[11.5px] text-muted">عکس قبض باسکول (پر):</div>
                  <DocUploader shipmentId={s.id} docTypes={d.docTypes} fixedType="WEIGHBRIDGE_TICKET" step="GROSS" onDone={setD} compact />
                </>
              ) : null}
              {can.editNet ? (
                netEdit ? (
                  <div className="flex flex-col gap-2 bg-warning-soft/40 rounded-xl p-3">
                    <input value={netEdit.kg} onChange={(e) => setNetEdit({ ...netEdit, kg: e.target.value.replace(/[^\d.]/g, "") })} dir="ltr" placeholder="وزن خالص جدید (کیلوگرم)" className={INPUT} />
                    <input value={netEdit.reason} onChange={(e) => setNetEdit({ ...netEdit, reason: e.target.value })} placeholder="دلیل ویرایش (الزامی)" className={INPUT} />
                    <div className="flex gap-2">
                      <button disabled={busy || !Number(netEdit.kg) || netEdit.reason.trim().length < 3} onClick={() => run(() => dispatchAction.net(s.id, Number(netEdit.kg), netEdit.reason.trim()), () => setNetEdit(null))} className={BTN_DANGER}>ثبت ویرایش</button>
                      <button onClick={() => setNetEdit(null)} className={BTN_SOFT}>انصراف</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNetEdit({ kg: String(l.netKg ?? ""), reason: "" })} className="self-start text-[12px] font-bold text-warning cursor-pointer">ویرایش دستی وزن خالص (دسترسی مدیر)…</button>
                )
              ) : null}
            </StepCard>

            {l.needsWeighing ? (
              <StepCard n={7} title="تأیید وزن نهایی و تعدیل فاکتور" state={states.weight} meta={l.weightConfirmedAt ? who(l.weightConfirmedByName, l.weightConfirmedAt) : "فاکتور تا تأیید وزن نهایی نمی‌شود"}>
                {can.confirmWeight ? <button disabled={busy} onClick={() => run(() => dispatchAction.confirmWeight(s.id))} className={BTN_PRIMARY}>تأیید وزن نهایی ({kgText(l.netKg)})</button> : null}
                {adj ? (
                  <div className="bg-slate-50 border border-border rounded-xl p-3 text-[12.5px] flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <b>تعدیل فاکتور</b>
                      <Badge tone={adj.status === "APPLIED" || adj.status === "NO_CHANGE" ? "success" : adj.status === "PROPOSED" ? "warning" : "danger"}>
                        {{ PROPOSED: "در انتظار تأیید", APPLIED: "اعمال شد", REJECTED: "رد شد", NO_CHANGE: "بدون تغییر" }[adj.status]}
                      </Badge>
                    </div>
                    {adj.lineChanges.filter((c) => c.oldQty !== c.newQty).map((c) => (
                      <div key={c.lineId}>{c.description}: {toPersianDigits(c.oldQty)} ← <b>{toPersianDigits(c.newQty)}</b></div>
                    ))}
                    <div>جمع فاکتور: {formatToman(adj.oldTotal)} ← <b>{formatToman(adj.newTotal)}</b></div>
                    {adj.finalizedAt ? <div className="text-success font-bold">فاکتور نهایی و سند حسابداری ثبت شد</div> : null}
                    {adj.finalizeError ? <div className="text-danger">نهایی‌کردن خودکار ناموفق: {adj.finalizeError}</div> : null}
                    {can.decideAdjustment && adj.status === "PROPOSED" ? (
                      <div className="flex gap-2 mt-1">
                        <button disabled={busy} onClick={() => run(() => dispatchAction.decideAdjustment(s.id, true))} className="px-4 py-2 rounded-xl bg-success text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50">تأیید، اعمال و نهایی‌کردن فاکتور</button>
                        <button disabled={busy} onClick={() => run(() => dispatchAction.decideAdjustment(s.id, false))} className={BTN_DANGER}>رد</button>
                      </div>
                    ) : null}
                    {can.decideAdjustment && (adj.status === "APPLIED" || adj.status === "NO_CHANGE") && !adj.finalizedAt ? (
                      <button disabled={busy} onClick={() => run(() => dispatchAction.finalizeInvoice(s.id))} className={`${BTN_PRIMARY} self-start`}>تلاش دوباره برای نهایی‌کردن فاکتور</button>
                    ) : null}
                    {can.decideAdjustment && adj.status === "REJECTED" && l.weightConfirmedAt ? (
                      <button disabled={busy} onClick={() => run(() => dispatchAction.proposeAdjustment(s.id))} className={`${BTN_SOFT} self-start`}>پیشنهاد تعدیل جدید</button>
                    ) : null}
                  </div>
                ) : null}
              </StepCard>
            ) : null}

            <StepCard n={8} title="اسناد (بارنامه، قرنطینه، …)" state={states.docs} meta={d.task ? `وظیفه‌ی #${toPersianDigits(d.task.number)} برای ${d.task.assignees.map((a) => a.name).join("، ")}` : null}>
              <DispatchDocsBlock d={d} onChange={setD} />
              {d.task ? <Link href={`/tasks?open=${d.task.id}`} className="text-[12px] font-bold text-primary">باز کردن وظیفه ←</Link> : null}
            </StepCard>

            <StepCard
              n={9}
              title="کنترل نهایی (نفر دوم)"
              state={states.final}
              meta={l.finalCheckResult ? `${l.finalCheckResult === "PASS" ? "تأیید" : "مردود"} — ${who(l.finalCheckByName, l.finalCheckAt)}${l.finalCheckNote ? ` — ${l.finalCheckNote}` : ""}` : l.loaderName ? `بارگیرنده: ${l.loaderName} — کنترل باید توسط شخص دیگری انجام شود` : null}
            >
              {can.finalCheck ? (
                <>
                  <label className="flex items-center gap-2 text-[12.5px] cursor-pointer"><input type="checkbox" checked={loadingOk} onChange={(e) => setLoadingOk(e.target.checked)} className="w-4 h-4" />بارگیری صحیح انجام شده است</label>
                  <label className="flex items-center gap-2 text-[12.5px] cursor-pointer"><input type="checkbox" checked={tarpOk} onChange={(e) => setTarpOk(e.target.checked)} className="w-4 h-4" />چادر روی بار نصب شده است</label>
                  <input value={fcNote} onChange={(e) => setFcNote(e.target.value)} placeholder="یادداشت (برای مردودی الزامی)" className={INPUT} />
                  <div className="flex gap-2">
                    <button disabled={busy || !loadingOk || !tarpOk} onClick={() => run(() => dispatchAction.finalCheck(s.id, { result: "PASS", note: fcNote.trim() || undefined, loadingCorrect: true, tarpInstalled: true }))} className="px-4 py-2.5 rounded-xl bg-success text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50">تأیید کنترل نهایی</button>
                    <button disabled={busy || fcNote.trim().length < 2} onClick={() => run(() => dispatchAction.finalCheck(s.id, { result: "FAIL", note: fcNote.trim(), loadingCorrect: loadingOk, tarpInstalled: tarpOk }))} className={BTN_DANGER}>مردود</button>
                  </div>
                </>
              ) : null}
            </StepCard>

            <StepCard n={10} title="آماده حرکت" state={states.ready}>
              <DispatchReadyBlock d={d} onChange={setD} />
            </StepCard>

            <StepCard
              n={11}
              title="رسید بار راننده"
              state={states.receipt}
              meta={d.receipt ? (d.receipt.status === "SIGNED" ? `امضا شد — ${d.receipt.signerName ?? ""} · ${when(d.receipt.signedAt)}` : d.receipt.status === "PAPER" ? `رسید کاغذی — ${d.receipt.paperByName ?? ""} · ${when(d.receipt.signedAt)}` : d.receipt.sentAt ? `لینک ${when(d.receipt.sentAt)} ارسال شد؛ منتظر امضا` : "ساخته شد؛ منتظر امضا") : "پس از «آماده حرکت»"}
            >
              {d.receipt?.status === "PENDING" || !d.receipt ? (
                can.receipt ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={() => run(() => dispatchAction.sendReceipt(s.id))} className={BTN_PRIMARY}>ارسال پیامکی لینک رسید به راننده</button>
                      <label className={`${BTN_SOFT} inline-block`}>
                        {paperBusy ? "در حال بارگذاری..." : "ثبت رسید کاغذی (اسکن)"}
                        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={paperUpload} />
                      </label>
                    </div>
                    {d.receipt?.link ? (
                      <div className="flex items-center gap-2">
                        <input readOnly value={d.receipt.link} dir="ltr" className={`${INPUT} text-[11px]`} onFocus={(e) => e.currentTarget.select()} />
                        <button onClick={() => { void navigator.clipboard?.writeText(d.receipt!.link!); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className={BTN_SOFT}>{copied ? "کپی شد" : "کپی"}</button>
                      </div>
                    ) : null}
                  </div>
                ) : null
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  {d.receipt.hasPdf ? <Badge tone="success">PDF رسید پیوست شد</Badge> : <Badge tone="warning">PDF ساخته نشد</Badge>}
                  {d.receipt.archived ? <Badge tone="primary">در بایگانی ثبت شد</Badge> : null}
                  {can.receipt ? <button disabled={busy} onClick={() => run(() => dispatchAction.receiptPdf(s.id))} className="font-bold text-primary cursor-pointer">ساخت دوباره‌ی PDF</button> : null}
                </div>
              )}
            </StepCard>

            <StepCard n={12} title="حرکت (در مسیر)" state={states.depart} meta={l.departedAt ? who(l.departedByName, l.departedAt) : null}>
              {can.depart ? (
                <>
                  <button disabled={busy} onClick={() => run(() => dispatchAction.depart(s.id))} className={BTN_PRIMARY}>ماشین حرکت کرد</button>
                  {d.settings.receiptRequiredBefore === "DEPARTURE" && d.receipt?.status !== "SIGNED" && d.receipt?.status !== "PAPER" && can.override ? (
                    <div className="flex gap-2 items-center">
                      <input value={departOverride} onChange={(e) => setDepartOverride(e.target.value)} placeholder="دلیل حرکت بدون رسید" className={INPUT} />
                      <button disabled={busy || departOverride.trim().length < 3} onClick={() => run(() => dispatchAction.depart(s.id, departOverride.trim()))} className={BTN_DANGER}>حرکت بدون رسید</button>
                    </div>
                  ) : null}
                </>
              ) : l.receiptOverrideReason ? <div className="text-[12px] text-warning">حرکت بدون رسید — دلیل: {l.receiptOverrideReason}</div> : null}
            </StepCard>

            <StepCard n={13} title="تحویل به مشتری" state={states.deliver} meta={s.deliveredAt ? when(s.deliveredAt) : null}>
              {can.deliver ? <button disabled={busy} onClick={() => run(() => dispatchAction.deliver(s.id))} className={BTN_PRIMARY}>بار تحویل شد</button> : null}
            </StepCard>
          </div>

          {/* تغییر دستی وضعیت / توقف / لغو */}
          {!terminal ? (
            <Section title="تغییر وضعیت دستی">
              <div className="flex flex-wrap gap-2">
                {can.suspend ? <button onClick={() => setStatusPanel(statusPanel === "suspend" ? null : "suspend")} className={BTN_SOFT}>توقف بار</button> : null}
                {can.resume ? <button onClick={() => setStatusPanel(statusPanel === "resume" ? null : "resume")} className={BTN_SOFT}>ازسرگیری</button> : null}
                {can.manualStatus ? <button onClick={() => setStatusPanel(statusPanel === "manual" ? null : "manual")} className={BTN_SOFT}>تغییر وضعیت (مدیر)</button> : null}
                {can.cancel ? <button onClick={() => setStatusPanel(statusPanel === "cancel" ? null : "cancel")} className={BTN_DANGER}>لغو بار</button> : null}
              </div>
              {statusPanel ? (
                <div className="flex flex-col gap-2 mt-3">
                  {statusPanel === "manual" ? (
                    <select value={manualTo} onChange={(e) => setManualTo(e.target.value)} className={INPUT}>
                      {Object.entries(DISPATCH_STATUS_LABELS).filter(([k]) => !["DRAFT", "DELIVERED", "CANCELLED", "SUSPENDED", s.status].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : null}
                  <input value={panelReason} onChange={(e) => setPanelReason(e.target.value)} placeholder="دلیل (الزامی)" className={INPUT} />
                  <button
                    disabled={busy || panelReason.trim().length < 3}
                    onClick={() =>
                      run(
                        () => (statusPanel === "resume" ? dispatchAction.resume(s.id, panelReason.trim()) : dispatchAction.status(s.id, (statusPanel === "suspend" ? "SUSPENDED" : statusPanel === "cancel" ? "CANCELLED" : manualTo) as never, panelReason.trim())),
                        () => {
                          setStatusPanel(null);
                          setPanelReason("");
                        },
                      )
                    }
                    className={BTN_PRIMARY}
                  >
                    ثبت
                  </button>
                </div>
              ) : null}
            </Section>
          ) : null}
        </>
      )}

      <Section title="سایر فایل‌های بار">
        <AttachmentsSection entityType="Shipment" entityId={s.id} capture />
      </Section>

      {d.receipt?.status === "SIGNED" ? (
        <Section title="مدرک حقوقی امضای راننده">
          <SignatureEvidencePanel entityType="shipment" entityId={s.id} />
        </Section>
      ) : null}

      <Section title="تایم‌لاین (چه کسی، چه چیزی، کی)">
        <Timeline events={d.events} />
      </Section>
    </div>
  );
}
