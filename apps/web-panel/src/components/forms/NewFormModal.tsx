"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { TrashIcon } from "@/components/icons";
import { createForm, ApiError, type FormType, type FormFieldInput } from "@/lib/api";
import { FormFieldEditor } from "./FormFieldEditor";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const TYPE_LABELS: Record<FormType, string> = { SURVEY: "نظرسنجی", QUIZ: "آزمون آنلاین", QUESTIONNAIRE: "پرسش‌نامه", REGISTRATION: "فرم ثبت‌نام" };

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function NewFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<FormType>("SURVEY");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [coverImage, setCoverImage] = useState<string | undefined>();
  const [collectPhone, setCollectPhone] = useState(true);
  const [requirePhone, setRequirePhone] = useState(false);
  const [createContact, setCreateContact] = useState(false);
  const [passScorePercent, setPassScorePercent] = useState("60");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [fields, setFields] = useState<FormFieldInput[]>([{ type: "SHORT_TEXT", label: "", required: false, options: [] }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleCoverChange(file: File | null) {
    if (!file) return;
    setCoverImage(await fileToDataUri(file));
  }

  const formValid = !!title.trim() && !!slug.trim() && fields.length > 0 && fields.every((f) => f.label.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSaving(true);
    setError(null);
    try {
      await createForm({
        slug: slug.trim(),
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        coverImage,
        collectPhone,
        requirePhone,
        createContact,
        passScorePercent: type === "QUIZ" ? Number(passScorePercent) || undefined : undefined,
        thankYouMessage: thankYouMessage.trim() || undefined,
        fields,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت فرم ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="فرم جدید" onClose={onClose} width="max-w-[600px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نوع فرم</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(TYPE_LABELS) as FormType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t);
                  setCreateContact(t === "REGISTRATION");
                }}
                className={`text-[11.5px] font-bold py-2 rounded-xl border cursor-pointer ${type === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>تصویر کاور (اختیاری)</label>
          {coverImage ? (
            <div className="relative">
              <img src={coverImage} alt="" className="w-full h-28 object-cover rounded-xl border border-border" />
              <button type="button" onClick={() => setCoverImage(undefined)} className="absolute top-2 left-2 w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center text-danger cursor-pointer">
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center h-20 rounded-xl border border-dashed border-border text-[12px] text-muted cursor-pointer">
              انتخاب تصویر
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleCoverChange(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <div>
          <label className={labelClass}>عنوان</label>
          <input value={title} onChange={(e) => handleTitleChange(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>شناسه‌ی عمومی (در لینک)</label>
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            dir="ltr"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>توضیحات (اختیاری)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
        </div>

        <div className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft cursor-pointer">
            <input type="checkbox" checked={collectPhone} onChange={(e) => setCollectPhone(e.target.checked)} />
            گرفتن نام و شماره موبایل پاسخ‌دهنده
          </label>
          {collectPhone && (
            <>
              <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer ps-5">
                <input type="checkbox" checked={requirePhone} onChange={(e) => setRequirePhone(e.target.checked)} />
                الزامی باشد
              </label>
              <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer ps-5">
                <input type="checkbox" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} />
                پاسخ‌دهنده به مخاطبین CRM اضافه/متصل شود
              </label>
            </>
          )}
        </div>

        {type === "QUIZ" && (
          <div>
            <label className={labelClass}>درصد قبولی</label>
            <input value={passScorePercent} onChange={(e) => setPassScorePercent(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
          </div>
        )}

        <div>
          <label className={labelClass}>پیام پس از ثبت (اختیاری)</label>
          <input value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} placeholder="مثلاً از وقتی که گذاشتید سپاسگزاریم" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>سؤالات / فیلدها</label>
          <FormFieldEditor formType={type} fields={fields} onChange={setFields} />
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !formValid} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ثبت..." : "ثبت فرم"}
        </button>
      </form>
    </Modal>
  );
}
