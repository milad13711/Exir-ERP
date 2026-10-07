"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ShareIcon, WhatsAppIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchForm,
  updateForm,
  publishForm,
  unpublishForm,
  closeForm,
  deleteForm,
  fetchFormSubmissions,
  fetchFormStats,
  type FormItem,
  type FormStatus,
  type FormSubmission,
  type FormSubmissionStatus,
  type FormStats,
  type FormFieldInput,
} from "@/lib/api";
import { FormFieldEditor } from "./FormFieldEditor";
import { EmbedPanel } from "./EmbedPanel";
import { SubmissionDetailModal } from "./SubmissionDetailModal";
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TONES, timeAgoFa } from "./forms-ui";

const STATUS_LABELS: Record<FormStatus, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CLOSED: "بسته‌شده" };
const STATUS_TONES: Record<FormStatus, "neutral" | "success" | "danger"> = { DRAFT: "neutral", PUBLISHED: "success", CLOSED: "danger" };

function toFieldInputs(form: FormItem): FormFieldInput[] {
  return form.fields.map((f) => ({
    id: f.id,
    type: f.type,
    label: f.label,
    helpText: f.helpText ?? undefined,
    required: f.required,
    sortOrder: f.sortOrder,
    options: f.options,
    correctOption: f.correctOption ?? undefined,
    points: f.points ?? undefined,
  }));
}

type DetailTab = "fields" | "submissions" | "connect" | "stats";

