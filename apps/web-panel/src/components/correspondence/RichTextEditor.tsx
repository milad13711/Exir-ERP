"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";

/**
 * ویرایشگر متن غنی ساده (contentEditable) برای متن نامه و قالب‌ها.
 * - فقط HTML مجاز تولید می‌کند، اما «مرجع امنیت سرور است»: بک‌اند همیشه با sanitizeLetterHtml دوباره پاک‌سازی می‌کند.
 * - چسباندن (paste) همیشه به‌صورت متن ساده انجام می‌شود (بدون استایل/تگ ناخواسته‌ی Word یا وب).
 * - جانشین‌های قالب ({{recipientName}} ...) با دکمه‌ی «درج جانشین» اضافه می‌شوند.
 */
export type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholders?: { token: string; label: string }[];
  minHeight?: number;
  disabled?: boolean;
  className?: string;
};

type Cmd = { label: string; title: string; command: string; arg?: string };

const TABLE_HTML = "<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>";
const CMDS: Cmd[] = [
  { label: "B", title: "پررنگ", command: "bold" },
  { label: "I", title: "کج", command: "italic" },
  { label: "U", title: "زیرخط", command: "underline" },
  { label: "S", title: "خط‌خورده", command: "strikeThrough" },
  { label: "• ", title: "فهرست نقطه‌ای", command: "insertUnorderedList" },
  { label: "۱.", title: "فهرست شماره‌دار", command: "insertOrderedList" },
  { label: "H2", title: "عنوان", command: "formatBlock", arg: "h2" },
  { label: "¶", title: "پاراگراف", command: "formatBlock", arg: "p" },
  { label: "راست", title: "راست‌چین", command: "justifyRight" },
  { label: "وسط", title: "وسط‌چین", command: "justifyCenter" },
  { label: "چپ", title: "چپ‌چین", command: "justifyLeft" },
  { label: "دوطرفه", title: "تراز دوطرفه", command: "justifyFull" },
  { label: "جدول", title: "درج جدول", command: "insertHTML", arg: TABLE_HTML },
  { label: "—", title: "خط افقی", command: "insertHorizontalRule" },
  { label: "پاک", title: "حذف قالب‌بندی", command: "removeFormat" },
];

function exec(command: string, arg?: string) {
  // execCommand منسوخ اما هنوز در همه‌ی مرورگرها پایدار است؛ جایگزین بدون وابستگی ندارد.
  document.execCommand(command, false, arg);
}

export function RichTextEditor({ value, onChange, placeholders, minHeight = 220, disabled, className }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current && el.innerHTML !== value) {
      el.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }

  return (
    <div className={clsx("border border-border rounded-xl bg-surface overflow-hidden", disabled && "opacity-60", className)}>
      <div className="flex flex-wrap items-center gap-1 p-1.5 border-b border-border bg-slate-50">
        {CMDS.map((c) => (
          <button
            key={c.title}
            type="button"
            title={c.title}
            aria-label={c.title}
            disabled={disabled}
            // mousedown: انتخاب متن از دست نرود
            onMouseDown={(e) => {
              e.preventDefault();
              exec(c.command, c.arg);
              emit();
            }}
            className="min-w-8 h-8 px-2 text-[12px] font-bold rounded-lg border border-border bg-surface text-ink-soft hover:bg-primary-soft hover:text-primary cursor-pointer"
          >
            {c.label}
          </button>
        ))}
        {placeholders && placeholders.length > 0 && (
          <select
            disabled={disabled}
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              ref.current?.focus();
              exec("insertText", e.target.value);
              emit();
            }}
            className="h-8 text-[12px] rounded-lg border border-border bg-surface px-2 text-ink-soft cursor-pointer"
            aria-label="درج جانشین"
          >
            <option value="">درج جانشین…</option>
            {placeholders.map((p) => (
              <option key={p.token} value={p.token}>
                {p.label} — {p.token}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        ref={ref}
        dir="rtl"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          exec("insertText", text);
        }}
        style={{ minHeight }}
        className="rte-body p-3 text-[13.5px] leading-7 outline-none overflow-y-auto max-h-[60vh] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5 [&_ul]:list-disc [&_ul]:pr-6 [&_ol]:list-decimal [&_ol]:pr-6 [&_h2]:text-[16px] [&_h2]:font-extrabold [&_blockquote]:border-r-4 [&_blockquote]:pr-3 [&_blockquote]:text-muted"
      />
    </div>
  );
}
