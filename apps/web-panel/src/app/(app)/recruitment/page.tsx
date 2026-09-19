"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { BriefcaseIcon, PlusIcon, SearchIcon, CalendarIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import {
  fetchJobPostings,
  fetchApplicants,
  fetchInterviews,
  type JobPosting,
  type JobPostingStatus,
  type JobApplicant,
  type ApplicantStage,
  type JobInterview,
} from "@/lib/api";
import { NewPostingModal } from "@/components/recruitment/NewPostingModal";
import { PostingDetailModal } from "@/components/recruitment/PostingDetailModal";
import { ApplicantDetailModal } from "@/components/recruitment/ApplicantDetailModal";
import { RecruitmentSettingsTab } from "@/components/recruitment/RecruitmentSettingsTab";

type Tab = "postings" | "applicants" | "interviews" | "settings";

const POSTING_STATUS_LABELS: Record<JobPostingStatus, string> = { OPEN: "باز", CLOSED: "بسته‌شده" };
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  INTERN: "کارآموزی",
  PROJECT_BASED: "پروژه‌ای",
  PART_TIME: "پاره‌وقت",
  FULL_TIME: "تمام‌وقت",
};
const STAGE_LABELS: Record<ApplicantStage, string> = {
  NEW: "جدید",
  INTERVIEW_SCHEDULED: "مصاحبه زمان‌بندی‌شده",
  INTERVIEWED: "مصاحبه‌شده",
  SPECIALIST_APPROVED: "تأیید کارشناس",
  SPECIALIST_REJECTED: "رد کارشناس",
  OFFER_SENT: "شرایط همکاری ارسال‌شده",
  OFFER_DECLINED: "شرایط همکاری رد شد",
  AWAITING_MANAGEMENT: "منتظر تأیید نهایی مدیر",
  MANAGEMENT_APPROVED: "تأیید مدیریت",
  MANAGEMENT_REJECTED: "رد مدیریت",
  HIRED: "جذب‌شده",
};
const STAGE_TONES: Record<ApplicantStage, "neutral" | "success" | "warning" | "danger" | "primary"> = {
  NEW: "neutral",
  INTERVIEW_SCHEDULED: "primary",
  INTERVIEWED: "primary",
  SPECIALIST_APPROVED: "warning",
  SPECIALIST_REJECTED: "danger",
  OFFER_SENT: "primary",
  OFFER_DECLINED: "danger",
  AWAITING_MANAGEMENT: "warning",
  MANAGEMENT_APPROVED: "success",
  MANAGEMENT_REJECTED: "danger",
  HIRED: "success",
};

const TABS: { key: Tab; label: string }[] = [
  { key: "postings", label: "آگهی‌ها" },
  { key: "applicants", label: "متقاضیان" },
  { key: "interviews", label: "مصاحبه‌ها" },
  { key: "settings", label: "تنظیمات" },
];

export default function RecruitmentPage() {
  const [tab, setTab] = useState<Tab>("postings");

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">استخدام و جذب نیرو</h1>
            <ModuleHelp code="recruitment" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">آگهی، رزومه‌ها، مصاحبه، تأیید دومرحله‌ای و شرایط همکاری</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-6 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors cursor-pointer",
              tab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "postings" && <PostingsTab />}
      {tab === "applicants" && <ApplicantsTab />}
      {tab === "interviews" && <InterviewsTab />}
      {tab === "settings" && <RecruitmentSettingsTab />}
    </div>
  );
}

function PostingsTab() {
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<"همه" | JobPostingStatus>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openApplicantId, setOpenApplicantId] = useState<string | null>(null);

  function reload() {
    fetchJobPostings(statusFilter === "همه" ? undefined : statusFilter)
      .then(setPostings)
      .catch(() => setPostings([]));
  }
  useEffect(reload, [statusFilter]);

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          {(["همه", "OPEN", "CLOSED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : POSTING_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          آگهی جدید
        </button>
      </div>

      <Card className="p-2">
        {postings === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : postings.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">آگهی‌ای یافت نشد</div>
        ) : (
          postings.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setDetailId(p.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < postings.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <BriefcaseIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{p.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {EMPLOYMENT_TYPE_LABELS[p.employmentType]} · ظرفیت {toPersianDigits(p.capacity)} · {toPersianDigits(p._count?.applicants ?? 0)} متقاضی
                </div>
              </div>
              <Badge tone={p.status === "OPEN" ? "success" : "neutral"}>{POSTING_STATUS_LABELS[p.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {newOpen && (
        <NewPostingModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            reload();
            setDetailId(id);
          }}
        />
      )}
      {detailId && (
        <PostingDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} onOpenApplicant={setOpenApplicantId} />
      )}
      {openApplicantId && (
        <ApplicantDetailModal id={openApplicantId} onClose={() => setOpenApplicantId(null)} onChanged={reload} />
      )}
    </>
  );
}

function ApplicantsTab() {
  const [applicants, setApplicants] = useState<JobApplicant[] | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"همه" | ApplicantStage>("همه");
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    fetchApplicants({ search: search || undefined, stage: stageFilter === "همه" ? undefined : stageFilter })
      .then(setApplicants)
      .catch(() => setApplicants([]));
  }
  useEffect(reload, [search, stageFilter]);

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative max-w-[280px] flex-1 min-w-[200px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام یا موبایل..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as "همه" | ApplicantStage)}
          className="text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2.5 outline-none focus:border-primary"
        >
          <option value="همه">همه‌ی مراحل</option>
          {Object.entries(STAGE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Card className="p-2">
        {applicants === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : applicants.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">متقاضی‌ای یافت نشد</div>
        ) : (
          applicants.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setDetailId(a.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < applicants.length - 1 && "border-b border-border",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{a.name}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {a.jobPosting.title} · {a.educationField ?? "—"}
                </div>
              </div>
              <Badge tone={STAGE_TONES[a.stage]}>{STAGE_LABELS[a.stage]}</Badge>
            </button>
          ))
        )}
      </Card>

      {detailId && <ApplicantDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}

function InterviewsTab() {
  const [interviews, setInterviews] = useState<JobInterview[] | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    fetchInterviews().then(setInterviews).catch(() => setInterviews([]));
  }
  useEffect(reload, []);

  return (
    <>
      <Card className="p-2">
        {interviews === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : interviews.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">مصاحبه‌ای زمان‌بندی نشده است</div>
        ) : (
          interviews.map((iv, i) => (
            <button
              key={iv.id}
              onClick={() => setDetailId(iv.applicantId)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < interviews.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <CalendarIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{iv.applicant?.name ?? "—"}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {formatJalaliDateTime(iv.scheduledAt)} · {toPersianDigits(iv.durationMinutes)} دقیقه
                  {iv.interviewer ? ` · مصاحبه‌گیرنده: ${iv.interviewer.name}` : ""}
                </div>
              </div>
              <Badge tone={iv.status === "DONE" ? "success" : iv.status === "CANCELLED" || iv.status === "NO_SHOW" ? "danger" : "neutral"}>
                {iv.status === "SCHEDULED" ? "زمان‌بندی‌شده" : iv.status === "DONE" ? "برگزارشده" : iv.status === "CANCELLED" ? "لغوشده" : "عدم حضور"}
              </Badge>
            </button>
          ))
        )}
      </Card>

      {detailId && <ApplicantDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}
