"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api";
import { formatJalaliDate, formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  CONF_LABELS, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONES, TYPE_LABELS, fetchPeople,
  type Confidentiality, type LetterListItem, type LetterStatus, type LetterType, type Person, type Priority,
} from "@/lib/correspondence-api";

export const INPUT = "w-full text-[16px] sm:text-[13px] outline-none bg-white border border-border rounded-xl px-3 py-2.5 min-h-[40px]";
export const LABEL = "text-[11.5px] text-muted mb-1 block";
export const BTN_PRIMARY = "px-4 py-2.5 min-h-[40px] rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5";
export const BTN_SOFT = "px-4 py-2.5 min-h-[40px] rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5";
export const BTN_DANGER = "px-4 py-2.5 min-h-[40px] rounded-xl bg-danger-soft text-danger text-[12.5px] font-bold cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5";

export const errText = (e: unknown, fallback = "عملیات ناموفق بود"): string =>
  e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback;

export const fa = (v: string | number | null | undefined): string => (v === null || v === undefined || v === "" ? "—" : toPersianDigits(v));
export const dateFa = (d: string | null | undefined): string => (d ? formatJalaliDate(d) : "—");
export const dateTimeFa = (d: string | null | undefined): string => (d ? formatJalaliDateTime(d) : "—");

export function StatusBadge({ status }: { status: LetterStatus }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</Badge>;
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "NORMAL") return null;
  return <Badge tone={priority === "IMMEDIATE" ? "danger" : "warning"}>{PRIORITY_LABELS[priority]}</Badge>;
}
export function ConfBadge({ level }: { level: Confidentiality }) {
  if (level === "NORMAL") return null;
  return <Badge tone="danger">{CONF_LABELS[level]}</Badge>;
}
export function TypeBadge({ type }: { type: LetterType }) {
  return <Badge tone={type === "INCOMING" ? "accent" : type === "OUTGOING" ? "primary" : "neutral"}>{TYPE_LABELS[type]}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-[13px] text-muted py-10 px-4">{children}</div>;
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-danger-soft text-danger text-[12.5px] px-3 py-2.5" role="alert">{children}</div>;
}
export function Loading() {
  return <div className="text-center text-[13px] text-muted py-10" aria-busy>در حال بارگذاری…</div>;
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("bg-surface border border-border rounded-2xl p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-[13.5px] font-extrabold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** ردیف فهرست نامه (موبایل: کارت؛ دسکتاپ: همان کارت فشرده). موضوع نامه‌های محرمانه فقط برای کسانی که سرور اجازه داده می‌آید. */
export function LetterRow({ l, selected, onSelect }: { l: LetterListItem; selected?: boolean; onSelect?: (checked: boolean) => void }) {
  const incoming = l.type === "INCOMING";
  const overdue = l.responseDueAt && new Date(l.responseDueAt) < new Date() && ["REGISTERED", "REFERRED", "IN_PROGRESS"].includes(l.status);
  return (
    <div className="flex items-start gap-2 border-b border-border last:border-0">
      {onSelect ? (
        <label className="pt-4 ps-3 shrink-0 cursor-pointer" aria-label="انتخاب">
          <input type="checkbox" className="w-5 h-5" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} />
        </label>
      ) : null}
      <Link href={`/correspondence/${l.id}`} className="flex-1 min-w-0 px-4 py-3 hover:bg-primary-soft/40 block">
        <div className="flex items-center gap-1.5 flex-wrap">
          <TypeBadge type={l.type} />
          <StatusBadge status={l.status} />
          <PriorityBadge priority={l.priority} />
          <ConfBadge level={l.confidentiality} />
          {l.archivedAt ? <Badge tone="neutral">بایگانی</Badge> : null}
          {overdue ? <Badge tone="danger">معوق</Badge> : null}
          <span dir="ltr" className="ms-auto text-[11.5px] font-bold text-ink-soft">{l.letterNumber ? toPersianDigits(l.letterNumber) : "بدون شماره"}</span>
        </div>
        <div className="mt-1.5 text-[13.5px] font-bold break-words">{l.subject || "(بدون موضوع)"}</div>
        <div className="mt-1 text-[11.5px] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
          {incoming ? (
            <>
              <span>فرستنده: {[l.senderOrgName, l.senderName].filter(Boolean).join(" - ") || "—"}</span>
              {l.externalNumber ? <span>شماره‌ی اصلی: <bdi>{toPersianDigits(l.externalNumber)}</bdi></span> : null}
              {l.externalDate ? <span>تاریخ اصلی: {dateFa(l.externalDate)}</span> : null}
            </>
          ) : (
            <span>گیرنده: {l.recipientsText || "—"}</span>
          )}
          <span>تاریخ: {dateFa(l.letterDate ?? l.createdAt)}</span>
          {l.category ? <span>دسته: {l.category.name}</span> : null}
          {l.responseDueAt ? <span>مهلت پاسخ: {dateFa(l.responseDueAt)}</span> : null}
          {l.referral ? <span className="text-primary font-semibold">ارجاع از {l.referral.fromName ?? "—"}{l.referral.dueAt ? ` · مهلت ${dateFa(l.referral.dueAt)}` : ""}</span> : null}
        </div>
        {l.referral?.instruction ? <div className="mt-1 text-[12px] text-ink-soft break-words">دستور: {l.referral.instruction}</div> : null}
      </Link>
    </div>
  );
}

/** پنجره‌ی پایین‌نشین در موبایل، مودال معمولی در دسکتاپ. */
export function Sheet({ title, onClose, children, width = "max-w-[520px]" }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return <Modal title={title} onClose={onClose} width={width}>{children}</Modal>;
}

let peopleCache: Promise<Person[]> | null = null;
export function usePeople(): Person[] | null {
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    peopleCache ??= fetchPeople().catch((e) => {
      peopleCache = null;
      throw e;
    });
    let alive = true;
    peopleCache.then((p) => alive && setPeople(p)).catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, []);
  return people;
}

