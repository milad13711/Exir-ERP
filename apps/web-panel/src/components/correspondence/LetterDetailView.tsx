"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { SignatureEvidencePanel } from "@/components/shared/SignatureEvidencePanel";
import { Badge } from "@/components/ui/Badge";
import { ReasonDialog } from "@/components/ui/ReasonDialog";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { fetchAttachments } from "@/lib/api";
import {
  DELIVERY_LABELS, EVENT_LABELS, closeLetter, openPdfInTab, createCorrection, fetchCorrMe, fetchLetter, fetchRevisions, letterPdfUrl, referralDone, referralReturn,
  referralSeen, referralCancel, rejectLetter, reopenLetter, replyToLetter, returnLetter, slipPdfUrl, unarchiveLetter, updateLetter, voidLetter,
  type CorrMe, type LetterDetail, type Referral,
} from "@/lib/correspondence-api";
import { toPersianDigits } from "@/lib/persian";
import { LetterEditor } from "./LetterEditor";
import {
  ArchiveDialog, DeliveredDialog, FollowupDialog, ForwardDialog, ParaphDialog, ReferDialog, ReviewDialog, SentDialog, SignDialog, SubmitDialog,
} from "./LetterDialogs";
import { BTN_DANGER, BTN_PRIMARY, BTN_SOFT, ConfBadge, Empty, ErrorBox, INPUT, LABEL, Loading, PriorityBadge, Section, Sheet, StatusBadge, TypeBadge, dateFa, dateTimeFa, errText, fa } from "./corr-ui";

type Dlg =
  | { k: "submit" } | { k: "sign" } | { k: "review" } | { k: "refer" } | { k: "paraph" } | { k: "sent" } | { k: "delivered" } | { k: "followup" } | { k: "archive" }
  | { k: "return" } | { k: "reject" } | { k: "void" } | { k: "reopen" } | { k: "close" } | { k: "editIncoming" } | { k: "forward"; id: string }
  | { k: "refDone"; id: string } | { k: "refReturn"; id: string };

const REF_STATUS: Record<Referral["status"], string> = { PENDING: "در انتظار", SEEN: "دیده شد", DONE: "انجام شد", RETURNED: "برگشت", CANCELLED: "لغو" };

/** بدنه در iframe بدون اسکریپت (sandbox) نمایش داده می‌شود؛ HTML از سرور هم پاک‌سازی شده است (دو لایه). */
function BodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>body{font-family:Vazirmatn,Tahoma,sans-serif;font-size:14px;line-height:2;margin:0;padding:4px;color:#0f172a;word-break:break-word}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      title="متن نامه"
      sandbox="allow-same-origin"
      srcDoc={doc}
      className="w-full border-0 bg-white"
      style={{ minHeight: 120 }}
      onLoad={() => {
        const d = ref.current?.contentDocument;
        if (d && ref.current) ref.current.style.height = `${d.documentElement.scrollHeight + 8}px`;
      }}
    />
  );
}

