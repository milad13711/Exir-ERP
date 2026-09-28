"use client";

import { useState } from "react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { PhoneIcon, ChevronDownIcon } from "@/components/icons";
import { formatJalaliDate, formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import {
  sendOverdueInvoiceReminderSms,
  createInvoiceFollowUp,
  fetchInvoiceFollowUps,
  ApiError,
  type DashboardSummary,
  type InvoiceFollowUp,
} from "@/lib/api";

type DueInvoice = DashboardSummary["dueOrOverdueInvoices"][number];

/** «۳ روز مانده تا سررسید» / «۳ روز معوق» — بر اساس علامت daysDiff. */
function dueBadge(daysDiff: number): { tone: "danger" | "warning"; label: string } {
  if (daysDiff < 0) {
    return { tone: "danger", label: `${toPersianDigits(Math.abs(daysDiff))} روز معوق` };
  }
  if (daysDiff === 0) return { tone: "warning", label: "امروز سررسید می‌شود" };
  return { tone: "warning", label: `${toPersianDigits(daysDiff)} روز مانده تا سررسید` };
}

export function DueOrOverdueInvoicesWidget({ items }: { items: DueInvoice[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      {items.map((inv, i) => (
        <InvoiceRow
          key={inv.id}
          invoice={inv}
          isLast={i === items.length - 1}
          expanded={expandedId === inv.id}
          onToggle={() => setExpandedId((cur) => (cur === inv.id ? null : inv.id))}
        />
      ))}
    </div>
  );
}

function InvoiceRow({
  invoice,
  isLast,
  expanded,
  onToggle,
}: {
  invoice: DueInvoice;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = dueBadge(invoice.daysDiff);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);

  async function handleRemindSms() {
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const result = await sendOverdueInvoiceReminderSms(invoice.id);
      setSmsMsg(result.success ? "پیامک ارسال شد" : (result.error ?? "ارسال پیامک ناموفق بود"));
    } catch (err) {
      setSmsMsg(err instanceof ApiError ? err.message : "ارسال پیامک ناموفق بود");
    } finally {
      setSmsBusy(false);
    }
  }

  return (
    <div className={clsx("py-2.5", !isLast && "border-b border-border")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold truncate">
            فاکتور #{toPersianDigits(invoice.invoiceNo)} — {invoice.contact.company || invoice.contact.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-muted">سررسید: {formatJalaliDate(invoice.dueAt)}</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[12.5px] font-extrabold whitespace-nowrap">{formatToman(invoice.total - invoice.paidAmount)}</div>
          <button
            type="button"
            onClick={onToggle}
            className="w-6.5 h-6.5 rounded-full flex items-center justify-center text-muted hover:bg-slate-50"
            aria-label="جزئیات و پیگیری"
          >
            <ChevronDownIcon className={clsx("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-2.5 mr-1 pr-2.5 border-r-2 border-border flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={smsBusy || !invoice.contact.phone}
              onClick={handleRemindSms}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-primary-soft text-primary disabled:opacity-50"
              title={invoice.contact.phone ? undefined : "مشتری شماره تماس ثبت‌شده ندارد"}
            >
              <PhoneIcon className="w-3.5 h-3.5" />
              {smsBusy ? "در حال ارسال..." : "یادآوری پیامکی"}
            </button>
            {smsMsg ? <span className="text-[11.5px] text-muted">{smsMsg}</span> : null}
          </div>
          <FollowUpSection invoiceId={invoice.id} />
        </div>
      ) : null}
    </div>
  );
}

function FollowUpSection({ invoiceId }: { invoiceId: string }) {
  const [history, setHistory] = useState<InvoiceFollowUp[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const rows = await fetchInvoiceFollowUps(invoiceId);
      setHistory(rows);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleSave() {
    if (!note.trim()) {
      setError("توضیح پیگیری را بنویسید");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createInvoiceFollowUp(invoiceId, { note: note.trim(), outcome: outcome.trim() || undefined });
      setHistory((prev) => [created, ...(prev ?? [])]);
      setNote("");
      setOutcome("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت پیگیری ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-[12px] font-semibold text-primary"
        >
          + ثبت پیگیری تلفنی
        </button>
        <button
          type="button"
          onClick={() => (history === null ? loadHistory() : setHistory(null))}
          className="text-[12px] font-semibold text-muted"
        >
          {history === null ? (loadingHistory ? "در حال بارگذاری..." : "مشاهده‌ی تاریخچه‌ی پیگیری") : "بستن تاریخچه"}
        </button>
      </div>

      {showForm ? (
        <div className="flex flex-col gap-2 bg-slate-50 border border-border rounded-lg p-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="چه گفته/قول داده شد؟ مثلاً: با مشتری تماس گرفته شد، گفت پنج‌شنبه پرداخت می‌کند"
            rows={2}
            className="text-[12.5px] rounded-lg border border-border px-2.5 py-2 resize-none"
          />
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="واکنش مشتری (اختیاری) — مثلاً: پاسخ نداد"
            className="text-[12.5px] rounded-lg border border-border px-2.5 py-2"
          />
          {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50"
            >
              {saving ? "در حال ثبت..." : "ثبت پیگیری"}
            </button>
          </div>
        </div>
      ) : null}

      {history !== null ? (
        history.length === 0 ? (
          <div className="text-[11.5px] text-muted py-1">پیگیری‌ای ثبت نشده است</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((f) => (
              <div key={f.id} className="text-[11.5px] bg-slate-50 border border-border rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold">{f.followedUpBy?.name ?? "—"}</span>
                  <span className="text-muted">{formatJalaliDateTime(f.createdAt)}</span>
                </div>
                <div>{f.note}</div>
                {f.outcome ? <div className="text-muted mt-1">واکنش مشتری: {f.outcome}</div> : null}
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
