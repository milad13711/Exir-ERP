"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { copyToClipboard } from "@/lib/clipboard";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  fetchFormSubmissionDetail,
  markFormSubmissionViewed,
  updateFormSubmission,
  type FormFieldType,
  type FormSubmissionDetail,
  type FormSubmissionStatus,
} from "@/lib/api";
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TONES, isHttpUrl, isImageUrl } from "./forms-ui";

type Row = { key: string; label: string; type: FormFieldType; text: string | null; options: string[] };

/** هر فیلد فرم یک ردیف — حتی اگر بی‌پاسخ مانده باشد، تا بازبینی کامل و قابل مقایسه باشد. */
function buildRows(s: FormSubmissionDetail): Row[] {
  const byField = new Map(s.answers.map((a) => [a.fieldId, a]));
  const rows: Row[] = s.form.fields.map((f) => {
    const a = byField.get(f.id);
    return { key: f.id, label: f.label, type: f.type, text: a?.valueText ?? null, options: a?.valueOptions ?? [] };
  });
  // پاسخ فیلدی که بعداً از فرم حذف شده (نباید رخ دهد چون پاسخ‌ها cascade می‌شوند) — محض احتیاط
  for (const a of s.answers) if (!s.form.fields.some((f) => f.id === a.fieldId)) rows.push({ key: a.id, label: a.field.label, type: a.field.type, text: a.valueText, options: a.valueOptions });
  return rows;
}

function rowAsText(r: Row): string {
  return r.options.length > 0 ? r.options.join("، ") : (r.text ?? "");
}

function ValueView({ row }: { row: Row }) {
  if (row.options.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {row.options.map((o) => (
          <span key={o} className="text-[12px] font-semibold bg-primary-soft text-primary rounded-full px-2.5 py-0.5">
            {o}
          </span>
        ))}
      </div>
    );
  }
  const text = row.text?.trim();
  if (!text) return <span className="text-muted text-[12.5px]">بدون پاسخ</span>;
  if (isImageUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer nofollow">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={text} alt={row.label} loading="lazy" className="max-h-40 rounded-lg border border-border" />
      </a>
    );
  }
  if (isHttpUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-primary text-[13px] font-semibold break-all underline">
        {text}
      </a>
    );
  }
  if (row.type === "EMAIL") return <a href={`mailto:${text}`} dir="ltr" className="text-primary text-[13px] font-semibold">{text}</a>;
  if (row.type === "PHONE") return <a href={`tel:${text}`} dir="ltr" className="text-primary text-[13px] font-semibold inline-block">{toPersianDigits(text)}</a>;
  if (row.type === "RATING") return <span className="text-[13px] font-bold">{"★".repeat(Number(text) || 0)}<span className="text-slate-300">{"★".repeat(Math.max(0, 5 - (Number(text) || 0)))}</span> <span className="text-muted font-normal">({toPersianDigits(text)} از ۵)</span></span>;
  return <div className="text-[13px] font-semibold whitespace-pre-wrap break-words leading-relaxed">{text}</div>;
}

