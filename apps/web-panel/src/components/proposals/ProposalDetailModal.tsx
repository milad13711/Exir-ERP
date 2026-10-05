"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { formatJalaliDate, formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  addProposalStaffComment,
  assignProposal,
  createProposalTemplate,
  deleteProposal,
  fetchProposal,
  fetchProposalSmsPreview,
  fetchUsers,
  getProposalLink,
  issueProposalInvoice,
  sendProposalSms,
  setProposalStatus,
  updateProposalStatusNote,
  type ProposalDetail,
  type ProposalStatus,
  type TenantUser,
} from "@/lib/api";
import { EVENT_LABELS, PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_TONES, inputClass, labelClass } from "./constants";
import { ProposalText } from "./ProposalText";

export function ProposalDetailModal({
  id,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (id: string) => void;
}) {
  const [p, setP] = useState<ProposalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [statusDraft, setStatusDraft] = useState<ProposalStatus>("DRAFT");
  const [noteDraft, setNoteDraft] = useState("");
  const [reply, setReply] = useState("");
  const [smsPreview, setSmsPreview] = useState<{ phone: string | null; contactName: string; message: string; parts: number } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUser, setAssignUser] = useState("");
  const [assignTask, setAssignTask] = useState(true);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceDue, setInvoiceDue] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchProposal(id)
      .then((r) => {
        setP(r);
        setStatusDraft(r.status);
        setNoteDraft(r.statusNote ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "بارگذاری ناموفق بود"));
  }, [id]);
  useEffect(reload, [reload]);
  useEffect(() => {
    fetchUsers().then((u) => setUsers(u.filter((x) => x.status !== "DISABLED"))).catch(() => undefined);
  }, []);

  async function run<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (okMsg) setNotice(okMsg);
      reload();
      onChanged();
      return r;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    await run(async () => {
      const { url } = await getProposalLink(id);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt("لینک پروپوزال را کپی کنید:", url);
      }
    }, "لینک کپی شد");
  }

  async function openSms() {
    setError(null);
    try {
      setSmsPreview(await fetchProposalSmsPreview(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "آماده‌سازی پیامک ناموفق بود");
    }
  }

  if (!p) {
    return (
      <Modal title="پروپوزال" onClose={onClose} width="max-w-[760px]">
        <div className="py-8 text-center text-muted text-sm">{error ?? "در حال بارگذاری..."}</div>
      </Modal>
    );
  }

  const locked = p.status === "ACCEPTED";
  const btn = "text-[12px] font-bold px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50";

  return (
    <Modal title={`پروپوزال شماره ${toPersianDigits(p.proposalNo)}`} onClose={onClose} width="max-w-[780px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[16px] font-extrabold">{p.title}</div>
            <div className="text-[12.5px] text-muted mt-1">
              {p.contact.company || p.contact.name} · {p.contact.phone ?? "بدون شماره"}
              {p.deal ? ` · معامله: ${p.deal.title}` : ""}
            </div>
          </div>
          <Badge tone={PROPOSAL_STATUS_TONES[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={copyLink} disabled={busy} className={`${btn} bg-primary-soft text-primary`}>کپی لینک</button>
          <button onClick={openSms} disabled={busy} className={`${btn} bg-primary-soft text-primary`}>ارسال پیامک لینک</button>
          {!locked ? <button onClick={() => onEdit(id)} className={`${btn} bg-slate-100 text-ink-soft`}>ویرایش</button> : null}
          <button onClick={() => setAssignOpen((v) => !v)} className={`${btn} bg-slate-100 text-ink-soft`}>ارجاع به همکار</button>
          <button onClick={() => setTemplateName(p.title)} className={`${btn} bg-slate-100 text-ink-soft`}>ذخیره به‌عنوان قالب</button>
          {p.status === "ACCEPTED" && !p.invoiceId ? (
            <button onClick={() => setInvoiceOpen(true)} disabled={busy} className={`${btn} bg-success text-white`}>صدور فاکتور</button>
          ) : null}
        </div>

        {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}
        {notice ? <div className="text-[12.5px] text-success font-semibold">{notice}</div> : null}

        {assignOpen ? (
          <div className="border border-border rounded-xl p-3 flex flex-col gap-2 bg-slate-50">
            <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)} className={inputClass}>
              <option value="">— بدون ارجاع —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
              <input type="checkbox" checked={assignTask} onChange={(e) => setAssignTask(e.target.checked)} className="w-4 h-4" />
              ساخت وظیفه‌ی پیگیری برای همکار
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                await run(() => assignProposal(id, assignUser || null, assignTask), "ارجاع ثبت شد");
                setAssignOpen(false);
              }}
              className="py-2 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              ثبت ارجاع
            </button>
          </div>
        ) : null}

        {p.invoice ? (
          <div className="bg-success-soft text-success rounded-xl px-3.5 py-2.5 text-[12.5px] font-semibold">
            فاکتور فروش شماره {toPersianDigits(p.invoice.invoiceNo)} از این پروپوزال صادر شده است (برای مشاهده به بخش «فروش و فاکتور» بروید).
          </div>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          {[
            ["مبلغ پروژه", formatToman(p.amount)],
            ["مدت پیاده‌سازی", p.durationText || "—"],
            ["تاریخ ثبت", formatJalaliDate(p.issuedAt)],
            ["انقضا", p.validUntil ? formatJalaliDate(p.validUntil) : "—"],
            ["روش پرداخت", p.paymentMethodText || "—"],
            ["مسئول پیگیری", p.assignedTo?.name ?? "—"],
            ["تعداد بازدید", toPersianDigits(p.viewCount)],
            ["سازنده", p.createdBy?.name ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="bg-slate-50 rounded-lg px-3 py-2">
              <div className="text-muted">{k}</div>
              <div className="font-bold mt-0.5 break-words">{v}</div>
            </div>
          ))}
        </div>

        <div className="border border-border rounded-xl p-3 flex flex-col gap-2">
          <div className="text-[12.5px] font-bold">وضعیت</div>
          {locked ? (
            <div className="text-[12px] text-ink-soft leading-6">
              پروپوزال پذیرفته‌شده قفل است{p.acceptedManually ? " (ثبت دستی)" : ""}. فقط یادداشت وضعیت قابل ویرایش است.
              {p.acceptedByName ? ` تأییدکننده: ${p.acceptedByName}` : ""}
              {p.acceptedAt ? ` — ${formatJalaliDateTime(p.acceptedAt)}` : ""}
              {p.acceptedIp ? ` — IP: ${p.acceptedIp}` : ""}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as ProposalStatus)} className={inputClass}>
                {PROPOSAL_STATUSES.map((s) => (
                  <option key={s} value={s}>{PROPOSAL_STATUS_LABELS[s]}</option>
                ))}
              </select>
              <button
                disabled={busy || statusDraft === p.status}
                onClick={() => {
                  if (statusDraft === "ACCEPTED" && !window.confirm("با ثبت دستی «پذیرفته‌شده»، پروپوزال قفل می‌شود. ادامه می‌دهید؟")) return;
                  void run(() => setProposalStatus(id, statusDraft, noteDraft), "وضعیت تغییر کرد");
                }}
                className={`${btn} bg-primary text-white shrink-0`}
              >
                تغییر وضعیت
              </button>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className={labelClass}>یادداشت وضعیت</span>
            <div className="flex items-center gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} className={inputClass} maxLength={2000} />
              <button disabled={busy || noteDraft === (p.statusNote ?? "")} onClick={() => void run(() => updateProposalStatusNote(id, noteDraft), "یادداشت ذخیره شد")} className={`${btn} bg-slate-100 text-ink-soft shrink-0`}>
                ذخیره
              </button>
            </div>
          </label>
          {p.acceptedSignatureDataUrl ? (
            <div>
              <div className={labelClass}>امضای مشتری</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.acceptedSignatureDataUrl} alt="امضای مشتری" className="h-[80px] object-contain bg-slate-50 border border-border rounded-lg mt-1" />
            </div>
          ) : null}
          {p.rejectedReason ? <div className="text-[12px] text-danger">دلیل رد: {p.rejectedReason}</div> : null}
        </div>

        <div>
          <div className="text-[12.5px] font-bold mb-2">متن پروپوزال</div>
          <div className="border border-border rounded-xl p-4">{p.content ? <ProposalText text={p.content} /> : <span className="text-muted text-[12.5px]">متنی ثبت نشده</span>}</div>
          {p.paymentTerms ? <div className="text-[12.5px] mt-2 whitespace-pre-wrap"><b>شیوه‌ی پرداخت:</b> {p.paymentTerms}</div> : null}
          {p.bankInfo ? <div className="text-[12.5px] mt-1" dir="auto"><b>کارت/حساب:</b> {p.bankInfo}</div> : null}
          {p.internalNote ? <div className="text-[12px] mt-2 bg-warning-soft text-warning rounded-lg px-3 py-2 whitespace-pre-wrap">یادداشت داخلی: {p.internalNote}</div> : null}
        </div>

        <div>
          <div className="text-[12.5px] font-bold mb-2">پیوست‌ها</div>
          {locked ? <div className="text-[11.5px] text-muted mb-1">پروپوزال پذیرفته‌شده قفل است؛ افزودن/حذف پیوست غیرفعال است.</div> : null}
          <AttachmentsSection entityType="Proposal" entityId={id} />
        </div>

        <div>
          <div className="text-[12.5px] font-bold mb-2">گفتگو با مشتری</div>
          <div className="flex flex-col gap-1.5 mb-2">
            {p.comments.length === 0 ? <div className="text-[12px] text-muted">هنوز پیامی نیست</div> : null}
            {p.comments.map((c) => (
              <div key={c.id} className={`rounded-lg px-3 py-2 text-[12.5px] ${c.authorType === "CUSTOMER" ? "bg-primary-soft" : "bg-slate-100"}`}>
                <div className="flex items-center justify-between text-[11px] text-muted mb-0.5">
                  <span>
                    {c.authorName ?? (c.authorType === "CUSTOMER" ? "مشتری" : "تیم")}
                    {c.kind === "REVISION_REQUEST" ? " — درخواست اصلاح" : c.kind === "REJECTION" ? " — دلیل رد" : ""}
                  </span>
                  <span>{formatJalaliDateTime(c.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={2000} placeholder="پاسخ تیم (در صفحه‌ی مشتری هم نمایش داده می‌شود)" className={`${inputClass} resize-y`} />
            <button
              disabled={busy || !reply.trim()}
              onClick={async () => {
                await run(() => addProposalStaffComment(id, reply), undefined);
                setReply("");
              }}
              className={`${btn} bg-primary text-white shrink-0`}
            >
              ارسال
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-[12.5px] font-bold mb-2">خط زمانی</div>
            <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
              {p.events.map((e) => (
                <div key={e.id} className="text-[11.5px] bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <span className="font-bold">{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="text-muted"> · {formatJalaliDateTime(e.createdAt)}</span>
                  {e.body ? <div className="text-ink-soft">{e.body}</div> : null}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12.5px] font-bold mb-2">گزارش بازدیدها ({toPersianDigits(p.viewCount)})</div>
            <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
              {p.views.length === 0 ? <div className="text-[12px] text-muted">هنوز بازدیدی ثبت نشده</div> : null}
              {p.views.map((v) => (
                <div key={v.id} className="text-[11px] bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <div className="font-semibold">{formatJalaliDateTime(v.createdAt)} · <span dir="ltr">{v.ip ?? "—"}</span></div>
                  <div className="text-muted truncate" dir="ltr" title={v.userAgent ?? ""}>{v.userAgent ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DeleteRecordButton label="حذف پروپوزال" confirmText="این پروپوزال و پیوست‌هایش برای همیشه حذف شود؟" onDelete={() => deleteProposal(id)} onDeleted={() => { onChanged(); onClose(); }} />
      </div>

      {smsPreview ? (
        <Modal title="ارسال پیامک لینک پروپوزال" onClose={() => setSmsPreview(null)} width="max-w-[460px]">
          <div className="flex flex-col gap-3">
            <div className="text-[12.5px]">گیرنده: <b>{smsPreview.contactName}</b> — <span dir="ltr">{smsPreview.phone ?? "بدون شماره موبایل"}</span></div>
            <div className="bg-slate-50 border border-border rounded-xl p-3 text-[12.5px] leading-7 whitespace-pre-wrap" dir="auto">{smsPreview.message}</div>
            <div className="text-[11px] text-muted">{toPersianDigits(smsPreview.parts)} بخش پیامک</div>
            <div className="flex gap-2">
              <button
                disabled={busy || !smsPreview.phone}
                onClick={async () => {
                  const ok = await run(() => sendProposalSms(id), "پیامک ارسال شد");
                  if (ok) setSmsPreview(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer"
              >
                تأیید و ارسال
              </button>
              <button onClick={() => setSmsPreview(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">انصراف</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {invoiceOpen ? (
        <Modal title="صدور فاکتور از پروپوزال" onClose={() => setInvoiceOpen(false)} width="max-w-[440px]">
          <div className="flex flex-col gap-3 text-[12.5px] leading-7">
            <div>یک فاکتور فروش <b>پیش‌نویس</b> برای «{p.contact.company || p.contact.name}» به مبلغ <b>{formatToman(p.invoiceLines?.length ? p.invoiceLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) : p.amount)}</b> با روش پرداخت «کارت/حساب بانکی» ساخته می‌شود.</div>
            <div className="bg-slate-50 rounded-lg px-3 py-2" dir="auto">کارت/حساب: {p.bankInfo || "از تنظیمات فروش (پیش‌فرض)"}</div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>تاریخ سررسید (اختیاری — پیش‌فرض: تاریخ سررسید پروپوزال)</span>
              <JalaliDateInput value={invoiceDue || (p.paymentDueAt ? p.paymentDueAt.slice(0, 10) : "")} onChange={setInvoiceDue} />
            </div>
            <div className="text-[11.5px] text-muted">سررسید، مهلت پرداخت، شرایط پرداخت و شماره‌ی پروپوزال در یادداشت فاکتور ثبت می‌شود.</div>
            <button
              disabled={busy}
              onClick={async () => {
                const r = await run(() => issueProposalInvoice(id, invoiceDue ? { dueAt: invoiceDue } : {}), "فاکتور صادر شد");
                if (r) setInvoiceOpen(false);
              }}
              className="py-2.5 rounded-xl bg-success text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer"
            >
              {busy ? "در حال صدور..." : "صدور فاکتور"}
            </button>
          </div>
        </Modal>
      ) : null}

      {templateName !== null ? (
        <Modal title="ذخیره به‌عنوان قالب" onClose={() => setTemplateName(null)} width="max-w-[420px]">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>نام قالب</span>
              <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className={inputClass} maxLength={120} />
            </label>
            <div className="text-[11.5px] text-muted">متن، شرایط مالی و مبلغ ذخیره می‌شود؛ مشتری و پیوست‌ها نه.</div>
            <button
              disabled={busy || templateName.trim().length < 2}
              onClick={async () => {
                const r = await run(() => createProposalTemplate({ name: templateName.trim(), proposalId: id }), "قالب ذخیره شد");
                if (r) setTemplateName(null);
              }}
              className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer"
            >
              ذخیره‌ی قالب
            </button>
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}