export function LetterDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [l, setL] = useState<LetterDetail | null>(null);
  const [me, setMe] = useState<CorrMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [busy, setBusy] = useState(false);
  const [revs, setRevs] = useState<Awaited<ReturnType<typeof fetchRevisions>> | null>(null);
  const [receipts, setReceipts] = useState<{ id: string; title: string }[]>([]);
  const seenDone = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchLetter(id);
      setL(d);
      setError(null);
    } catch (e) {
      setError(errText(e, "نامه یافت نشد یا دسترسی ندارید"));
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    fetchCorrMe().then(setMe).catch(() => {});
  }, [load]);

  // دیده‌شدن ارجاع پس از باز کردن نامه توسط گیرنده
  useEffect(() => {
    if (!l || !me?.userId || seenDone.current) return;
    const mine = l.referrals.find((r) => r.toUserId === me.userId && r.status === "PENDING");
    if (mine) {
      seenDone.current = true;
      referralSeen(mine.id).then(() => load()).catch(() => {});
    }
  }, [l, me, load]);

  useEffect(() => {
    if (dlg?.k === "delivered") fetchAttachments("LetterReceipt", id).then((a) => setReceipts(a.map((x) => ({ id: x.id, title: x.title })))).catch(() => {});
  }, [dlg, id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function openPdf(fn: () => Promise<string>) {
    try {
      await openPdfInTab(fn);
    } catch (e) {
      setError(errText(e));
    }
  }

  if (error && !l) return <div className="space-y-3"><ErrorBox>{error}</ErrorBox><Link href="/correspondence" className={BTN_SOFT}>بازگشت به کارتابل</Link></div>;
  if (!l) return <Loading />;

  const f = l.flags;
  const incoming = l.type === "INCOMING";
  const done = () => { setDlg(null); void load(); };
  const myOpenRefs = l.referrals.filter((r) => r.toUserId === me?.userId && ["PENDING", "SEEN"].includes(r.status));
  const showEditor = !incoming && f.canEdit;

  return (
    <div className="space-y-4">
      {/* سرتیتر */}
      <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <TypeBadge type={l.type} /><StatusBadge status={l.status} /><PriorityBadge priority={l.priority} /><ConfBadge level={l.confidentiality} />
          {l.archivedAt ? <Badge tone="neutral">بایگانی‌شده</Badge> : null}
          {l.voidedAt ? <Badge tone="danger">باطل</Badge> : null}
        </div>
        <h2 className="text-lg font-extrabold mt-2 break-words">{l.subject || "(بدون موضوع)"}</h2>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
          <div><span className="text-muted">{incoming ? "شماره‌ی دبیرخانه: " : "شماره‌ی نامه: "}</span><bdi dir="ltr" className="font-bold">{l.letterNumber ? toPersianDigits(l.letterNumber) : "هنوز شماره نخورده"}</bdi></div>
          {incoming ? (
            <>
              <div><span className="text-muted">شماره‌ی نامه‌ی اصلی: </span><bdi dir="ltr" className="font-bold">{fa(l.externalNumber)}</bdi></div>
              <div><span className="text-muted">تاریخ نامه‌ی اصلی: </span>{dateFa(l.externalDate)}</div>
              <div><span className="text-muted">تاریخ دریافت: </span>{dateFa(l.receivedAt)}</div>
              <div><span className="text-muted">فرستنده: </span>{[l.senderOrgName, l.senderName].filter(Boolean).join(" - ") || "—"}</div>
              <div><span className="text-muted">روش دریافت: </span>{l.deliveryMethod ? DELIVERY_LABELS[l.deliveryMethod] ?? l.deliveryMethod : "—"}</div>
              <div><span className="text-muted">تعداد برگ: </span>{fa(l.pageCount)}</div>
              <div><span className="text-muted">ثبت‌کننده: </span>{l.registeredByName ?? "—"} · {dateTimeFa(l.registeredAt)}</div>
              <div><span className="text-muted">مهلت پاسخ: </span>{dateFa(l.responseDueAt)}</div>
            </>
          ) : (
            <>
              <div><span className="text-muted">تاریخ: </span>{dateFa(l.letterDate)}</div>
              <div><span className="text-muted">گیرنده: </span>{l.recipients.map((r) => r.name).join("، ") || "—"}</div>
              {l.ccNames.length ? <div><span className="text-muted">رونوشت: </span>{l.ccNames.join("، ")}</div> : null}
              <div><span className="text-muted">امضاکننده: </span>{l.signerName ?? "—"}{l.signerTitle ? ` (${l.signerTitle})` : ""}</div>
            </>
          )}
          <div><span className="text-muted">دسته: </span>{l.category?.name ?? "—"}</div>
          <div><span className="text-muted">ایجادکننده: </span>{l.createdByName ?? "—"}</div>
          {l.attachmentsText ? <div className="sm:col-span-2"><span className="text-muted">پیوست‌ها: </span>{l.attachmentsText}</div> : null}
          {l.voidReason ? <div className="sm:col-span-2 text-danger">دلیل ابطال: {l.voidReason}</div> : null}
          {l.lastReturnNote && ["RETURNED_FOR_EDIT", "REJECTED"].includes(l.status) ? <div className="sm:col-span-2 text-danger">توضیح: {l.lastReturnNote}</div> : null}
        </div>
        {l.replyTo ? <div className="mt-2 text-[12.5px]">در پاسخ به: <Link className="text-primary underline" href={`/correspondence/${l.replyTo.id}`}>{l.replyTo.letterNumber ? toPersianDigits(l.replyTo.letterNumber) : l.replyTo.subject}</Link></div> : null}
        {l.correctionOf ? <div className="mt-1 text-[12.5px]">اصلاحیه‌ی: <Link className="text-primary underline" href={`/correspondence/${l.correctionOf.id}`}>{l.correctionOf.letterNumber ? toPersianDigits(l.correctionOf.letterNumber) : l.correctionOf.subject}</Link></div> : null}
        {l.replies.length ? <div className="mt-1 text-[12.5px]">پاسخ‌ها: {l.replies.map((r) => <Link key={r.id} className="text-primary underline me-2" href={`/correspondence/${r.id}`}>{r.letterNumber ? toPersianDigits(r.letterNumber) : "پیش‌نویس"}</Link>)}</div> : null}
        {l.corrections.length ? <div className="mt-1 text-[12.5px]">اصلاحیه‌ها: {l.corrections.map((r) => <Link key={r.id} className="text-primary underline me-2" href={`/correspondence/${r.id}`}>{r.letterNumber ? toPersianDigits(r.letterNumber) : "پیش‌نویس"}</Link>)}</div> : null}

        {/* اقدام‌ها */}
        <div className="flex flex-wrap gap-2 mt-4">
          {f.canSubmit && !showEditor ? <button className={BTN_PRIMARY} onClick={() => setDlg({ k: "submit" })}>ارجاع برای امضا</button> : null}
          {f.canSign ? <button className={BTN_PRIMARY} onClick={() => setDlg({ k: "sign" })}>امضا</button> : null}
          {f.canReturn ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "return" })}>برگشت برای اصلاح</button> : null}
          {f.canReject ? <button className={BTN_DANGER} onClick={() => setDlg({ k: "reject" })}>رد</button> : null}
          {f.canReview ? <button className={BTN_PRIMARY} onClick={() => setDlg({ k: "review" })}>بازبینی</button> : null}
          {f.canRefer ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "refer" })}>ارجاع</button> : null}
          {f.canParaph ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "paraph" })}>پاراف</button> : null}
          {f.canSend ? <button className={BTN_PRIMARY} onClick={() => setDlg({ k: "sent" })}>ثبت ارسال</button> : null}
          {f.canDeliver ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "delivered" })}>ثبت تحویل</button> : null}
          {f.canReply ? <button className={BTN_PRIMARY} disabled={busy} onClick={() => run(async () => { const r = await replyToLetter(l.id); router.push(`/correspondence/${r.id}`); })}>پاسخ (نامه‌ی صادره)</button> : null}
          {f.canFollowup ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "followup" })}>پیگیری بیرونی</button> : null}
          {f.canCorrect ? <button className={BTN_SOFT} disabled={busy} onClick={() => run(async () => { const r = await createCorrection(l.id); router.push(`/correspondence/${r.id}`); })}>ایجاد اصلاحیه</button> : null}
          {incoming && f.canEdit ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "editIncoming" })}>ویرایش مشخصات</button> : null}
          {f.canClose ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "close" })}>مختومه</button> : null}
          {f.canReopen ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "reopen" })}>بازگشایی</button> : null}
          {f.canArchive ? <button className={BTN_SOFT} onClick={() => setDlg({ k: "archive" })}>بایگانی</button> : null}
          {f.canUnarchive ? <button className={BTN_SOFT} disabled={busy} onClick={() => run(() => unarchiveLetter(l.id))}>خروج از بایگانی</button> : null}
          {l.letterNumber && !incoming ? <button className={BTN_SOFT} onClick={() => void openPdf(() => letterPdfUrl(l.id))}>{l.hasSnapshot ? "PDF امضاشده" : "PDF"}</button> : null}
          {!incoming && l.hasSnapshot && l.paraphs.length ? <button className={BTN_SOFT} onClick={() => void openPdf(() => letterPdfUrl(l.id, true))}>PDF با پاراف‌های فعلی</button> : null}
          {!l.letterNumber && !incoming ? <button className={BTN_SOFT} onClick={() => void openPdf(() => letterPdfUrl(l.id))}>پیش‌نمایش PDF</button> : null}
          {incoming && l.letterNumber ? (
            <>
              <button className={BTN_SOFT} onClick={() => void openPdf(() => slipPdfUrl(l.id, "slip"))}>چاپ برگ ثبت / رسید</button>
              <button className={BTN_SOFT} onClick={() => void openPdf(() => slipPdfUrl(l.id, "label"))}>چاپ برچسب</button>
            </>
          ) : null}
          {f.canVoid ? <button className={BTN_DANGER} onClick={() => setDlg({ k: "void" })}>ابطال</button> : null}
        </div>
        {error ? <div className="mt-3"><ErrorBox>{error}</ErrorBox></div> : null}
      </div>

      {/* ارجاع‌های باز من */}
      {myOpenRefs.map((r) => (
        <div key={r.id} className="rounded-2xl border border-primary/30 bg-primary-soft/40 p-4 space-y-2">
          <div className="text-[13px] font-extrabold">به شما ارجاع شده است ({r.kind === "INFO" ? "جهت اطلاع" : "جهت اقدام"})</div>
          <div className="text-[12.5px]">از: {r.fromName ?? "—"}{r.dueAt ? ` · مهلت: ${dateFa(r.dueAt)}` : ""}</div>
          {r.instruction ? <div className="text-[13px] break-words">دستور: {r.instruction}</div> : null}
          <div className="flex gap-2 flex-wrap">
            <button className={BTN_PRIMARY} onClick={() => setDlg({ k: "refDone", id: r.id })}>انجام شد</button>
            <button className={BTN_SOFT} onClick={() => setDlg({ k: "forward", id: r.id })}>ارجاع به دیگری</button>
            <button className={BTN_SOFT} onClick={() => setDlg({ k: "refReturn", id: r.id })}>برگشت</button>
          </div>
        </div>
      ))}

      {showEditor ? (
        <LetterEditor letter={l} onChanged={() => void load()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
          <div className="space-y-4 min-w-0">
            <Section title={incoming ? "توضیحات / خلاصه‌ی نامه" : "متن نامه"}>
              {l.bodyHtml ? <BodyFrame html={l.bodyHtml} /> : <Empty>{incoming ? "متنی ثبت نشده است؛ اسکن نامه را در پیوست‌ها ببینید." : "متنی ندارد"}</Empty>}
            </Section>
            {incoming ? (
              <Section title="اسکن نامه‌ی اصلی">
                <p className="text-[11.5px] text-muted mb-2">اسکن اصلی قابل حذف یا تغییر نام نیست؛ صفحه‌ی اصلاحی را به‌عنوان صفحه‌ی جدید اضافه کنید.</p>
                <AttachmentsSection entityType="LetterScan" entityId={l.id} readOnly={!!l.voidedAt || !!l.archivedAt} capture />
              </Section>
            ) : null}
            <Section title="پیوست‌ها">
              <AttachmentsSection entityType="Letter" entityId={l.id} readOnly={!!l.voidedAt || !!l.archivedAt || (!incoming && !f.canEdit)} capture={incoming} />
            </Section>
            {!incoming && ["ISSUED", "SENT", "DELIVERED"].includes(l.status) ? (
              <Section title="رسید تحویل">
                <p className="text-[11.5px] text-muted mb-2">پس از امضا فقط رسید تحویل اضافه می‌شود (حذف و تغییر نام ممکن نیست).</p>
                <AttachmentsSection entityType="LetterReceipt" entityId={l.id} readOnly={!!l.voidedAt || !!l.archivedAt} capture />
              </Section>
            ) : null}
            {l.paraphs.length ? (
              <Section title="پاراف‌ها">
                <div className="space-y-2">
                  {l.paraphs.map((p) => (
                    <div key={p.id} className="border border-border rounded-xl p-3">
                      <div className="text-[13px] break-words">{p.text}</div>
                      <div className="text-[11.5px] text-muted mt-1">{p.authorName}{p.authorTitle ? ` (${p.authorTitle})` : ""} · {dateTimeFa(p.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
            {l.deliveries.length ? (
              <Section title="ارسال و تحویل">
                {l.deliveries.map((d) => (
                  <div key={d.id} className="text-[12.5px] border-b border-border last:border-0 py-2">
                    {DELIVERY_LABELS[d.method] ?? d.method}{d.recipientName ? ` · ${d.recipientName}` : ""}{d.trackingCode ? ` · رهگیری ${d.trackingCode}` : ""} · ارسال: {dateFa(d.sentAt)}{d.deliveredAt ? ` · تحویل: ${dateFa(d.deliveredAt)}` : ""}{d.receiptReceivedAt ? " · رسید دریافت شد" : ""}
                  </div>
                ))}
              </Section>
            ) : null}
          </div>

          <div className="space-y-4 min-w-0">
            <Section title="ارجاع‌ها">
              {l.referrals.length === 0 ? <p className="text-[12.5px] text-muted">ارجاعی ثبت نشده است.</p> : (
                <ol className="space-y-2">
                  {l.referrals.map((r) => (
                    <li key={r.id} className="border border-border rounded-xl p-3 text-[12.5px]" style={{ marginInlineStart: r.parentReferralId ? 14 : 0 }}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold">{r.fromName ?? "—"} ← {r.toName ?? "—"}</span>
                        <Badge tone={r.status === "DONE" ? "success" : r.status === "RETURNED" ? "danger" : r.status === "CANCELLED" ? "neutral" : "warning"}>{REF_STATUS[r.status]}</Badge>
                        {r.kind === "INFO" ? <Badge tone="neutral">رونوشت</Badge> : null}
                      </div>
                      {r.instruction ? <div className="mt-1 break-words">دستور: {r.instruction}</div> : null}
                      <div className="text-muted mt-1">{dateTimeFa(r.createdAt)}{r.dueAt ? ` · مهلت ${dateFa(r.dueAt)}` : ""}</div>
                      {r.response ? <div className="mt-1 break-words">پاسخ: {r.response}</div> : null}
                      {["PENDING", "SEEN"].includes(r.status) && (me?.isManager || r.fromUserId === me?.userId) ? (
                        <button className="mt-1 text-danger text-[12px] min-h-[36px] cursor-pointer" onClick={() => run(() => referralCancel(r.id))}>لغو ارجاع</button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title="خط‌زمان">
              <ol className="relative border-s border-border ps-4 space-y-3">
                {l.events.map((e) => (
                  <li key={e.id} className="text-[12.5px]">
                    <span className="absolute -start-[5px] w-2.5 h-2.5 rounded-full bg-primary mt-1.5" />
                    <div className="font-bold">{EVENT_LABELS[e.type] ?? e.type}{e.type === "EXTERNAL_FOLLOWUP" && e.meta?.kind ? ` (${({ CALL: "تماس", NOTE: "یادداشت", RESPONSE: "پاسخ فرستنده" } as Record<string, string>)[String(e.meta.kind)] ?? ""})` : ""}</div>
                    <div className="text-muted">{e.actorName ?? "سیستم"} · {dateTimeFa(e.createdAt)}</div>
                    {e.note && e.type !== "REMINDER" ? <div className="mt-0.5 break-words">{e.note}</div> : null}
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="نسخه‌ها و ویرایش‌ها" right={revs === null ? <button className="text-[12px] text-primary underline min-h-[36px] cursor-pointer" onClick={() => fetchRevisions(l.id).then(setRevs).catch((e) => setError(errText(e)))}>نمایش</button> : null}>
              {revs === null ? <p className="text-[12.5px] text-muted">نسخه‌ی فعلی: {fa(l.revisionNo)}</p> : revs.length === 0 ? <p className="text-[12.5px] text-muted">ویرایشی ثبت نشده است.</p> : (
                <div className="space-y-2">
                  {revs.map((r) => (
                    <details key={r.id} className="border border-border rounded-xl p-3 text-[12.5px]">
                      <summary className="cursor-pointer font-bold">نسخه {fa(r.revisionNo)} · {r.actorName ?? "—"} · {dateTimeFa(r.createdAt)}</summary>
                      {r.reason ? <div className="mt-1">دلیل: {r.reason}</div> : null}
                      {r.changedFields.map((k) => (
                        <div key={k} className="mt-2">
                          <div className="font-semibold">{k}</div>
                          <div className="bg-danger-soft/50 rounded-lg p-2 mt-0.5 break-words" dir="auto">{String(typeof r.before[k] === "string" ? (r.before[k] as string).replace(/<[^>]*>/g, " ").slice(0, 400) : JSON.stringify(r.before[k] ?? "")).slice(0, 400)}</div>
                          <div className="bg-success-soft/50 rounded-lg p-2 mt-1 break-words" dir="auto">{String(typeof r.after[k] === "string" ? (r.after[k] as string).replace(/<[^>]*>/g, " ").slice(0, 400) : JSON.stringify(r.after[k] ?? "")).slice(0, 400)}</div>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              )}
            </Section>

            {l.reviews.length ? (
              <Section title="بازبینی‌ها">
                {l.reviews.map((r) => <div key={r.id} className="text-[12.5px] py-1">{r.reviewerName ?? "—"}: {r.status === "APPROVED" ? "تأیید" : r.status === "CHANGES_REQUESTED" ? "نیازمند اصلاح" : "در انتظار"}{r.note ? ` — ${r.note}` : ""}</div>)}
              </Section>
            ) : null}
            {l.signedAt && f.canViewEvidence ? <Section title="مدرک امضا"><SignatureEvidencePanel entityType="correspondence_letter" entityId={l.id} /></Section> : null}
          </div>
        </div>
      )}

      {dlg?.k === "submit" ? <SubmitDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "sign" ? <SignDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "review" ? <ReviewDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "refer" ? <ReferDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} excludeIds={me?.userId ? [me.userId] : []} /> : null}
      {dlg?.k === "paraph" ? <ParaphDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "sent" ? <SentDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "delivered" ? <DeliveredDialog letterId={l.id} receipts={receipts} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "followup" ? <FollowupDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "archive" ? <ArchiveDialog letterId={l.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "forward" ? <ForwardDialog referralId={dlg.id} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.k === "return" ? <ReasonDialog title="برگشت برای اصلاح" description="دلیل برگشت برای نویسنده‌ی نامه نمایش داده می‌شود." confirmLabel="برگشت" tone="primary" onConfirm={async (r) => { await returnLetter(l.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "reject" ? <ReasonDialog title="رد نامه" description="نامه رد می‌شود و شماره نمی‌خورد؛ نویسنده می‌تواند آن را دوباره بازگشایی کند." confirmLabel="رد نامه" onConfirm={async (r) => { await rejectLetter(l.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "void" ? <ReasonDialog title="ابطال نامه" description={l.letterNumber ? "نامه باطل می‌شود و شماره‌اش سوخته می‌ماند (دوباره استفاده نمی‌شود). این کار برگشت‌پذیر نیست." : "پیش‌نویس باطل می‌شود."} confirmLabel="ابطال" onConfirm={async (r) => { await voidLetter(l.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "reopen" ? <ReasonDialog title="بازگشایی" description="نامه به وضعیت قبل از بسته‌شدن برمی‌گردد." confirmLabel="بازگشایی" tone="primary" minLength={2} onConfirm={async (r) => { await reopenLetter(l.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "close" ? <ReasonDialog title="مختومه‌کردن نامه" description="ارجاع‌های باز لغو و نامه مختومه می‌شود. توضیح کوتاهی بنویسید." confirmLabel="مختومه" tone="primary" minLength={2} onConfirm={async (r) => { await closeLetter(l.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "refDone" ? <ReasonDialog title="اتمام ارجاع" description="نتیجه‌ی اقدام را بنویسید." confirmLabel="انجام شد" tone="primary" minLength={1} onConfirm={async (r) => { await referralDone(dlg.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "refReturn" ? <ReasonDialog title="برگشت ارجاع" description="دلیل برگشت را برای ارجاع‌دهنده بنویسید." confirmLabel="برگشت" tone="primary" minLength={1} onConfirm={async (r) => { await referralReturn(dlg.id, r); await load(); }} onClose={() => setDlg(null)} /> : null}
      {dlg?.k === "editIncoming" ? <IncomingEditDialog l={l} onClose={() => setDlg(null)} onDone={done} /> : null}
    </div>
  );
}

function IncomingEditDialog({ l, onClose, onDone }: { l: LetterDetail; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState(l.subject);
  const [externalNumber, setExternalNumber] = useState(l.externalNumber ?? "");
  const [externalDate, setExternalDate] = useState(l.externalDate?.slice(0, 10) ?? "");
  const [org, setOrg] = useState(l.senderOrgName ?? "");
  const [name, setName] = useState(l.senderName ?? "");
  const [pages, setPages] = useState(l.pageCount?.toString() ?? "");
  const [due, setDue] = useState(l.responseDueAt?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="ویرایش مشخصات نامه‌ی وارده" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await updateLetter(l.id, {
              subject, externalNumber, externalDate: externalDate ? `${externalDate}T00:00:00+03:30` : undefined, senderOrgName: org, senderName: name,
              pageCount: pages ? Number(pages) : undefined, responseDueAt: due ? `${due}T00:00:00+03:30` : null, reason,
            } as never);
            onDone();
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-[12px] text-muted">شماره‌ی دبیرخانه قابل تغییر نیست؛ هر ویرایش به‌صورت نسخه ثبت می‌شود.</p>
        <div><label className={LABEL}>موضوع</label><input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={LABEL}>شماره‌ی نامه‌ی اصلی</label><input value={externalNumber} onChange={(e) => setExternalNumber(e.target.value)} className={INPUT} dir="ltr" /></div>
          <div><label className={LABEL}>تاریخ نامه‌ی اصلی</label><JalaliDateInput value={externalDate} onChange={setExternalDate} /></div>
          <div><label className={LABEL}>سازمان فرستنده</label><input value={org} onChange={(e) => setOrg(e.target.value)} className={INPUT} /></div>
          <div><label className={LABEL}>نام فرستنده</label><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} /></div>
          <div><label className={LABEL}>تعداد برگ</label><input type="number" min={0} value={pages} onChange={(e) => setPages(e.target.value)} className={INPUT} /></div>
          <div><label className={LABEL}>مهلت پاسخ</label><JalaliDateInput value={due} onChange={setDue} /></div>
        </div>
        <div><label className={LABEL}>دلیل ویرایش (الزامی)</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} required /></div>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <div className="flex justify-end gap-2"><button type="button" className={BTN_SOFT} onClick={onClose}>انصراف</button><button type="submit" className={BTN_PRIMARY} disabled={busy || !reason.trim()}>{busy ? "…" : "ذخیره"}</button></div>
      </form>
    </Sheet>
  );
}