export function SubmissionDetailModal({
  submissionId,
  onClose,
  onChanged,
}: {
  submissionId: string;
  onClose: () => void;
  /** بعد از دیده‌شدن یا تغییر وضعیت — برای تازه‌سازی فهرست/ویجت */
  onChanged: () => void;
}) {
  const [data, setData] = useState<FormSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchFormSubmissionDetail(submissionId);
        if (cancelled) return;
        setData(detail);
        setNote(detail.internalNote ?? "");
        // باز شدن = دیده شد (اگر هنوز جدید است)
        if (detail.status === "NEW") {
          const r = await markFormSubmissionViewed(submissionId).catch(() => null);
          if (!cancelled && r) {
            setData((d) => (d ? { ...d, status: r.status } : d));
            if (r.changed) onChanged();
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "بارگذاری پاسخ ناموفق بود");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);

  async function changeStatus(status: FormSubmissionStatus) {
    if (!data || data.status === status) return;
    setSaving(true);
    setError(null);
    try {
      await updateFormSubmission(submissionId, { status });
      setData({ ...data, status });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تغییر وضعیت ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError(null);
    try {
      await updateFormSubmission(submissionId, { internalNote: note });
      setData((d) => (d ? { ...d, internalNote: note.trim() || null } : d));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره‌ی یادداشت ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function copyAsText() {
    if (!data) return;
    const lines = [
      `${data.form.title} — ${formatJalaliDateTime(data.submittedAt)}`,
      ...(data.respondentName ? [`نام: ${data.respondentName}`] : []),
      ...(data.respondentPhone ? [`موبایل: ${data.respondentPhone}`] : []),
      ...rows.map((r) => `${r.label}: ${rowAsText(r) || "—"}`),
    ];
    const ok = await copyToClipboard(lines.join("\n"));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  }

  const utm = data?.sourceMeta?.utm ? Object.entries(data.sourceMeta.utm) : [];

  return (
    <Modal title={data ? `پاسخ «${data.form.title}»` : "جزئیات پاسخ"} onClose={onClose} width="max-w-[560px]">
      {!data ? (
        <div className="text-center text-sm text-muted py-8">{error ?? "در حال بارگذاری..."}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge tone={SUBMISSION_STATUS_TONES[data.status]}>{SUBMISSION_STATUS_LABELS[data.status]}</Badge>
              <span className="text-[12px] text-muted">{formatJalaliDateTime(data.submittedAt)}</span>
            </div>
            <button onClick={copyAsText} className="text-[11.5px] font-bold text-primary cursor-pointer">
              {copied ? "کپی شد" : "کپی به‌صورت متن"}
            </button>
          </div>

          {/* هر فیلد یک ردیف: برچسب (کم‌رنگ) → مقدار */}
          <div className="border border-border rounded-xl divide-y divide-border overflow-hidden" data-testid="submission-rows">
            {(data.respondentName || data.respondentPhone) && (
              <div className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5 items-start">
                <div className="text-[12px] text-muted pt-0.5">پاسخ‌دهنده</div>
                <div className="text-[13px] font-semibold">
                  {data.respondentName}
                  {data.respondentPhone && (
                    <a href={`tel:${data.respondentPhone}`} dir="ltr" className="text-primary mr-2 inline-block">
                      {toPersianDigits(data.respondentPhone)}
                    </a>
                  )}
                </div>
              </div>
            )}
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5 items-start">
                <div className="text-[12px] text-muted pt-0.5 leading-snug">{r.label}</div>
                <div className="min-w-0">
                  <ValueView row={r} />
                </div>
              </div>
            ))}
            {data.scorePercent != null && (
              <div className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5 items-start">
                <div className="text-[12px] text-muted pt-0.5">نمره</div>
                <div className={clsx("text-[13px] font-extrabold", data.passed ? "text-success" : "text-danger")}>
                  {toPersianDigits(data.scorePercent)}٪ — {data.passed ? "قبول" : "ناموفق"}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] font-bold text-ink-soft mb-1.5">وضعیت</div>
            <div className="flex gap-1.5 flex-wrap">
              {(["NEW", "IN_REVIEW", "DONE"] as FormSubmissionStatus[]).map((st) => (
                <button
                  key={st}
                  disabled={saving}
                  onClick={() => changeStatus(st)}
                  className={clsx(
                    "text-[12px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-50",
                    data.status === st ? "bg-primary text-white border-primary" : "border-border text-ink-soft hover:bg-slate-50",
                  )}
                >
                  {SUBMISSION_STATUS_LABELS[st]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[12px] font-bold text-ink-soft mb-1.5">یادداشت داخلی (فقط برای تیم)</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5 focus:border-primary"
            />
            {note.trim() !== (data.internalNote ?? "") && (
              <button onClick={saveNote} disabled={saving} className="mt-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg bg-primary text-white cursor-pointer disabled:opacity-50">
                ذخیره‌ی یادداشت
              </button>
            )}
          </div>

          <div className="text-[11.5px] text-muted flex flex-col gap-1 border-t border-border pt-3">
            {data.sourceUrl && (
              <div>
                صفحه‌ی ثبت:{" "}
                <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-primary break-all">
                  {data.sourceUrl}
                </a>
              </div>
            )}
            {data.sourceMeta?.referrer && <div dir="ltr" className="text-right break-all">ارجاع‌دهنده: {data.sourceMeta.referrer}</div>}
            {utm.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {utm.map(([k, v]) => (
                  <span key={k} dir="ltr" className="bg-slate-100 rounded px-1.5 py-0.5">
                    {k}={v}
                  </span>
                ))}
              </div>
            )}
            {data.ipMasked && <div dir="ltr" className="text-right">IP: {data.ipMasked}</div>}
            {data.viewedAt && (
              <div>
                اولین مشاهده: {formatJalaliDateTime(data.viewedAt)}
                {data.viewedByName ? ` — ${data.viewedByName}` : ""}
              </div>
            )}
          </div>
          {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
