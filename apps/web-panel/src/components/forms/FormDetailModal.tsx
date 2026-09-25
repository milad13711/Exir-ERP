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
  type FormStats,
  type FormFieldInput,
} from "@/lib/api";
import { FormFieldEditor } from "./FormFieldEditor";

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

export function FormDetailModal({ formId, onClose, onChanged }: { formId: string; onClose: () => void; onChanged: () => void }) {
  const { me } = useWorkspace();
  const [form, setForm] = useState<FormItem | null>(null);
  const [tab, setTab] = useState<"fields" | "submissions" | "stats">("fields");
  const [fields, setFields] = useState<FormFieldInput[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[] | null>(null);
  const [stats, setStats] = useState<FormStats | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [openSubmission, setOpenSubmission] = useState<FormSubmission | null>(null);

  function refetch() {
    fetchForm(formId).then((f) => {
      setForm(f);
      setFields(toFieldInputs(f));
    });
  }
  useEffect(refetch, [formId]);

  useEffect(() => {
    if (tab === "submissions") fetchFormSubmissions(formId).then(setSubmissions).catch(() => setSubmissions([]));
    if (tab === "stats") fetchFormStats(formId).then(setStats).catch(() => setStats(null));
  }, [tab, formId]);

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
  const embedCode = `<iframe src="${publicUrl}" style="width:100%;height:720px;border:0;border-radius:16px" loading="lazy"></iframe>`;

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
          <div className="flex flex-col gap-2">
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
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-primary font-bold">کد embed برای سایت خودتان</summary>
              <div className="flex items-center gap-2 mt-1.5">
                <code className="flex-1 bg-slate-100 rounded-lg px-2.5 py-2 text-[11px] overflow-x-auto whitespace-nowrap" dir="ltr">
                  {embedCode}
                </code>
                <button onClick={() => copyToClipboard(embedCode)} className="text-[11px] font-bold text-primary cursor-pointer shrink-0">
                  کپی
                </button>
              </div>
            </details>
          </div>
        )}

        <div className="flex gap-2">
          {(["fields", "submissions", "stats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[12px] font-bold px-3.5 py-2 rounded-xl border cursor-pointer ${tab === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              {t === "fields" ? "سؤالات/فیلدها" : t === "submissions" ? "پاسخ‌ها" : "آمار"}
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
            {submissions === null ? (
              <div className="text-center text-muted text-sm py-8">در حال بارگذاری...</div>
            ) : submissions.length === 0 ? (
              <div className="text-center text-muted text-sm py-8">هنوز پاسخی ثبت نشده</div>
            ) : (
              submissions.map((s) => (
                <button key={s.id} onClick={() => setOpenSubmission(s)} className="text-right border border-border rounded-xl px-3.5 py-3 hover:bg-slate-50 cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold">{s.respondentName || s.respondentPhone || "بدون‌نام"}</span>
                    {s.scorePercent != null && (
                      <Badge tone={s.passed ? "success" : "danger"}>{toPersianDigits(s.scorePercent)}٪ {s.passed ? "قبول" : "ناموفق"}</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted mt-1">{formatJalaliDateTime(s.submittedAt)}</div>
                </button>
              ))
            )}
          </div>
        )}

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

      {openSubmission && (
        <Modal title="جزئیات پاسخ" onClose={() => setOpenSubmission(null)} width="max-w-[480px]">
          <div className="flex flex-col gap-2.5">
            <div className="text-[12.5px] text-muted">
              {openSubmission.respondentName} {openSubmission.respondentPhone ? `— ${openSubmission.respondentPhone}` : ""}
            </div>
            {openSubmission.answers.map((a) => (
              <div key={a.id} className="border border-border rounded-lg p-2.5">
                <div className="text-[11.5px] text-muted">{a.field.label}</div>
                <div className="text-[13px] font-bold mt-0.5">{a.valueOptions.length > 0 ? a.valueOptions.join("، ") : a.valueText || "—"}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Modal>
  );
}