export function FormDetailModal({
  formId,
  onClose,
  onChanged,
  initialTab = "fields",
  initialSubmissionId = null,
}: {
  formId: string;
  onClose: () => void;
  onChanged: () => void;
  initialTab?: DetailTab;
  /** از ویجت داشبورد/اعلان: مستقیم همین پاسخ باز شود */
  initialSubmissionId?: string | null;
}) {
  const { me } = useWorkspace();
  const [form, setForm] = useState<FormItem | null>(null);
  const [tab, setTab] = useState<DetailTab>(initialSubmissionId ? "submissions" : initialTab);
  const [statusFilter, setStatusFilter] = useState<"ALL" | FormSubmissionStatus>("ALL");
  const [fields, setFields] = useState<FormFieldInput[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[] | null>(null);
  const [stats, setStats] = useState<FormStats | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [openSubmissionId, setOpenSubmissionId] = useState<string | null>(initialSubmissionId);

  function refetch() {
    fetchForm(formId).then((f) => {
      setForm(f);
      setFields(toFieldInputs(f));
    });
  }
  useEffect(refetch, [formId]);

  function reloadSubmissions() {
    fetchFormSubmissions(formId, statusFilter === "ALL" ? undefined : statusFilter).then(setSubmissions).catch(() => setSubmissions([]));
  }
  useEffect(() => {
    if (tab === "submissions") reloadSubmissions();
    if (tab === "stats") fetchFormStats(formId).then(setStats).catch(() => setStats(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, formId, statusFilter]);

  function reload() {
    refetch();
    onChanged();
  }

  async function handleSaveFields() {
    setSavingFields(true);
    try {
      await updateForm(formId, { fields });
      reload();
    } finally {
      setSavingFields(false);
    }
  }

  async function handlePublish() {
    await publishForm(formId);
    reload();
  }
  async function handleUnpublish() {
    await unpublishForm(formId);
    reload();
  }
  async function handleClose() {
    if (!window.confirm("این فرم بسته شود؟ دیگر پاسخ جدید پذیرفته نمی‌شود.")) return;
    await closeForm(formId);
    reload();
  }
  async function handleDelete() {
    if (!window.confirm("این فرم برای همیشه حذف شود؟ همه‌ی پاسخ‌ها هم حذف می‌شوند.")) return;
    await deleteForm(formId);
    onClose();
    onChanged();
  }

  if (!form) {
    return (
      <Modal title="در حال بارگذاری..." onClose={onClose} width="max-w-[640px]">
        <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
      </Modal>
    );
  }

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/f/${me?.tenant.publicKey ?? me?.tenant.slug ?? "exir-demo"}/${form.slug}` : "";
  const publicKey = me?.tenant.publicKey ?? me?.tenant.slug ?? "exir-demo";

  return (
    <Modal title={form.title} onClose={onClose} width="max-w-[680px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONES[form.status]}>{STATUS_LABELS[form.status]}</Badge>
            <span className="text-[12px] text-muted">{toPersianDigits(form._count?.submissions ?? 0)} پاسخ</span>
          </div>
          <div className="flex items-center gap-1.5">
            {form.status === "DRAFT" && (
              <button onClick={handlePublish} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-success-soft text-success cursor-pointer">
                انتشار
              </button>
            )}
            {form.status === "PUBLISHED" && (
              <>
                <button onClick={handleUnpublish} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-warning-soft text-warning cursor-pointer">
                  بازگشت به پیش‌نویس
                </button>
                <button onClick={handleClose} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-danger-soft text-danger cursor-pointer">
                  بستن فرم
                </button>
              </>
            )}
            <button onClick={handleDelete} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 text-ink-soft cursor-pointer">
              حذف
            </button>
          </div>
        </div>

        {form.status !== "DRAFT" && publicUrl && (
          <div className="flex items-center gap-2 bg-primary-soft rounded-xl p-2.5">
            <input readOnly value={publicUrl} dir="ltr" className="flex-1 bg-transparent text-[11.5px] text-primary outline-none" />
            <button
              onClick={async () => {
                const ok = await copyToClipboard(publicUrl);
                setLinkCopied(ok);
                if (ok) setTimeout(() => setLinkCopied(false), 2000);
              }}
              title="کپی لینک"
              className="w-8 h-8 flex items-center justify-center text-primary cursor-pointer shrink-0"
            >
              <ShareIcon className="w-4 h-4" />
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`} target="_blank" rel="noreferrer" title="ارسال در واتس‌اپ" className="w-8 h-8 flex items-center justify-center text-[#25D366] shrink-0">
              <WhatsAppIcon className="w-4.5 h-4.5" />
            </a>
            {linkCopied && <span className="text-[11px] text-success font-semibold shrink-0">کپی شد</span>}
          </div>
        )}

        <div className="flex gap-2">
          {(["fields", "submissions", "connect", "stats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[12px] font-bold px-3.5 py-2 rounded-xl border cursor-pointer ${tab === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              {t === "fields" ? "سؤالات/فیلدها" : t === "submissions" ? "پاسخ‌ها" : t === "connect" ? "اتصال به سایت" : "آمار"}
            </button>
          ))}
        </div>

        {tab === "fields" && (
          <div className="flex flex-col gap-3">
            <FormFieldEditor formType={form.type} fields={fields} onChange={setFields} />
            <button onClick={handleSaveFields} disabled={savingFields} className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
              {savingFields ? "در حال ذخیره..." : "ذخیره‌ی تغییرات"}
            </button>
          </div>
        )}

        {tab === "submissions" && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {(["ALL", "NEW", "IN_REVIEW", "DONE"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer ${statusFilter === st ? "bg-primary-soft text-primary border-primary" : "border-border text-ink-soft"}`}
                >
                  {st === "ALL" ? "همه" : SUBMISSION_STATUS_LABELS[st]}
                </button>
              ))}
            </div>
            {submissions === null ? (
              <div className="text-center text-muted text-sm py-8">در حال بارگذاری...</div>
            ) : submissions.length === 0 ? (
              <div className="text-center text-muted text-sm py-8">{statusFilter === "ALL" ? "هنوز پاسخی ثبت نشده" : "پاسخی با این وضعیت نیست"}</div>
            ) : (
              submissions.map((s) => {
                const isNew = s.status === "NEW";
                const key = [...s.answers]
                  .sort((x, y) => (x.field.sortOrder ?? 0) - (y.field.sortOrder ?? 0))
                  .filter((a) => a.valueText || a.valueOptions.length > 0)
                  .slice(0, 2);
                return (
                  <button
                    key={s.id}
                    onClick={() => setOpenSubmissionId(s.id)}
                    className={`text-right border rounded-xl px-3.5 py-3 hover:bg-slate-50 cursor-pointer ${isNew ? "border-primary bg-primary-soft/40 border-r-4" : "border-border"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[13px] ${isNew ? "font-extrabold" : "font-bold"}`}>{s.respondentName || s.respondentPhone || "بدون‌نام"}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.scorePercent != null && <Badge tone={s.passed ? "success" : "danger"}>{toPersianDigits(s.scorePercent)}٪ {s.passed ? "قبول" : "ناموفق"}</Badge>}
                        <Badge tone={SUBMISSION_STATUS_TONES[s.status]}>{SUBMISSION_STATUS_LABELS[s.status]}</Badge>
                      </div>
                    </div>
                    {key.length > 0 && (
                      <div className="text-[11.5px] text-ink-soft mt-1 flex flex-col gap-0.5">
                        {key.map((a) => (
                          <div key={a.id} className="truncate">
                            <span className="text-muted">{a.field.label}: </span>
                            {a.valueOptions.length > 0 ? a.valueOptions.join("، ") : a.valueText}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-muted mt-1" title={formatJalaliDateTime(s.submittedAt)}>
                      {timeAgoFa(s.submittedAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {tab === "connect" && <EmbedPanel form={form} publicKey={publicKey} onChanged={reload} />}

        {tab === "stats" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3.5 text-center">
              <div className="text-lg font-extrabold">{toPersianDigits(stats?.totalSubmissions ?? 0)}</div>
              <div className="text-[11px] text-muted mt-0.5">کل پاسخ‌ها</div>
            </div>
            {stats?.quizStats && (
              <>
                <div className="bg-slate-50 rounded-xl p-3.5 text-center">
                  <div className="text-lg font-extrabold">{toPersianDigits(stats.quizStats.avgScorePercent)}٪</div>
                  <div className="text-[11px] text-muted mt-0.5">میانگین نمره</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3.5 text-center">
                  <div className="text-lg font-extrabold text-success">{toPersianDigits(stats.quizStats.passRate)}٪</div>
                  <div className="text-[11px] text-muted mt-0.5">نرخ قبولی</div>
                </div>
              </>
            )}
            {stats?.ratingAverages.map((r) => (
              <div key={r.fieldId} className="bg-slate-50 rounded-xl p-3.5 text-center col-span-2">
                <div className="text-lg font-extrabold">{r.average != null ? toPersianDigits(r.average) : "—"}</div>
                <div className="text-[11px] text-muted mt-0.5">میانگین «{r.label}»</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openSubmissionId && (
        <SubmissionDetailModal
          submissionId={openSubmissionId}
          onClose={() => setOpenSubmissionId(null)}
          onChanged={() => {
            reloadSubmissions();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}
