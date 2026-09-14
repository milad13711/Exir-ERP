"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { toPersianDigits, formatToman } from "@/lib/persian";
import { fetchJobPosting, fetchPostingReport, closeJobPosting, type JobPosting, type JobApplicant, type RecruitmentPostingReport, type ApplicantStage } from "@/lib/api";

const STAGE_LABELS: Record<ApplicantStage, string> = {
  NEW: "جدید",
  INTERVIEW_SCHEDULED: "مصاحبه زمان‌بندی‌شده",
  INTERVIEWED: "مصاحبه‌شده",
  SPECIALIST_APPROVED: "تأیید کارشناس",
  SPECIALIST_REJECTED: "رد کارشناس",
  MANAGEMENT_APPROVED: "تأیید مدیریت",
  MANAGEMENT_REJECTED: "رد مدیریت",
  HIRED: "جذب‌شده",
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  INTERN: "کارآموزی",
  PROJECT_BASED: "پروژه‌ای",
  PART_TIME: "پاره‌وقت",
  FULL_TIME: "تمام‌وقت",
};

export function PostingDetailModal({
  id,
  onClose,
  onChanged,
  onOpenApplicant,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenApplicant: (applicantId: string) => void;
}) {
  const [posting, setPosting] = useState<(JobPosting & { applicants: JobApplicant[] }) | null>(null);
  const [report, setReport] = useState<RecruitmentPostingReport | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetchJobPosting(id).then(setPosting);
    fetchPostingReport(id).then(setReport).catch(() => setReport(null));
  }
  useEffect(reload, [id]);

  async function handleClose() {
    if (!confirm("این آگهی بسته شود؟ دیگر متقاضی جدیدی نمی‌توان برایش ثبت کرد.")) return;
    setBusy(true);
    try {
      await closeJobPosting(id);
      reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!posting) {
    return (
      <Modal title="جزئیات آگهی" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={posting.title} onClose={onClose} width="max-w-[600px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-[12.5px] text-muted">
            {posting.jobField} · {EMPLOYMENT_TYPE_LABELS[posting.employmentType]} · ظرفیت {toPersianDigits(posting.capacity)}
          </div>
          <Badge tone={posting.status === "OPEN" ? "success" : "neutral"}>{posting.status === "OPEN" ? "باز" : "بسته‌شده"}</Badge>
        </div>

        {(posting.publishChannel || posting.publishBudget) && (
          <div className="text-[12px] text-muted">
            {posting.publishChannel ? `کانال: ${posting.publishChannel}` : ""}
            {posting.publishBudget ? ` · بودجه: ${formatToman(posting.publishBudget)}` : ""}
          </div>
        )}

        {report && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 border border-border rounded-xl py-3">
              <div className="text-[16px] font-extrabold">{toPersianDigits(report.totalApplicants)}</div>
              <div className="text-[11px] text-muted mt-0.5">کل متقاضیان</div>
            </div>
            <div className="bg-slate-50 border border-border rounded-xl py-3">
              <div className="text-[16px] font-extrabold text-success">{toPersianDigits(report.hired)}</div>
              <div className="text-[11px] text-muted mt-0.5">جذب‌شده</div>
            </div>
            <div className="bg-slate-50 border border-border rounded-xl py-3">
              <div className="text-[16px] font-extrabold">{toPersianDigits(report.remainingCapacity)}</div>
              <div className="text-[11px] text-muted mt-0.5">ظرفیت باقی‌مانده</div>
            </div>
          </div>
        )}

        <div>
          <div className="text-[12px] font-semibold text-ink-soft mb-2">متقاضیان ({toPersianDigits(posting.applicants.length)})</div>
          <div className="flex flex-col gap-1.5">
            {posting.applicants.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-3">متقاضی‌ای ثبت نشده است</div>
            ) : (
              posting.applicants.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onOpenApplicant(a.id)}
                  className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-lg px-3 py-2 text-right cursor-pointer hover:bg-slate-100"
                >
                  <span className="text-[12.5px] font-semibold flex-1 truncate">{a.name}</span>
                  <Badge tone="neutral">{STAGE_LABELS[a.stage]}</Badge>
                </button>
              ))
            )}
          </div>
        </div>

        {posting.status === "OPEN" && (
          <button onClick={handleClose} disabled={busy} className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-danger-soft text-danger disabled:opacity-50 cursor-pointer">
            بستن آگهی
          </button>
        )}
      </div>
    </Modal>
  );
}
