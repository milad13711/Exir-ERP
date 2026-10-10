"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { safeHref } from "@/lib/safe-url";
import { LogoMark, DocsIcon, CheckIcon } from "@/components/icons";
import { ProjectProgressBar } from "@/components/projects/ProjectProgressBar";
import { formatJalaliDate, formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { PROPOSAL_STATUS_LABELS } from "@/components/proposals/constants";
import { ApiError, commentPublicProject, fetchPublicProject, publicProjectFileUrl, type PublicProjectView } from "@/lib/api";

const inputClass = "w-full text-[13px] outline-none placeholder:text-muted bg-white border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

const PROJECT_STATUS_LABELS: Record<string, string> = {
  PLANNING: "در مرحله‌ی برنامه‌ریزی",
  ACTIVE: "در حال اجرا",
  ON_HOLD: "متوقف‌شده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};
const STAGE_LABELS = { PENDING: "شروع‌نشده", IN_PROGRESS: "در حال اجرا", DONE: "انجام‌شده" } as const;
const STAGE_TONES = { PENDING: "bg-slate-100 text-ink-soft", IN_PROGRESS: "bg-primary-soft text-primary", DONE: "bg-success-soft text-success" } as const;
const INVOICE_STATUS_LABELS: Record<string, string> = { CONFIRMED: "تأییدشده", PARTIALLY_PAID: "پرداخت جزئی", PAID: "تسویه‌شده" };

function formatBytes(n: number | null): string {
  if (n === null) return "";
  return n >= 1024 * 1024 ? `${toPersianDigits((n / (1024 * 1024)).toFixed(1))} مگابایت` : `${toPersianDigits(Math.ceil(n / 1024))} کیلوبایت`;
}

export function PublicProjectClient({ slug, token }: { slug: string; token: string }) {
  const [view, setView] = useState<PublicProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // فقط وقتی از صفحه‌ی پیگیری آمده‌اند (?from=track)؛ لینک مستقیم بدون تغییر کار می‌کند
  const [fromTrack, setFromTrack] = useState(false);
  useEffect(() => {
    setFromTrack(new URLSearchParams(window.location.search).get("from") === "track");
  }, []);

  function load() {
    fetchPublicProject(slug, token)
      .then(setView)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }
  useEffect(load, [slug, token]);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await commentPublicProject(slug, token, { body: body.trim(), name: name.trim() || undefined });
      setBody("");
      setNotice("پیام شما ثبت شد و برای تیم ارسال شد.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت ناموفق بود، دوباره تلاش کنید");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <div dir="rtl" className="min-h-dvh bg-slate-50 flex items-center justify-center text-muted text-sm px-6 text-center">
        {loadError ?? "در حال بارگذاری..."}
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col pb-10">
      <div className="border-b border-border bg-white">
        <div className="max-w-[720px] mx-auto flex items-center gap-2.5 px-5 py-4">
          {view.seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.seller.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain" />
          ) : (
            <LogoMark className="w-10 h-10" />
          )}
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-extrabold truncate">{view.seller.name || "پیگیری پروژه"}</span>
            {view.seller.phone || view.seller.address ? (
              <span className="text-[11.5px] text-muted truncate">{[view.seller.phone ? toPersianDigits(view.seller.phone) : null, view.seller.address].filter(Boolean).join(" · ")}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-[720px] mx-auto flex flex-col gap-4">
          {fromTrack ? (
            <Link href={`/track/${slug}`} className="text-[13px] font-bold text-primary self-start">
              → بازگشت به پروژه‌های من
            </Link>
          ) : null}
          <div className="bg-white rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11.5px] text-muted">پروژه شماره {toPersianDigits(view.projectNo)}</div>
                <h1 className="text-[17px] font-extrabold leading-8 break-words">{view.name}</h1>
              </div>
              <span className="text-[12px] font-bold bg-slate-100 rounded-full px-3 py-1.5 shrink-0">{PROJECT_STATUS_LABELS[view.status] ?? view.status}</span>
            </div>
            <div className="mt-4">
              <ProjectProgressBar percent={view.progress.percent} done={view.progress.doneStages} total={view.progress.totalStages} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 text-[12px]">
              {view.customer ? (
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-muted">مشتری</div>
                  <div className="font-bold mt-0.5">{view.customer.company || view.customer.name}</div>
                </div>
              ) : null}
              {view.startDate ? (
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-muted">تاریخ شروع</div>
                  <div className="font-bold mt-0.5">{formatJalaliDate(view.startDate)}</div>
                </div>
              ) : null}
              {view.endDate ? (
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="text-muted">تاریخ پایان</div>
                  <div className="font-bold mt-0.5">{formatJalaliDate(view.endDate)}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-border p-5">
            <div className="text-[13px] font-extrabold mb-3">مراحل پروژه</div>
            {view.stages.length === 0 ? <div className="text-[12.5px] text-muted">مرحله‌ای ثبت نشده است.</div> : null}
            <div className="flex flex-col gap-3">
              {view.stages.map((s) => (
                <div key={s.index} className="border border-border rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${STAGE_TONES[s.status]}`}>
                        {s.status === "DONE" ? <CheckIcon className="w-3.5 h-3.5" /> : toPersianDigits(s.index)}
                      </span>
                      <span className="text-[13px] font-bold break-words">{s.title}</span>
                    </div>
                    <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 shrink-0 ${STAGE_TONES[s.status]}`}>{STAGE_LABELS[s.status]}</span>
                  </div>
                  {s.completedAt ? <div className="text-[11px] text-muted mt-1">تکمیل: {formatJalaliDate(s.completedAt)}</div> : null}
                  {s.description ? <div className="text-[12.5px] leading-7 mt-2 whitespace-pre-wrap break-words" dir="auto">{s.description}</div> : null}
                  {s.images.length > 0 ? (
                    <div className="flex flex-col gap-2 mt-2">
                      {s.images.map((im) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={im.id} src={publicProjectFileUrl(slug, token, im.id)} alt={im.title} className="w-full rounded-xl border border-border bg-slate-50 object-contain" />
                      ))}
                    </div>
                  ) : null}
                  {s.files.length > 0 ? (
                    <div className="flex flex-col gap-1.5 mt-2">
                      {s.files.map((f) => (
                        <a
                          key={f.id}
                          href={f.externalUrl ? safeHref(f.externalUrl) : publicProjectFileUrl(slug, token, f.id)}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          download={f.externalUrl ? undefined : f.title}
                          className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold"
                        >
                          <span className="truncate">{f.title}</span>
                          <span className="text-[11px] text-muted shrink-0">{f.externalUrl ? "لینک" : formatBytes(f.sizeBytes)} · دانلود</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {s.links.length > 0 ? (
                    <div className="flex flex-col gap-1.5 mt-2">
                      {s.links.map((l) => (
                        <a key={l.id} href={safeHref(l.url)} target="_blank" rel="noopener noreferrer nofollow" className="text-[12.5px] font-semibold text-primary break-words">
                          {l.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {s.notes.map((n) => (
                    <div key={n.id} className="mt-2 bg-slate-50 rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap break-words" dir="auto">
                      {n.body}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {view.documents.length > 0 ? (
            <div className="bg-white rounded-2xl border border-border p-5">
              <div className="text-[13px] font-extrabold mb-3">اسناد پروژه</div>
              <div className="flex flex-col gap-2">
                {view.documents.map((d) => (
                  <div key={`${d.kind}-${d.number}`} className="flex items-center gap-3 border border-border rounded-xl px-3.5 py-3 flex-wrap">
                    <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
                      <DocsIcon className="w-4.5 h-4.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-muted">{d.kind === "PROPOSAL" ? "پروپوزال" : "فاکتور"} شماره {toPersianDigits(d.number)}</div>
                      <div className="text-[13px] font-bold break-words">{d.title}</div>
                      <div className="text-[11.5px] text-muted mt-0.5">
                        {d.kind === "PROPOSAL" ? (PROPOSAL_STATUS_LABELS[d.status as keyof typeof PROPOSAL_STATUS_LABELS] ?? d.status) : (INVOICE_STATUS_LABELS[d.status] ?? d.status)} · {formatJalaliDate(d.date)}
                        {d.amount > 0 ? ` · ${formatToman(d.amount)}` : ""}
                      </div>
                    </div>
                    <a href={d.path} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-bold text-white bg-primary rounded-xl px-4 py-2.5 shrink-0">
                      مشاهده
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="bg-white rounded-2xl border border-border p-5">
            <div className="text-[13px] font-extrabold mb-2">گفتگو با تیم</div>
            {view.comments.length === 0 ? <div className="text-[12px] text-muted mb-2">هنوز پیامی ثبت نشده است.</div> : null}
            <div className="flex flex-col gap-2 mb-3">
              {view.comments.map((c) => (
                <div key={c.id}>
                  <div className="rounded-xl px-3.5 py-2.5 text-[12.5px] bg-primary-soft">
                    <div className="flex items-center justify-between text-[11px] text-muted mb-0.5">
                      <span>{c.authorName}</span>
                      <span>{formatJalaliDateTime(c.createdAt)}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words" dir="auto">{c.body}</div>
                  </div>
                  {c.replies.map((r) => (
                    <div key={r.id} className="mt-1.5 mr-5 rounded-xl px-3.5 py-2.5 text-[12.5px] bg-slate-100">
                      <div className="flex items-center justify-between text-[11px] text-muted mb-0.5">
                        <span className="font-bold text-ink-soft">پاسخ تیم</span>
                        <span>{formatJalaliDateTime(r.createdAt)}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words" dir="auto">{r.body}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <form onSubmit={submitComment} className="flex flex-col gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="نام شما (اختیاری)" className={inputClass} />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} placeholder="نظر یا پیام خود را بنویسید..." className={`${inputClass} resize-y`} />
              {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
              {notice ? <div className="text-[12.5px] text-success font-semibold">{notice}</div> : null}
              <button type="submit" disabled={busy || !body.trim()} className="py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer">
                {busy ? "در حال ارسال..." : "ارسال پیام"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
