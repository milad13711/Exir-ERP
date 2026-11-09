"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Badge, type Tone } from "@/components/ui/Badge";
import { formatMoney, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { AGENT_LEVEL_LABELS, AGENT_STAGE_LABELS, AGENT_STATUS_LABELS, ApiError, type AgentFunnelStage, type AgentLevel, type AgentMembershipStatus } from "@/lib/api";

export const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 min-h-[40px] focus:border-primary transition-colors";
export const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";
export const btnPrimary = "text-[12.5px] font-bold text-white bg-primary px-4 min-h-[40px] rounded-xl cursor-pointer disabled:opacity-50";
export const btnGhost = "text-[12.5px] font-bold text-ink-soft bg-slate-100 px-4 min-h-[40px] rounded-xl cursor-pointer disabled:opacity-50";
export const btnDanger = "text-[12.5px] font-bold text-danger bg-danger-soft px-4 min-h-[40px] rounded-xl cursor-pointer disabled:opacity-50";

export const errMsg = (e: unknown, fallback = "عملیات با خطا مواجه شد") => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint ? <div className="text-[11px] text-muted mt-1">{hint}</div> : null}
    </div>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; badge?: number }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx("shrink-0 text-[12.5px] font-bold px-3.5 min-h-[40px] rounded-[10px] cursor-pointer", value === t.id ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}
        >
          {t.label}
          {t.badge ? <span className="ms-1.5 inline-block min-w-[18px] px-1 rounded-full bg-danger text-white text-[10px]">{toPersianDigits(t.badge)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const levelTone: Record<AgentLevel, Tone> = { A_PLUS: "primary", A: "accent", B: "neutral" };
export const statusTone: Record<AgentMembershipStatus, Tone> = { ACTIVE: "success", PENDING: "warning", SUSPENDED: "danger", ENDED: "neutral" };
export const stageTone: Record<AgentFunnelStage, Tone> = { LEAD: "neutral", REGISTERED: "accent", TRIAL: "warning", PAID: "success", RENEWED: "primary", LOST: "danger" };

export const LevelBadge = ({ level }: { level: AgentLevel }) => <Badge tone={levelTone[level]}>{AGENT_LEVEL_LABELS[level]}</Badge>;
export const StatusBadge = ({ status }: { status: AgentMembershipStatus }) => <Badge tone={statusTone[status]}>{AGENT_STATUS_LABELS[status]}</Badge>;
export const StageBadge = ({ stage }: { stage: AgentFunnelStage }) => <Badge tone={stageTone[stage]}>{AGENT_STAGE_LABELS[stage]}</Badge>;

export const fmtDate = (d: string | null | undefined) => (d ? formatJalaliDate(d) : "—");
export const fmtMoney = (n: number) => formatMoney(n);
export const fa = (n: number | string) => toPersianDigits(n);

export function Loading({ rows }: { rows?: unknown[] | null }) {
  return <div className="py-8 text-center text-muted text-sm">{rows === null || rows === undefined ? "در حال بارگذاری..." : "موردی یافت نشد"}</div>;
}

export function CopyButton({ text, label = "کپی" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 min-h-[32px] rounded-lg cursor-pointer"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "کپی شد" : label}
    </button>
  );
}

/** ادمین/نماینده: تغییر شبا یا شماره با کد پیامکی. request/confirm از بیرون تزریق می‌شود. */
export function SensitiveChange({
  kind,
  request,
  confirm,
  onDone,
}: {
  kind: "SHEBA" | "PHONE";
  request: (kind: "SHEBA" | "PHONE", value: string) => Promise<{ changeId: string; sentTo: string; devCode?: string }>;
  confirm: (changeId: string, code: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<{ changeId: string; sentTo: string; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isSheba = kind === "SHEBA";

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      setPending(await request(kind, value.trim()));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      await confirm(pending.changeId, code.trim());
      setPending(null);
      setValue("");
      setCode("");
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {!pending ? (
        <>
          <input value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" inputMode={isSheba ? "text" : "tel"} className={inputClass} placeholder={isSheba ? "IR…" : "09123456789"} />
          <div className="text-[11px] text-muted">{isSheba ? "کد تأیید به شماره‌ی ثبت‌شده‌ی نماینده پیامک می‌شود." : "کد تأیید به شماره‌ی جدید پیامک می‌شود."}</div>
          <button className={btnPrimary} disabled={busy || !value.trim()} onClick={send}>
            {busy ? "در حال ارسال..." : "ارسال کد تأیید"}
          </button>
        </>
      ) : (
        <>
          <div className="text-[12px] text-ink-soft">کد ۶ رقمی به {fa(pending.sentTo)} ارسال شد. {pending.devCode ? `(توسعه: ${pending.devCode})` : null}</div>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} dir="ltr" inputMode="numeric" className={inputClass} placeholder="------" />
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? "در حال بررسی..." : "تأیید و ثبت"}
            </button>
            <button className={btnGhost} onClick={() => setPending(null)}>
              انصراف
            </button>
          </div>
        </>
      )}
      {err ? <div className="text-[12px] text-danger">{err}</div> : null}
    </div>
  );
}
