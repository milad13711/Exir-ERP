import { useEffect, useRef, useState } from "react";
import { previewProjectSmsTemplate } from "@/lib/api";
import { smsPartsOf } from "@/lib/sms-parts";

export const SMS_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "name", label: "نام مشتری" },
  { key: "project", label: "نام پروژه" },
  { key: "stage", label: "مرحله" },
  { key: "percent", label: "درصد پیشرفت" },
  { key: "done", label: "مراحل انجام‌شده" },
  { key: "total", label: "کل مراحل" },
  { key: "link", label: "لینک" },
  { key: "company", label: "نام شرکت" },
  { key: "phone", label: "تلفن شرکت" },
];
export const SMS_MAX = 400;

/** فیلد قالب پیامک: چیپ‌های درج جایگزین‌شونده، شمارنده‌ی نویسه/بخش و پیش‌نمایش زنده با داده‌ی نمونه (رندر سرور). */
export function SmsTemplateField({ value, onChange, withLink = true }: { value: string; onChange: (v: string) => void; withLink?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<string>("");
  const [noLinkPreview, setNoLinkPreview] = useState<string>("");

  useEffect(() => {
    const t = setTimeout(() => {
      previewProjectSmsTemplate(value, true).then((r) => setPreview(r.message)).catch(() => setPreview(""));
      if (withLink) previewProjectSmsTemplate(value, false).then((r) => setNoLinkPreview(r.message)).catch(() => setNoLinkPreview(""));
    }, 350);
    return () => clearTimeout(t);
  }, [value, withLink]);

  function insert(key: string) {
    const el = ref.current;
    const token = `{${key}}`;
    if (!el) return onChange(`${value}${token}`);
    const a = el.selectionStart ?? value.length;
    const b = el.selectionEnd ?? value.length;
    const next = value.slice(0, a) + token + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  }

  const parts = smsPartsOf(value);
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={SMS_MAX}
        className="w-full text-[12.5px] leading-6 outline-none bg-surface border border-border rounded-xl px-3 py-2 focus:border-primary"
      />
      <div className="flex flex-wrap gap-1">
        {SMS_PLACEHOLDERS.map((p) => (
          <button key={p.key} type="button" onClick={() => insert(p.key)} title={`{${p.key}}`} className="text-[10.5px] font-semibold bg-primary-soft text-primary px-2 py-1 rounded-md cursor-pointer">
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => onChange(`${value}[[ مشاهده: {link}]]`)} title="بلوک اختیاری؛ بدون لینک حذف می‌شود" className="text-[10.5px] font-semibold bg-slate-100 text-ink-soft px-2 py-1 rounded-md cursor-pointer">
          بلوک اختیاری [[ ]]
        </button>
      </div>
      <div className="text-[11px] text-muted">
        {value.length} از {SMS_MAX} نویسه · حدود {parts} پیامک
      </div>
      {preview ? (
        <div className="text-[12px] bg-slate-50 border border-border rounded-lg px-3 py-2 whitespace-pre-wrap break-words" data-testid="sms-preview">
          <span className="text-[10.5px] text-muted block mb-0.5">پیش‌نمایش (داده‌ی نمونه)</span>
          {preview}
          {withLink && noLinkPreview && noLinkPreview !== preview ? (
            <span className="block mt-1.5 pt-1.5 border-t border-border text-muted">
              <span className="text-[10.5px] block mb-0.5">وقتی لینک عمومی پروژه خاموش است</span>
              {noLinkPreview}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
