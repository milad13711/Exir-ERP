"use client";

import { useEffect, useState } from "react";
import { safeHref } from "@/lib/safe-url";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { LogoMark, DocsIcon } from "@/components/icons";
import { ProposalText } from "@/components/proposals/ProposalText";
import { PROPOSAL_STATUS_LABELS } from "@/components/proposals/constants";
import { formatJalaliDate, formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  acceptPublicProposal,
  commentPublicProposal,
  fetchPublicProposal,
  publicProposalFileUrl,
  rejectPublicProposal,
  type PublicProposalView,
} from "@/lib/api";

const CONFIRM_STATEMENT = "تمام موارد فوق بررسی و تأیید شد";
const inputClass = "w-full text-[13px] outline-none placeholder:text-muted bg-white border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

function formatBytes(n: number | null): string {
  if (n === null) return "";
  return n >= 1024 * 1024 ? `${toPersianDigits((n / (1024 * 1024)).toFixed(1))} مگابایت` : `${toPersianDigits(Math.ceil(n / 1024))} کیلوبایت`;
}

type Panel = null | "accept" | "reject" | "comment";

export function PublicProposalClient({ slug, token }: { slug: string; token: string }) {
  const [view, setView] = useState<PublicProposalView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [commentBody, setCommentBody] = useState("");

  function load() {
    fetchPublicProposal(slug, token)
      .then(setView)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "این لینک یافت نشد"));
  }
  useEffect(load, [slug, token]);

  async function submit(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(okMsg);
      setPanel(null);
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

  const answerable = view.status === "SENT" || view.status === "VIEWED" || view.status === "REVISION_REQUESTED";
  const images = view.attachments.filter((a) => a.isImage);
  const files = view.attachments.filter((a) => !a.isImage);
  const rows: Array<[string, string | null]> = [
    ["مدت زمان پیاده‌سازی", view.durationText],
    ["مبلغ پروژه", view.amount > 0 ? formatToman(view.amount) : null],
    ["روش پرداخت", view.paymentMethodText],
    ["شیوه و زمان‌بندی پرداخت", view.paymentTerms],
    ["مهلت پرداخت", view.paymentDeadline],
    ["شماره کارت / حساب", view.bankInfo],
  ];

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex flex-col pb-28">
      <div className="border-b border-border bg-white">
        <div className="max-w-[720px] mx-auto flex items-center gap-2.5 px-5 py-4">
          {view.seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.seller.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain" />
          ) : (
            <LogoMark className="w-10 h-10" />
          )}
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-extrabold truncate">{view.seller.name || "پروپوزال"}</span>
            {view.seller.phone || view.seller.address ? (
              <span className="text-[11.5px] text-muted truncate">
                {[view.seller.phone ? toPersianDigits(view.seller.phone) : null, view.seller.address].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-[720px] mx-auto flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-primary-soft flex items-center justify-center shrink-0">
                  <DocsIcon className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11.5px] text-muted">پروپوزال شماره {toPersianDigits(view.proposalNo)}</div>
                  <h1 className="text-[17px] font-extrabold leading-8 break-words">{view.title}</h1>
                </div>
              </div>
              <span className="text-[12px] font-bold bg-slate-100 rounded-full px-3 py-1.5 shrink-0">{PROPOSAL_STATUS_LABELS[view.status]}</span>
            </div>
            {view.isDraft ? (
              <div className="mt-3 bg-warning-soft text-warning rounded-lg px-3 py-2.5 text-[12.5px] font-semibold leading-6">
                این پروپوزال هنوز پیش‌نویس است و برای مشتری ارسال نشده؛ آنچه می‌بینید فقط پیش‌نمایش است. برای ارسال، در پنل «کپی لینک» یا «ارسال پیامک» را بزنید.
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 text-[12px]">
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-muted">مشتری</div>
                <div className="font-bold mt-0.5">{view.contact.company || view.contact.name}</div>
                {view.contact.company ? <div className="text-muted">{view.contact.name}</div> : null}
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-muted">تاریخ ثبت</div>
                <div className="font-bold mt-0.5">{formatJalaliDate(view.issuedAt)}</div>
              </div>
              <div className={`rounded-lg px-3 py-2 ${view.expired ? "bg-danger-soft text-danger" : "bg-slate-50"}`}>
                <div className={view.expired ? "" : "text-muted"}>اعتبار تا</div>
                <div className="font-bold mt-0.5">{view.validUntil ? formatJalaliDate(view.validUntil) : "بدون محدودیت"}{view.expired ? " (منقضی)" : ""}</div>
              </div>
            </div>
          </div>

          {view.status === "ACCEPTED" ? (
            <div className="bg-success-soft text-success rounded-2xl px-5 py-4 text-[13px] font-semibold leading-7">
              این پروپوزال توسط {view.acceptedByName ?? "شما"} پذیرفته شد{view.acceptedAt ? ` (${formatJalaliDateTime(view.acceptedAt)})` : ""}. با تشکر از اعتماد شما، همکاران ما برای ادامه‌ی کار با شما در تماس خواهند بود.
            </div>
          ) : null}
          {view.status === "REJECTED" ? <div className="bg-slate-100 text-ink-soft rounded-2xl px-5 py-4 text-[13px] font-semibold">پاسخ شما (عدم پذیرش) ثبت شد. از وقتی که گذاشتید سپاسگزاریم.</div> : null}
          {view.status === "REVISION_REQUESTED" ? <div className="bg-warning-soft text-warning rounded-2xl px-5 py-4 text-[13px] font-semibold">درخواست اصلاح شما ثبت شد؛ پس از بازنگری، پروپوزال اصلاح‌شده برایتان ارسال می‌شود.</div> : null}
          {view.expired ? <div className="bg-danger-soft text-danger rounded-2xl px-5 py-4 text-[13px] font-semibold">مهلت اعتبار این پروپوزال به پایان رسیده است و امکان پذیرش وجود ندارد. برای تمدید با ما تماس بگیرید.</div> : null}
          {notice ? <div className="bg-success-soft text-success rounded-2xl px-5 py-3 text-[13px] font-semibold">{notice}</div> : null}

          <div className="bg-white rounded-2xl border border-border p-5">
            {view.content ? <ProposalText text={view.content} /> : <div className="text-muted text-[13px]">متنی ثبت نشده است.</div>}
          </div>

          {images.length > 0 ? (
            <div className="bg-white rounded-2xl border border-border p-5 flex flex-col gap-3">
              {images.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={publicProposalFileUrl(slug, token, a.id)} alt={a.title} className="w-full rounded-xl border border-border bg-slate-50 object-contain" />
              ))}
            </div>
          ) : null}

          <div className="bg-white rounded-2xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border text-[13px] font-extrabold">شرایط و هزینه</div>
            {rows.filter(([, v]) => v).length === 0 ? (
              <div className="px-5 py-4 text-[12.5px] text-muted">—</div>
            ) : (
              rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex border-b border-border last:border-b-0">
                    <div className="w-[140px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-4 py-3">{k}</div>
                    <div className="flex-1 text-[12.5px] px-4 py-3 whitespace-pre-wrap break-words" dir="auto">{v}</div>
                  </div>
                ))
            )}
          </div>

          {files.length > 0 ? (
            <div className="bg-white rounded-2xl border border-border p-5">
              <div className="text-[13px] font-extrabold mb-2">فایل‌های پیوست</div>
              <div className="flex flex-col gap-1.5">
                {files.map((a) => (
                  <a
                    key={a.id}
                    href={a.externalUrl ? safeHref(a.externalUrl) : publicProposalFileUrl(slug, token, a.id)}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    download={a.externalUrl ? undefined : a.title}
                    className="flex items-center justify-between gap-3 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold"
                  >
                    <span className="truncate">{a.title}</span>
                    <span className="text-[11px] text-muted shrink-0">{a.externalUrl ? "لینک" : formatBytes(a.sizeBytes)} · دانلود</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="bg-white rounded-2xl border border-border p-5">
            <div className="text-[13px] font-extrabold mb-2">گفتگو</div>
            {view.comments.length === 0 ? <div className="text-[12px] text-muted">هنوز پیامی ثبت نشده است.</div> : null}
            <div className="flex flex-col gap-1.5">
              {view.comments.map((c) => (
                <div key={c.id} className={`rounded-xl px-3.5 py-2.5 text-[12.5px] ${c.authorType === "CUSTOMER" ? "bg-primary-soft" : "bg-slate-100"}`}>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-0.5">
                    <span>{c.authorType === "CUSTOMER" ? (c.authorName ?? "شما") : `پاسخ ${view.seller.name || "تیم"}`}</span>
                    <span>{formatJalaliDateTime(c.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words">{c.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {panel ? (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setPanel(null)}>
          <div className="bg-white rounded-2xl w-full max-w-[520px] max-h-[90dvh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {panel === "accept" ? (
              <>
                <div className="font-extrabold text-[15px]">پذیرش پروپوزال</div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-bold text-ink-soft">نام و نام خانوادگی</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
                </label>
                <div className="text-[12px] font-bold text-ink-soft">امضای الکترونیک</div>
                {signature ? (
                  <div className="flex flex-col gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={signature} alt="امضای شما" className="w-full h-[100px] object-contain bg-slate-50 border border-border rounded-xl" />
                    <button onClick={() => setSignature(null)} className="text-[12px] font-bold text-ink-soft self-start cursor-pointer">امضای مجدد</button>
                  </div>
                ) : (
                  <SignaturePad onDone={setSignature} />
                )}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-4 h-4 mt-1 cursor-pointer" />
                  <span className="text-[13px] leading-7 font-semibold">{CONFIRM_STATEMENT}</span>
                </label>
                {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
                <div className="flex gap-2">
                  <button
                    disabled={busy || !confirmed || !signature || name.trim().length < 2}
                    onClick={() => submit(() => acceptPublicProposal(slug, token, { name: name.trim(), signatureDataUrl: signature!, confirmed }), "پذیرش شما با امضای الکترونیک ثبت شد. سپاسگزاریم.")}
                    className="flex-1 py-3 rounded-xl bg-success text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {busy ? "در حال ثبت..." : "تأیید و پذیرش"}
                  </button>
                  <button onClick={() => setPanel(null)} className="px-4 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">بستن</button>
                </div>
              </>
            ) : null}
            {panel === "reject" ? (
              <>
                <div className="font-extrabold text-[15px]">عدم پذیرش پروپوزال</div>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} placeholder="دلیل (اختیاری)" className={`${inputClass} resize-y`} />
                {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => submit(() => rejectPublicProposal(slug, token, { reason: reason.trim() || undefined }), "پاسخ شما ثبت شد.")} className="flex-1 py-3 rounded-xl bg-danger text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer">
                    {busy ? "در حال ثبت..." : "رد پروپوزال"}
                  </button>
                  <button onClick={() => setPanel(null)} className="px-4 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">بستن</button>
                </div>
              </>
            ) : null}
            {panel === "comment" ? (
              <>
                <div className="font-extrabold text-[15px]">ارسال نظر یا درخواست اصلاح</div>
                <textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)} rows={4} maxLength={2000} placeholder="نظر یا موارد مورد نیاز برای اصلاح را بنویسید..." className={`${inputClass} resize-y`} />
                {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
                <div className="flex gap-2 flex-wrap">
                  {answerable ? (
                    <button
                      disabled={busy || !commentBody.trim()}
                      onClick={() => submit(async () => { await commentPublicProposal(slug, token, { body: commentBody.trim(), requestRevision: true }); setCommentBody(""); }, "درخواست اصلاح شما ثبت شد.")}
                      className="flex-1 py-3 rounded-xl bg-warning text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer"
                    >
                      درخواست اصلاحات
                    </button>
                  ) : null}
                  <button
                    disabled={busy || !commentBody.trim()}
                    onClick={() => submit(async () => { await commentPublicProposal(slug, token, { body: commentBody.trim() }); setCommentBody(""); }, "نظر شما ثبت شد.")}
                    className="flex-1 py-3 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    فقط ارسال نظر
                  </button>
                  <button onClick={() => setPanel(null)} className="px-4 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">بستن</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {(answerable || view.status === "ACCEPTED" || view.status === "REJECTED" || view.expired) && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border">
          <div className="max-w-[720px] mx-auto flex items-center gap-2 px-4 py-3">
            {answerable ? (
              <>
                <button onClick={() => { setError(null); setPanel("accept"); }} className="flex-[2] py-3 rounded-xl bg-success text-white text-[13.5px] font-bold cursor-pointer">پذیرش پروپوزال</button>
                <button onClick={() => { setError(null); setPanel("reject"); }} className="flex-1 py-3 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">رد</button>
              </>
            ) : null}
            <button onClick={() => { setError(null); setPanel("comment"); }} className="flex-1 py-3 rounded-xl bg-primary-soft text-primary text-[13px] font-bold cursor-pointer">نظر / اصلاح</button>
          </div>
        </div>
      )}
    </div>
  );
}
