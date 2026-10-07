"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { copyToClipboard } from "@/lib/clipboard";
import { API_URL, updateForm, type FormItem } from "@/lib/api";

type Tab = "link" | "embed" | "wordpress" | "api";
const TABS: Array<[Tab, string]> = [
  ["link", "لینک مستقیم و QR"],
  ["embed", "کد جاسازی"],
  ["wordpress", "وردپرس"],
  ["api", "API و وب‌هوک"],
];

function CopyBox({ value, multiline = false, label }: { value: string; multiline?: boolean; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      {label && <div className="text-[11.5px] font-bold text-ink-soft">{label}</div>}
      <div className="flex items-start gap-2">
        <pre dir="ltr" className={clsx("flex-1 bg-slate-100 rounded-lg px-3 py-2 text-[11px] text-left overflow-x-auto", multiline ? "whitespace-pre" : "whitespace-nowrap")}>
          {value}
        </pre>
        <button
          onClick={async () => {
            const ok = await copyToClipboard(value);
            setDone(ok);
            if (ok) setTimeout(() => setDone(false), 1800);
          }}
          className="text-[11.5px] font-bold text-primary cursor-pointer shrink-0 pt-2"
        >
          {done ? "کپی شد" : "کپی"}
        </button>
      </div>
    </div>
  );
}

