"use client";

import { useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/icons";
import { ApiError, type ShipmentStatus } from "@/lib/api";
import { fileToDataUri, uploadErrorMessage } from "@/lib/upload";
import { toPersianDigits } from "@/lib/persian";
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_TONES, dispatchAction, type DispatchDetail, type DispatchDocType } from "@/lib/dispatch-api";

export const INPUT = "w-full text-[13px] outline-none bg-white border border-border rounded-xl px-3 py-2.5";
export const BTN_PRIMARY = "px-4 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50";
export const BTN_SOFT = "px-4 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer disabled:opacity-50";
export const BTN_DANGER = "px-4 py-2.5 rounded-xl bg-danger-soft text-danger text-[12.5px] font-bold cursor-pointer disabled:opacity-50";
export const LABEL = "text-[11.5px] text-muted mb-1 block";

export function kgText(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${toPersianDigits(n.toLocaleString("en-US", { maximumFractionDigits: 3 }))} کیلوگرم`;
}

export function errText(e: unknown, fallback = "عملیات ناموفق بود"): string {
  return e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback;
}

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <Badge tone={DISPATCH_STATUS_TONES[status] ?? "neutral"}>{DISPATCH_STATUS_LABELS[status] ?? status}</Badge>;
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("bg-surface border border-border rounded-2xl p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[13.5px] font-extrabold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export type StepState = "done" | "active" | "locked" | "failed";

export function StepCard({ n, title, state, meta, children }: { n: number; title: string; state: StepState; meta?: string | null; children?: ReactNode }) {
  return (
    <div className={clsx("rounded-2xl border p-3.5 sm:p-4", state === "active" ? "border-primary bg-primary-soft/30" : state === "failed" ? "border-danger bg-danger-soft/40" : "border-border bg-surface", state === "locked" && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[12px] font-extrabold",
            state === "done" ? "bg-success text-white" : state === "failed" ? "bg-danger text-white" : state === "active" ? "bg-primary text-white" : "bg-slate-200 text-ink-soft",
          )}
        >
          {state === "done" ? <CheckIcon className="w-3.5 h-3.5" strokeWidth={3} /> : toPersianDigits(n)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-bold">{title}</div>
          {meta ? <div className="text-[11.5px] text-muted mt-0.5">{meta}</div> : null}
          {children ? <div className="mt-3 flex flex-col gap-2.5">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** بارگذاری سند با دوربین/اسکن یا انتخاب فایل — تصاویر قبل از ارسال کم‌حجم می‌شوند (prepareUpload). */
export function DocUploader({
  shipmentId,
  docTypes,
  fixedType,
  step,
  onDone,
  compact,
}: {
  shipmentId: string;
  docTypes: DispatchDocType[];
  fixedType?: string;
  step?: "TARE" | "GROSS";
  onDone: (d: DispatchDetail) => void;
  compact?: boolean;
}) {
  const active = docTypes.filter((t) => t.isActive);
  const [type, setType] = useState(fixedType ?? active[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fileUrl = await fileToDataUri(file);
      const name = active.find((t) => t.code === (fixedType ?? type))?.name ?? "سند";
      onDone(await dispatchAction.addDoc(shipmentId, { docTypeCode: fixedType ?? type, title: `${name} — ${file.name}`, fileUrl, step }));
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : uploadErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!fixedType ? (
          <select value={type} onChange={(e) => setType(e.target.value)} className={clsx(INPUT, compact ? "!w-auto !py-2" : "!w-auto")}>
            {active.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} />
        <input ref={pick} type="file" accept="image/*,application/pdf" className="hidden" onChange={handle} />
        <button type="button" disabled={busy} onClick={() => cam.current?.click()} className={BTN_SOFT}>
          {busy ? "در حال بارگذاری..." : "عکس / اسکن"}
        </button>
        <button type="button" disabled={busy} onClick={() => pick.current?.click()} className={BTN_SOFT}>
          انتخاب فایل
        </button>
      </div>
      {err ? <div className="text-[12px] text-danger font-semibold">{err}</div> : null}
    </div>
  );
}