/** انتخاب یک یا چند کاربر با جست‌وجو. کاربران بدون دسترسی به ماژول غیرفعال نمایش داده می‌شوند. */
export function PeoplePicker({
  value, onChange, multiple = false, excludeIds = [], placeholder = "جست‌وجوی همکار…",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  excludeIds?: string[];
  placeholder?: string;
}) {
  const people = usePeople();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim();
    return (people ?? []).filter((p) => !excludeIds.includes(p.id) && (!t || p.name.includes(t) || (p.title ?? "").includes(t))).slice(0, 60);
  }, [people, q, excludeIds]);
  const selected = (people ?? []).filter((p) => value.includes(p.id));
  return (
    <div className="space-y-2">
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <button key={p.id} type="button" onClick={() => onChange(value.filter((v) => v !== p.id))} className="text-[12px] bg-primary-soft text-primary rounded-lg px-2.5 py-1.5 min-h-[36px] cursor-pointer">
              {p.name} ×
            </button>
          ))}
        </div>
      ) : null}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={INPUT} />
      <div className="max-h-[200px] overflow-y-auto border border-border rounded-xl divide-y divide-border">
        {people === null ? <Loading /> : list.length === 0 ? <Empty>موردی یافت نشد</Empty> : list.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.hasAccess}
              onClick={() => onChange(multiple ? (on ? value.filter((v) => v !== p.id) : [...value, p.id]) : [p.id])}
              className={clsx("w-full text-start px-3 py-2.5 min-h-[44px] text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed", on ? "bg-primary-soft" : "hover:bg-slate-50")}
            >
              <span className="font-semibold">{p.name}</span>
              {p.title ? <span className="text-muted text-[11.5px]"> · {p.title}</span> : null}
              {!p.hasAccess ? <span className="text-danger text-[11px]"> · بدون دسترسی به مکاتبات</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