function absoluteApi(): string {
  if (/^https?:\/\//.test(API_URL)) return API_URL.replace(/\/$/, "");
  return `${window.location.origin}${API_URL}`.replace(/\/$/, "");
}

export function EmbedPanel({ form, publicKey, onChanged }: { form: FormItem; publicKey: string; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("link");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("light");
  const [lang, setLang] = useState<"fa" | "en">("fa");
  const [primary, setPrimary] = useState("");
  const [redirect, setRedirect] = useState("");
  const [origins, setOrigins] = useState((form.allowedOrigins ?? []).join("\n"));
  const [originsMsg, setOriginsMsg] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ref = `${publicKey}/${form.slug}`;
  const publicUrl = `${origin}/f/${ref}`;
  const scriptUrl = `${origin}/embed/exir-forms.js`;
  const api = typeof window !== "undefined" ? absoluteApi() : "";
  const qrUrl = `${api}/public/forms/${ref}/qr.png?base=${encodeURIComponent(origin)}`;
  const isLive = form.status === "PUBLISHED";

  const attrs = useMemo(() => {
    const a = [`data-exir-form="${ref}"`];
    if (theme !== "light") a.push(`data-theme="${theme}"`);
    if (lang !== "fa") a.push(`data-lang="${lang}"`);
    if (/^[0-9a-fA-F]{3,8}$/.test(primary.replace("#", ""))) a.push(`data-primary="#${primary.replace("#", "")}"`);
    if (/^https?:\/\//.test(redirect)) a.push(`data-redirect="${redirect}"`);
    return a.join(" ");
  }, [ref, theme, lang, primary, redirect]);

  const scriptCode = `<div ${attrs}></div>\n<script src="${scriptUrl}" async></script>`;
  const iframeQuery = `embed=1${theme !== "light" ? `&theme=${theme}` : ""}${lang !== "fa" ? `&lang=${lang}` : ""}`;
  const iframeCode = `<iframe src="${publicUrl}?${iframeQuery}" style="width:100%;height:720px;border:0" loading="lazy" title="${form.title.replace(/"/g, "&quot;")}"></iframe>`;
  const shortcode = `[exir_form url="${publicUrl}"${theme !== "light" ? ` theme="${theme}"` : ""}${lang !== "fa" ? ` lang="${lang}"` : ""}]`;

  const sampleFields = form.fields.slice(0, 3);
  const curlAnswers = sampleFields.map((f) => `"${f.id}": ${f.type === "MULTI_CHOICE" ? `["${f.options[0] ?? "..."}"]` : `"${f.type === "SINGLE_CHOICE" ? (f.options[0] ?? "...") : "..."}"`}`).join(", ");
  const curl = `curl -X POST "${api}/public/forms/${ref}/submit" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"علی","phone":"09120000000","answers":{${curlAnswers}}}'`;
  const htmlForm = `<form method="POST" action="${api}/public/forms/${ref}/submit">\n  <input name="name" placeholder="نام">\n  <input name="phone" placeholder="موبایل">\n${sampleFields.map((f) => `  <input name="${f.id}" placeholder="${f.label.replace(/"/g, "&quot;")}">`).join("\n")}\n  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">\n  <button>ارسال</button>\n</form>`;

  async function saveOrigins() {
    setOriginsMsg(null);
    try {
      const list = origins.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean);
      await updateForm(form.id, { allowedOrigins: list });
      setOriginsMsg("ذخیره شد");
      onChanged();
    } catch {
      setOriginsMsg("ذخیره‌ی مبداهای مجاز ناموفق بود");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!isLive && (
        <div className="text-[12px] font-semibold bg-warning-soft text-warning rounded-xl px-3.5 py-2.5">
          این فرم هنوز منتشر نشده است؛ تا وقتی «منتشرشده» نباشد، لینک و کدهای زیر کار نمی‌کنند.
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx("text-[12px] font-bold px-3 py-1.5 rounded-lg border cursor-pointer", tab === k ? "bg-primary-soft text-primary border-primary" : "border-border text-ink-soft")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "link" && (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-soft leading-relaxed">این لینک را در بیو اینستاگرام، استوری، واتس‌اپ، پیامک یا هر جای دیگر بگذارید؛ نیازی به سایت ندارد.</p>
          <CopyBox value={publicUrl} label="لینک مستقیم" />
          <div className="flex items-center gap-4 flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="QR فرم" width={150} height={150} className="rounded-xl border border-border bg-white" />
            <div className="flex flex-col gap-2 text-[12px]">
              <a href={qrUrl} download={`form-${form.slug}-qr.png`} className="font-bold text-primary">
                دانلود QR (PNG)
              </a>
              <a href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`} target="_blank" rel="noreferrer" className="font-bold text-[#25D366]">
                ارسال در واتس‌اپ
              </a>
              <span className="text-muted">برای ردیابی منبع، به آخر لینک بنویسید: ?utm_source=instagram</span>
            </div>
          </div>
        </div>
      )}

      {tab === "embed" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
            <label className="flex flex-col gap-1">
              پوسته
              <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className="border border-border rounded-lg px-2 py-1.5 bg-surface">
                <option value="light">روشن</option>
                <option value="dark">تیره</option>
                <option value="auto">خودکار</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              زبان رابط
              <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className="border border-border rounded-lg px-2 py-1.5 bg-surface">
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              رنگ اصلی
              <input value={primary} onChange={(e) => setPrimary(e.target.value)} dir="ltr" placeholder="#4338ca" className="border border-border rounded-lg px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1">
              انتقال بعد از ثبت
              <input value={redirect} onChange={(e) => setRedirect(e.target.value)} dir="ltr" placeholder="https://..." className="border border-border rounded-lg px-2 py-1.5" />
            </label>
          </div>
          <CopyBox multiline value={scriptCode} label="کد HTML/JS (پیشنهادی — ارتفاع خودکار)" />
          <CopyBox multiline value={iframeCode} label="یا iframe ساده" />
          <div>
            <div className="text-[11.5px] font-bold text-ink-soft mb-1.5">پیش‌نمایش زنده</div>
            <iframe
              key={`${theme}-${lang}-${primary}`}
              src={`${publicUrl}?${iframeQuery}${/^[0-9a-fA-F]{3,8}$/.test(primary.replace("#", "")) ? `&primary=${primary.replace("#", "")}` : ""}`}
              title="پیش‌نمایش فرم"
              className="w-full h-[420px] border border-border rounded-xl bg-white"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[11.5px] font-bold text-ink-soft">محدودکردن سایت‌های مجاز (اختیاری)</div>
            <textarea
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              rows={2}
              dir="ltr"
              placeholder={"https://example.com\nhttps://www.example.com"}
              className="text-[12px] border border-border rounded-xl px-3 py-2 bg-slate-50 outline-none focus:border-primary"
            />
            <div className="flex items-center gap-3">
              <button onClick={saveOrigins} className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-primary text-white cursor-pointer">
                ذخیره
              </button>
              {originsMsg && <span className="text-[11.5px] text-muted">{originsMsg}</span>}
            </div>
            <p className="text-[11px] text-muted">خالی = همه‌ی سایت‌ها. اگر پر شود، فقط مرورگرِ بازدیدکننده‌ی همین سایت‌ها اجازه‌ی ارسال دارد (درخواست‌های سرور به سرور مثل Zapier محدود نمی‌شوند).</p>
          </div>
        </div>
      )}

      {tab === "wordpress" && (
        <div className="flex flex-col gap-3">
          <ol className="text-[12.5px] text-ink-soft leading-loose list-decimal pr-5">
            <li>
              افزونه را دانلود کنید:{" "}
              <a href="/downloads/exir-forms-wordpress.zip" download className="font-bold text-primary">
                exir-forms-wordpress.zip
              </a>
            </li>
            <li>در وردپرس: افزونه‌ها ← افزودن ← بارگذاری افزونه ← فعال‌سازی.</li>
            <li>شورت‌کد زیر را در هر برگه یا نوشته (یا ویجت «شورت‌کد») بگذارید.</li>
          </ol>
          <CopyBox value={shortcode} label="شورت‌کد" />
          <p className="text-[11.5px] text-muted">همین شورت‌کد با آدرس کامل فرم کار می‌کند و تنظیم اضافه ندارد. ارتفاع iframe خودکار تنظیم می‌شود.</p>
        </div>
      )}

      {tab === "api" && (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-soft leading-relaxed">
            برای سایت‌های دست‌نویس، Zapier/Make یا اپلیکیشن خودتان. نسخه‌ی ۱ پایدار است؛ بدون کلید و بدون ورود. سقف: ۱۰ ارسال در ۱۰ دقیقه برای هر IP.
          </p>
          <CopyBox value={`GET  ${api}/public/forms/${ref}/schema`} label="اسکیمای فرم (فیلدها، نوع، الزامی بودن، گزینه‌ها)" />
          <CopyBox value={`POST ${api}/public/forms/${ref}/submit`} label="ارسال (JSON، multipart یا urlencoded)" />
          <CopyBox multiline value={curl} label="نمونه curl" />
          <CopyBox multiline value={htmlForm} label="فرم HTML ساده (بدون JavaScript)" />
          <p className="text-[11.5px] text-muted leading-relaxed">
            کلید هر فیلد در answers همان <code dir="ltr">name</code> اسکیما است. فیلد مخفی <code dir="ltr">_hp</code> باید خالی بماند (ضد اسپم). برای ثبت منبع، <code dir="ltr">{`source: {url, utm}`}</code> را هم بفرستید.
            برای اطلاع لحظه‌ای هر پاسخ جدید به سیستم دیگر، در بخش «API» یک وب‌هوک با رویداد «ثبت پاسخ جدید در فرم‌ساز» بسازید.
          </p>
        </div>
      )}
    </div>
  );
}
