"use client";

import { useEffect, useState } from "react";
import { deleteJobApplicant } from "@/lib/api";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { copyToClipboard } from "@/lib/clipboard";
import { useWorkspace } from "@/lib/workspace-context";
import { toPersianDigits, formatJalaliDateTime, formatJalaliDate, formatToman } from "@/lib/persian";
import {
  fetchApplicant,
  specialistDecision,
  managementDecision,
  hireApplicant,
  scheduleInterview,
  recordInterviewReport,
  createOrUpdateOffer,
  sendOffer,
  fetchDepartments,
  type Department,
  openOfferPdf,
  fetchUsers,
  fetchRoles,
  fetchGeneralSettings,
  ApiError,
  type JobApplicant,
  type ApplicantStage,
  type TenantUser,
  type TenantRoleOption,
} from "@/lib/api";

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

export function ApplicantDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
  const [applicant, setApplicant] = useState<JobApplicant | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchApplicant(id).then(setApplicant);
  }
  useEffect(reload, [id]);
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  function afterAction() {
    reload();
    onChanged();
  }

  if (!applicant) {
    return (
      <Modal title="جزئیات متقاضی" onClose={onClose}>
        <div className="text-center text-muted py-6">در حال بارگذاری...</div>
      </Modal>
    );
  }

  return (
    <Modal title={applicant.name} onClose={onClose} width="max-w-[620px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-[12.5px] text-muted">
            {applicant.jobPosting.title} · {applicant.phone}
          </div>
          <Badge tone={STAGE_TONES[applicant.stage]}>{STAGE_LABELS[applicant.stage]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <span className="text-muted">رشته‌ی تحصیلی: </span>
            {applicant.educationField ?? "—"}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-muted">تخصص‌ها: </span>
            {applicant.skillTags.length > 0 ? applicant.skillTags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>) : "—"}
          </div>
        </div>

        {applicant.resumeFile && (
          <a href={applicant.resumeFile} target="_blank" rel="noreferrer" className="text-[12.5px] font-bold text-primary">
            مشاهده‌ی رزومه
          </a>
        )}

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        {/* مصاحبه‌ها */}
        <InterviewsSection
          applicant={applicant}
          users={users}
          onScheduled={afterAction}
          onReported={afterAction}
          setBusy={setBusy}
          setError={setError}
          busy={busy}
        />

        {/* تأیید کارشناس */}
        {applicant.stage === "INTERVIEWED" && (
          <DecisionBox
            title="تأیید یا رد اولیه (کارشناس)"
            busy={busy}
            onDecide={async (approved, reason) => {
              setBusy(true);
              setError(null);
              try {
                await specialistDecision(applicant.id, { approved, reason });
                afterAction();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "ثبت تصمیم ناموفق بود");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {(applicant.stage === "SPECIALIST_APPROVED" || applicant.stage === "SPECIALIST_REJECTED" || applicant.stage !== "NEW" && applicant.stage !== "INTERVIEW_SCHEDULED" && applicant.stage !== "INTERVIEWED") && applicant.specialist && (
          <div className="text-[11.5px] text-muted">
            تصمیم کارشناس: {applicant.specialist.name}
            {applicant.specialistDecisionReason ? ` — «${applicant.specialistDecisionReason}»` : ""}
          </div>
        )}

        {applicant.management && (
          <div className="text-[11.5px] text-muted">
            تصمیم مدیریت: {applicant.management.name}
            {applicant.managementDecisionReason ? ` — «${applicant.managementDecisionReason}»` : ""}
          </div>
        )}

        {/* شرایط همکاری — ثبت توسط کارشناس پس از تأیید */}
        {["SPECIALIST_APPROVED", "OFFER_SENT", "OFFER_DECLINED", "AWAITING_MANAGEMENT", "MANAGEMENT_APPROVED", "HIRED"].includes(applicant.stage) && (
          <OfferSection applicant={applicant} onChanged={afterAction} />
        )}

        {/* تأیید نهایی — فقط مدیر */}
        {(applicant.stage === "AWAITING_MANAGEMENT" || applicant.stage === "MANAGEMENT_APPROVED") && applicant.offer?.status === "ACCEPTED" &&
          (isManager ? (
            <HireSection
              applicantId={applicant.id}
              busy={busy}
              onHired={afterAction}
              onReject={async (reason) => {
                setBusy(true);
                setError(null);
                try {
                  await managementDecision(applicant.id, { approved: false, reason });
                  afterAction();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "ثبت تصمیم ناموفق بود");
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <div className="text-[12.5px] text-muted border border-border rounded-xl p-3.5">
              متقاضی شرایط را پذیرفته و امضا کرده است. تأیید نهایی فقط توسط مدیر انجام می‌شود و در کارتابل مدیر قرار گرفته است.
            </div>
          ))}
      </div>
      <DeleteRecordButton confirmText="این متقاضی حذف شود؟" onDelete={() => deleteJobApplicant(id)} onDeleted={() => { onChanged(); onClose(); }} />
    </Modal>
  );
}

function DecisionBox({ title, onDecide, busy }: { title: string; onDecide: (approved: boolean, reason?: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="border border-border rounded-xl p-3.5">
      <div className="text-[12.5px] font-bold mb-2">{title}</div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="دلیل (در صورت رد الزامی است)"
        rows={2}
        className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 mb-2 focus:border-primary resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDecide(true, reason.trim() || undefined)}
          disabled={busy}
          className="flex-1 text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-success-soft text-success disabled:opacity-50 cursor-pointer"
        >
          تأیید
        </button>
        <button
          onClick={() => onDecide(false, reason.trim() || undefined)}
          disabled={busy || !reason.trim()}
          className="flex-1 text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-danger-soft text-danger disabled:opacity-50 cursor-pointer"
        >
          رد
        </button>
      </div>
    </div>
  );
}

function InterviewsSection({
  applicant,
  users,
  onScheduled,
  onReported,
  busy,
  setBusy,
  setError,
}: {
  applicant: JobApplicant;
  users: TenantUser[];
  onScheduled: () => void;
  onReported: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
}) {
  const [scheduling, setScheduling] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("30");
  const [interviewerUserId, setInterviewerUserId] = useState("");
  const [location, setLocation] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!scheduling) return;
    // پیش‌فرض آدرس محل مصاحبه، آدرس ثبت‌شده‌ی شرکت است (Settings → General) — قابل ویرایش برای این مصاحبه.
    fetchGeneralSettings()
      .then((s) => setLocation((prev) => prev || s.address || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduling]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduledAt) return;
    setBusy(true);
    setError(null);
    try {
      await scheduleInterview({
        applicantId: applicant.id,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number(duration) || undefined,
        interviewerUserId: interviewerUserId || undefined,
        location: location.trim() || undefined,
      });
      setScheduling(false);
      setScheduledAt("");
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "زمان‌بندی مصاحبه ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-semibold text-ink-soft">مصاحبه‌ها</div>
        {!scheduling && (
          <button onClick={() => setScheduling(true)} className="text-[11.5px] font-bold text-primary cursor-pointer">
            + زمان‌بندی مصاحبه
          </button>
        )}
      </div>

      {scheduling && (
        <form onSubmit={handleSchedule} className="border border-border rounded-xl p-3 mb-2 flex flex-col gap-2">
          <JalaliDateTimeInput value={scheduledAt} onChange={setScheduledAt} placeholder="زمان مصاحبه" />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="مدت (دقیقه)"
              className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
            />
            <select
              value={interviewerUserId}
              onChange={(e) => setInterviewerUserId(e.target.value)}
              className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
            >
              <option value="">مصاحبه‌گیرنده...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="محل مصاحبه (پیش‌فرض: آدرس شرکت)"
            className="w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy || !scheduledAt} className="flex-1 text-[12px] font-bold px-3 py-2 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer">
              ثبت زمان مصاحبه
            </button>
            <button type="button" onClick={() => setScheduling(false)} className="text-[12px] font-bold text-muted px-3 py-2 cursor-pointer">
              انصراف
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-1.5">
        {applicant.interviews.length === 0 ? (
          <div className="text-[12px] text-muted">مصاحبه‌ای ثبت نشده است</div>
        ) : (
          applicant.interviews.map((iv) => (
            <div key={iv.id} className="bg-slate-50 border border-border rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold">
                  {formatJalaliDateTime(iv.scheduledAt)} · {toPersianDigits(iv.durationMinutes)} دقیقه
                  {iv.interviewer ? ` · ${iv.interviewer.name}` : ""}
                  {iv.location ? ` · ${iv.location}` : ""}
                </span>
                <Badge tone={iv.status === "DONE" ? "success" : iv.status === "SCHEDULED" ? "neutral" : "danger"}>
                  {iv.status === "SCHEDULED" ? "زمان‌بندی‌شده" : iv.status === "DONE" ? "برگزارشده" : iv.status === "CANCELLED" ? "لغوشده" : "عدم حضور"}
                </Badge>
              </div>
              {iv.scoreItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {iv.scoreItems.map((s) => (
                    <Badge key={s.id} tone="primary">
                      {s.criterion}: {toPersianDigits(s.score)}
                    </Badge>
                  ))}
                </div>
              )}
              {iv.overallNote && <div className="text-[11.5px] text-muted mt-1">{iv.overallNote}</div>}
              {iv.status === "SCHEDULED" && (
                <button onClick={() => setReportingId(reportingId === iv.id ? null : iv.id)} className="text-[11.5px] font-bold text-primary mt-1.5 cursor-pointer">
                  ثبت گزارش مصاحبه
                </button>
              )}
              {reportingId === iv.id && (
                <InterviewReportForm
                  interviewId={iv.id}
                  busy={busy}
                  onSubmit={async (data) => {
                    setBusy(true);
                    setError(null);
                    try {
                      await recordInterviewReport(iv.id, data);
                      setReportingId(null);
                      onReported();
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "ثبت گزارش ناموفق بود");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InterviewReportForm({
  onSubmit,
  busy,
}: {
  interviewId: string;
  busy: boolean;
  onSubmit: (data: { scores: { criterion: string; score: number }[]; overallNote?: string; status: "DONE" | "NO_SHOW" }) => void;
}) {
  const [criteria, setCriteria] = useState([{ criterion: "دانش فنی", score: 3 }, { criterion: "ارتباطات", score: 3 }]);
  const [note, setNote] = useState("");

  return (
    <div className="mt-2 border-t border-border pt-2 flex flex-col gap-2">
      {criteria.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={c.criterion}
            onChange={(e) => setCriteria((prev) => prev.map((x, idx) => (idx === i ? { ...x, criterion: e.target.value } : x)))}
            className="flex-1 text-[12px] outline-none bg-surface border border-border rounded-lg px-2.5 py-1.5 focus:border-primary"
          />
          <select
            value={c.score}
            onChange={(e) => setCriteria((prev) => prev.map((x, idx) => (idx === i ? { ...x, score: Number(e.target.value) } : x)))}
            className="text-[12px] bg-surface border border-border rounded-lg px-2 py-1.5 outline-none"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {toPersianDigits(n)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button onClick={() => setCriteria((prev) => [...prev, { criterion: "", score: 3 }])} className="self-start text-[11px] font-bold text-primary cursor-pointer">
        + معیار جدید
      </button>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="یادداشت کلی مصاحبه"
        rows={2}
        className="w-full text-[12px] outline-none bg-surface border border-border rounded-lg px-2.5 py-1.5 focus:border-primary resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSubmit({ scores: criteria.filter((c) => c.criterion.trim()), overallNote: note.trim() || undefined, status: "DONE" })}
          disabled={busy}
          className="flex-1 text-[12px] font-bold px-3 py-2 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          ثبت — برگزار شد
        </button>
        <button
          onClick={() => onSubmit({ scores: [], overallNote: note.trim() || undefined, status: "NO_SHOW" })}
          disabled={busy}
          className="text-[12px] font-bold px-3 py-2 rounded-lg bg-danger-soft text-danger disabled:opacity-50 cursor-pointer"
        >
          عدم حضور
        </button>
      </div>
    </div>
  );
}

const COLLABORATION_TYPES = ["پاره‌وقت", "تمام‌وقت", "کارآموزی", "پروژه‌ای"];

/** «۰۹:۰۰ تا ۱۷:۰۰» ↔ {from, to} — ذخیره به‌صورت متن ساده تا PDF و صفحه‌ی عمومی بدون تغییر نمایش دهند. */
function parseHours(v: string | null | undefined): { from: string; to: string } {
  const m = /(\d{2}:\d{2})\D+(\d{2}:\d{2})/.exec(v ?? "");
  return m ? { from: m[1], to: m[2] } : { from: "", to: "" };
}

const FIELD = "w-full text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary";

function LabeledField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-bold text-ink-soft">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function OfferSection({ applicant, onChanged }: { applicant: JobApplicant; onChanged: () => void }) {
  const { me } = useWorkspace();
  const offer = applicant.offer;
  const canEdit = ["SPECIALIST_APPROVED", "OFFER_SENT", "OFFER_DECLINED"].includes(applicant.stage);
  const [editing, setEditing] = useState(!offer && canEdit);
  const [jobDescription, setJobDescription] = useState(offer?.jobDescription ?? "");
  const [collaborationType, setCollaborationType] = useState(offer?.collaborationType ?? "");
  const [hours, setHours] = useState(parseHours(offer?.workingHours));
  const [salary, setSalary] = useState(offer?.salary ? String(offer.salary) : "");
  const [benefits, setBenefits] = useState(offer?.benefits ?? "");
  const [durationMonths, setDurationMonths] = useState(offer?.durationMonths ? String(offer.durationMonths) : "");
  const [startDate, setStartDate] = useState(offer?.startDate ? offer.startDate.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function handleSave() {
    if (!jobDescription.trim() || !collaborationType || !salary) {
      setError("شرح وظایف، نحوه‌ی همکاری و حقوق را وارد کنید");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createOrUpdateOffer(applicant.id, {
        jobDescription: jobDescription.trim(),
        collaborationType,
        workingHours: hours.from && hours.to ? `${hours.from} تا ${hours.to}` : undefined,
        salary: Number(salary) || 0,
        benefits: benefits.trim() || undefined,
        durationMonths: durationMonths ? Number(durationMonths) : undefined,
        startDate: startDate || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (!offer) return;
    setBusy(true);
    setError(null);
    try {
      await sendOffer(offer.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ارسال ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink() {
    if (!offer) return;
    const link = offer.link || `${window.location.origin}/offer/${me?.tenant.slug ?? ""}/${offer.publicToken}`;
    const ok = await copyToClipboard(link);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } else {
      window.prompt("کپی خودکار انجام نشد؛ لینک را کپی کنید:", link);
    }
  }

  const statusLabel =
    offer?.status === "ACCEPTED"
      ? "پذیرفته و امضا شده توسط متقاضی"
      : offer?.status === "REJECTED"
        ? "رد شده توسط متقاضی"
        : offer?.status === "SENT"
          ? "ارسال‌شده به متقاضی"
          : "پیش‌نویس";

  return (
    <div className="border border-border rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12.5px] font-bold">شرایط همکاری</div>
        {offer && <Badge tone={offer.status === "ACCEPTED" ? "success" : offer.status === "REJECTED" ? "danger" : "primary"}>{statusLabel}</Badge>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5">
          <LabeledField label="شرح وظایف">
            <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} rows={2} className={`${FIELD} resize-none`} />
          </LabeledField>
          <div className="grid grid-cols-2 gap-2.5">
            <LabeledField label="نحوه‌ی همکاری">
              <select value={collaborationType} onChange={(e) => setCollaborationType(e.target.value)} className={FIELD}>
                <option value="">انتخاب کنید...</option>
                {COLLABORATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label="حقوق ماهانه (تومان)">
              <input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} className={FIELD} />
            </LabeledField>
          </div>
          <LabeledField label="ساعت حضور روزانه در محل شرکت">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-muted shrink-0">از</span>
                <input type="time" dir="ltr" value={hours.from} onChange={(e) => setHours({ ...hours, from: e.target.value })} className={FIELD} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-muted shrink-0">تا</span>
                <input type="time" dir="ltr" value={hours.to} onChange={(e) => setHours({ ...hours, to: e.target.value })} className={FIELD} />
              </div>
            </div>
          </LabeledField>
          <LabeledField label="سایر تسهیلات (اختیاری)">
            <input value={benefits} onChange={(e) => setBenefits(e.target.value)} className={FIELD} />
          </LabeledField>
          <div className="grid grid-cols-2 gap-2.5">
            <LabeledField label="مدت همکاری (ماه)" hint="خالی یعنی نامحدود">
              <input type="number" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} className={FIELD} />
            </LabeledField>
            <LabeledField label="تاریخ شروع همکاری">
              <JalaliDateInput value={startDate} onChange={setStartDate} placeholder="انتخاب تاریخ شمسی" />
            </LabeledField>
          </div>
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <button onClick={handleSave} disabled={busy} className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer">
            ثبت و ارسال برای متقاضی
          </button>
        </div>
      ) : offer ? (
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px]">{offer.jobDescription}</div>
          <div className="text-[12px] text-muted">
            {offer.collaborationType} · {formatToman(offer.salary)}
            {offer.workingHours ? ` · ساعت حضور روزانه: ${offer.workingHours}` : ""}
            {offer.startDate ? ` · شروع: ${formatJalaliDate(offer.startDate)}` : ""}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {canEdit && (
              <button onClick={() => setEditing(true)} className="text-[11.5px] font-bold text-ink-soft cursor-pointer">
                ویرایش و ارسال مجدد
              </button>
            )}
            {offer.status === "SENT" && (
              <button onClick={handleResend} disabled={busy} className="text-[11.5px] font-bold text-primary cursor-pointer disabled:opacity-50">
                ارسال مجدد پیامک
              </button>
            )}
            {(offer.status === "SENT" || offer.status === "ACCEPTED") && (
              <button onClick={handleCopyLink} className="text-[11.5px] font-bold text-primary cursor-pointer">
                {linkCopied ? "کپی شد ✓" : "کپی لینک برای متقاضی"}
              </button>
            )}
            {offer.status === "ACCEPTED" && (
              <button onClick={() => openOfferPdf(offer.id)} className="text-[11.5px] font-bold text-ink-soft cursor-pointer">
                دانلود PDF
              </button>
            )}
          </div>
          {error && <div className="text-[12px] text-danger">{error}</div>}
        </div>
      ) : null}
    </div>
  );
}

function HireSection({ applicantId, busy: parentBusy, onHired, onReject }: { applicantId: string; busy: boolean; onHired: () => void; onReject: (reason?: string) => void }) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [createLogin, setCreateLogin] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [roles, setRoles] = useState<TenantRoleOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoles().then(setRoles).catch(() => setRoles([]));
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  async function handleHire(applyStamp: boolean) {
    if (createLogin && !roleId) {
      setError("برای ایجاد دسترسی کاربری، نقش را انتخاب کنید");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await hireApplicant(applicantId, {
        employeeCode: employeeCode.trim() || undefined,
        departmentId: departmentId || undefined,
        applyStamp,
        createLogin,
        roleId: createLogin ? roleId : undefined,
      });
      onHired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "جذب ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || parentBusy;
  return (
    <div className="border-2 border-success/30 bg-success-soft rounded-xl p-3.5">
      <div className="text-[12.5px] font-bold mb-2">تأیید نهایی مدیر — ثبت در منابع انسانی</div>
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <LabeledField label="شماره‌ی پرسنلی" hint="خالی = خودکار، بر اساس آخرین شماره‌ی صادرشده">
          <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="خودکار" className={FIELD} />
        </LabeledField>
        <LabeledField label="واحد فعالیت">
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={FIELD}>
            <option value="">بدون واحد</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </LabeledField>
      </div>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="w-4 h-4 cursor-pointer" />
        <span className="text-[12.5px] font-semibold">ایجاد دسترسی کاربری و ارسال نحوه‌ی ورود به متقاضی</span>
      </label>
      {createLogin && (
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={`${FIELD} mb-2`}>
          <option value="">سطح دسترسی (نقش)...</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {error && <div className="text-[12px] text-danger mb-2">{error}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleHire(false)} disabled={disabled} className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-success text-white disabled:opacity-50 cursor-pointer">
          تأیید
        </button>
        <button onClick={() => handleHire(true)} disabled={disabled} className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer">
          تأیید و اجازه‌ی درج مهر و امضا
        </button>
        <button
          onClick={() => {
            const reason = window.prompt("دلیل رد (اختیاری):");
            if (reason !== null) onReject(reason || undefined);
          }}
          disabled={disabled}
          className="text-[12.5px] font-bold px-3.5 py-2 rounded-lg bg-danger-soft text-danger disabled:opacity-50 cursor-pointer"
        >
          رد
        </button>
      </div>
    </div>
  );
}
