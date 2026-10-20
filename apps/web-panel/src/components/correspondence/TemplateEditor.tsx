"use client";

import { useState } from "react";
import { RichTextEditor } from "./RichTextEditor";
import {
  LETTER_TYPE_LABELS,
  createCorrTemplate,
  templatePdfUrl,
  updateCorrTemplate,
  type CorrLetterType,
  type CorrTemplate,
  type Letterhead,
  type TemplatePlaceholder,
} from "@/lib/correspondence-docs-api";

const inputClass = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

/** ویرایشگر قالب متن نامه؛ template=null یعنی قالب جدید. */
export function TemplateEditor({
  template,
  letterheads,
  placeholders,
  onSaved,
  onCancel,
}: {
  template: CorrTemplate | null;
  letterheads: Letterhead[];
  placeholders: TemplatePlaceholder[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [letterType, setLetterType] = useState<CorrLetterType>(template?.letterType ?? "OUTGOING");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? "<p></p>");
  const [letterheadId, setLetterheadId] = useState(template?.defaultLetterheadId ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(template?.sortOrder ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const data = { name: name.trim(), letterType, subject, bodyHtml, defaultLetterheadId: letterheadId || null, isActive, sortOrder };
      if (template) await updateCorrTemplate(template.id, data);
      else await createCorrTemplate({ ...data, name: data.name, bodyHtml });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!template) return;
    try {
      window.open(await templatePdfUrl(template.id), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ساخت PDF ناموفق بود");
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {error && <div className="text-[12.5px] rounded-lg px-3 py-2 bg-red-50 text-red-700">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>نام قالب</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>نوع نامه</label>
          <select value={letterType} onChange={(e) => setLetterType(e.target.value as CorrLetterType)} className={inputClass}>
            {(Object.keys(LETTER_TYPE_LABELS) as CorrLetterType[]).map((t) => (
              <option key={t} value={t}>{LETTER_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>سربرگ پیش‌فرض این قالب</label>
          <select value={letterheadId} onChange={(e) => setLetterheadId(e.target.value)} className={inputClass}>
            <option value="">— سربرگ پیش‌فرض سازمان —</option>
            {letterheads.filter((l) => l.isActive).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>ترتیب نمایش</label>
          <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>موضوع پیش‌فرض (می‌تواند جانشین داشته باشد)</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>متن قالب</label>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholders={placeholders} />
        <p className="text-[11.5px] text-muted mt-1.5 leading-5">
          جانشین‌ها هنگام ساخت نامه با اطلاعات واقعی پر می‌شوند: {placeholders.map((p) => p.token).join("  ")}
        </p>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        فعال (در فهرست انتخاب قالب نمایش داده شود)
      </label>
      <div className="flex items-center gap-2 justify-end flex-wrap">
        {template && (
          <button type="button" onClick={() => void preview()} className="text-[12.5px] font-bold border border-border rounded-xl px-4 py-2.5 cursor-pointer">
            پیش‌نمایش PDF (ذخیره‌شده)
          </button>
        )}
        <button type="button" onClick={onCancel} className="text-[12.5px] font-bold border border-border rounded-xl px-4 py-2.5 cursor-pointer">انصراف</button>
        <button type="button" disabled={busy || name.trim().length < 2} onClick={() => void save()} className="text-[12.5px] font-bold bg-primary text-white rounded-xl px-5 py-2.5 cursor-pointer disabled:opacity-50">
          {busy ? "…" : "ذخیره"}
        </button>
      </div>
    </div>
  );
}
