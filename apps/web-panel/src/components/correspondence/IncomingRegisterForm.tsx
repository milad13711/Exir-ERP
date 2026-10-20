"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createAttachment } from "@/lib/api";
import {
  CONF_LABELS, DELIVERY_LABELS, PRIORITY_LABELS, checkDuplicate, fetchCategories, openPdfInTab, registerIncoming, slipPdfUrl,
  type Category, type Confidentiality, type DuplicateInfo, type LetterDetail, type Priority,
} from "@/lib/correspondence-api";
import { toPersianDigits } from "@/lib/persian";
import { BTN_PRIMARY, BTN_SOFT, ErrorBox, INPUT, LABEL, PeoplePicker, Section, errText } from "./corr-ui";
import { ScanManager, type ScanPage } from "./ScanManager";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** فرم سریع «ثبت نامه‌ی وارده»: دو شماره (دبیرخانه خودکار + شماره‌ی اصلی دستی)، اسکن چندصفحه‌ای، هشدار تکراری و ارجاع فوری. */
export function IncomingRegisterForm() {
  const [subject, setSubject] = useState("");
  const [externalNumber, setExternalNumber] = useState("");
  const [externalDate, setExternalDate] = useState("");
  const [receivedAt, setReceivedAt] = useState(todayIso());
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [senderOrg, setSenderOrg] = useState("");
  const [senderName, setSenderName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [conf, setConf] = useState<Confidentiality>("NORMAL");
  const [method, setMethod] = useState("HAND");
  const [pageCount, setPageCount] = useState("");
  const [attachmentsText, setAttachmentsText] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [referNow, setReferNow] = useState(false);
  const [toIds, setToIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [refDue, setRefDue] = useState("");
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [dup, setDup] = useState<DuplicateInfo | null>(null);
  const [allowDup, setAllowDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ letter: LetterDetail & { referralError?: string }; failedScans: number } | null>(null);
  const dupSeq = useRef(0);

  useEffect(() => {
    fetchCategories().then((c) => setCats(c.filter((x) => x.isActive))).catch(() => {});
  }, []);

  const senderLabel = senderOrg || contactName || senderName;

  const dupReady = !!externalNumber.trim() && !!(contactId || senderOrg.trim() || senderName.trim() || contactName.trim());
  const dupShown = dupReady ? dup : null;

  // هشدار تکراری: پس از تکمیل (فرستنده + شماره + تاریخ) با تأخیر کوتاه
  useEffect(() => {
    const my = ++dupSeq.current;
    if (!dupReady) return;
    const t = setTimeout(() => {
      checkDuplicate({
        senderContactId: contactId || undefined, senderOrgName: (senderOrg || contactName).trim() || undefined, senderName: senderName.trim() || undefined,
        externalNumber: externalNumber.trim(), externalDate: externalDate ? `${externalDate}T00:00:00+03:30` : undefined,
      }).then((r) => { if (dupSeq.current === my) { setDup(r.hasDuplicate ? r : null); setAllowDup(false); } }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [dupReady, externalNumber, externalDate, contactId, senderOrg, senderName, contactName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim()) return setError("موضوع نامه را بنویسید");
    if (!senderLabel.trim()) return setError("فرستنده را مشخص کنید (انتخاب از مشتریان یا نوشتن نام)");
    if (referNow && toIds.length === 0) return setError("گیرنده‌ی ارجاع را انتخاب کنید یا گزینه‌ی ارجاع را بردارید");
    if (dupShown && !allowDup) return setError("نامه‌ی مشابهی قبلاً ثبت شده است؛ برای ادامه تیک «ثبت با وجود تکرار» را بزنید");
    setBusy(true);
    try {
      const letter = await registerIncoming({
        subject: subject.trim(), externalNumber: externalNumber.trim() || undefined,
        externalDate: externalDate ? `${externalDate}T00:00:00+03:30` : undefined, receivedAt: receivedAt ? `${receivedAt}T00:00:00+03:30` : undefined,
        deliveryMethod: method, senderOrgName: (senderOrg || contactName).trim() || undefined, senderName: senderName.trim() || undefined,
        senderContactId: contactId || undefined, categoryId: categoryId || undefined, priority, confidentiality: conf,
        pageCount: pageCount ? Number(pageCount) : pages.length || undefined, attachmentsText: attachmentsText.trim() || undefined,
        responseDueAt: dueAt ? `${dueAt}T00:00:00+03:30` : undefined, allowDuplicate: allowDup || undefined,
        referral: referNow ? { toUserIds: toIds, instruction: instruction.trim() || undefined, dueAt: refDue ? `${refDue}T23:59:00+03:30` : undefined } : undefined,
      });
      let failed = 0;
      for (let i = 0; i < pages.length; i++) {
        setProgress(`بارگذاری اسکن ${toPersianDigits(i + 1)} از ${toPersianDigits(pages.length)}…`);
        try {
          await createAttachment({ entityType: "LetterScan", entityId: letter.id, title: `اسکن نامه‌ی اصلی - صفحه ${i + 1}`, fileUrl: pages[i].dataUri });
        } catch {
          failed++;
        }
      }
      setDone({ letter, failedScans: failed });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function printSlip(id: string, variant: "slip" | "label") {
    try {
      await openPdfInTab(() => slipPdfUrl(id, variant));
    } catch (err) {
      setError(errText(err));
    }
  }

  if (done) {
    const l = done.letter;
    return (
      <Section title="نامه‌ی وارده ثبت شد">
        <div className="text-center py-4 space-y-2">
          <div className="text-[12px] text-muted">شماره‌ی دبیرخانه</div>
          <div dir="ltr" className="text-2xl font-extrabold text-primary break-all">{toPersianDigits(l.letterNumber ?? "")}</div>
          {l.externalNumber ? <div className="text-[12.5px] text-ink-soft">شماره‌ی نامه‌ی اصلی: <bdi>{toPersianDigits(l.externalNumber)}</bdi></div> : null}
        </div>
        {done.failedScans ? <ErrorBox>{toPersianDigits(done.failedScans)} صفحه‌ی اسکن بارگذاری نشد؛ از صفحه‌ی نامه دوباره اضافه کنید.</ErrorBox> : null}
        {l.referralError ? <ErrorBox>نامه ثبت شد ولی ارجاع انجام نشد: {l.referralError}</ErrorBox> : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <div className="flex flex-wrap gap-2 justify-center mt-4">
          <button className={BTN_PRIMARY} onClick={() => void printSlip(l.id, "slip")}>چاپ برگ ثبت / رسید</button>
          <button className={BTN_SOFT} onClick={() => void printSlip(l.id, "label")}>چاپ برچسب / مهر وارده</button>
          <Link href={`/correspondence/${l.id}`} className={BTN_SOFT}>مشاهده‌ی نامه</Link>
          <Link href="/correspondence/register-incoming" className={BTN_SOFT} onClick={() => setTimeout(() => window.location.reload(), 0)}>ثبت نامه‌ی بعدی</Link>
        </div>
      </Section>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Section title="مشخصات نامه‌ی اصلی">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={LABEL}>شماره‌ی نامه‌ی اصلی (از طرف فرستنده)</label><input value={externalNumber} onChange={(e) => setExternalNumber(e.target.value)} className={INPUT} dir="ltr" /></div>
            <div><label className={LABEL}>تاریخ نامه‌ی اصلی</label><JalaliDateInput value={externalDate} onChange={setExternalDate} /></div>
            <div className="sm:col-span-2">
              <label className={LABEL}>فرستنده (انتخاب از مشتریان)</label>
              <ContactCombobox value={contactId} onChange={(id, c) => { setContactId(id); setContactName(c ? (c.company || c.name) : ""); }} source="customer" allowCreate={false} />
            </div>
            <div><label className={LABEL}>نام سازمان فرستنده (متن آزاد)</label><input value={senderOrg} onChange={(e) => setSenderOrg(e.target.value)} className={INPUT} placeholder={contactName || "مثلاً وزارت …"} /></div>
            <div><label className={LABEL}>نام امضاکننده / فرد</label><input value={senderName} onChange={(e) => setSenderName(e.target.value)} className={INPUT} /></div>
            <div className="sm:col-span-2"><label className={LABEL}>موضوع</label><input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} required maxLength={300} /></div>
          </div>
          {dupShown ? (
            <div className="mt-3 rounded-xl bg-warning-soft text-warning text-[12.5px] px-3 py-2.5 space-y-1.5" role="alert">
              <div className="font-bold">هشدار: نامه‌ی مشابهی با همین فرستنده، شماره و تاریخ قبلاً ثبت شده است.</div>
              {dupShown.duplicates.map((d) => <div key={d.id}><Link className="underline" href={`/correspondence/${d.id}`} target="_blank">{toPersianDigits(d.letterNumber ?? "")} — {d.subject}</Link></div>)}
              {dupShown.duplicates.length === 0 ? <div>مورد مشابه وجود دارد ولی به آن دسترسی ندارید.</div> : null}
              <label className="flex items-center gap-2 cursor-pointer min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />ثبت با وجود تکرار (فقط کاربر مجاز)</label>
            </div>
          ) : null}
        </Section>

        <Section title="اطلاعات دریافت و دسته‌بندی">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={LABEL}>تاریخ دریافت</label><JalaliDateInput value={receivedAt} onChange={setReceivedAt} /></div>
            <div>
              <label className={LABEL}>روش دریافت</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT}>{Object.entries(DELIVERY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div>
              <label className={LABEL}>دسته</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT}>
                <option value="">بدون دسته</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>مهلت پاسخ</label><JalaliDateInput value={dueAt} onChange={setDueAt} placeholder="اختیاری" /></div>
            <div>
              <label className={LABEL}>فوریت</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={INPUT}>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div>
              <label className={LABEL}>محرمانگی</label>
              <select value={conf} onChange={(e) => setConf(e.target.value as Confidentiality)} className={INPUT}>{Object.entries(CONF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div><label className={LABEL}>تعداد برگ</label><input type="number" min={0} inputMode="numeric" value={pageCount} onChange={(e) => setPageCount(e.target.value)} className={INPUT} placeholder={pages.length ? String(pages.length) : ""} /></div>
            <div><label className={LABEL}>پیوست‌ها (توضیح)</label><input value={attachmentsText} onChange={(e) => setAttachmentsText(e.target.value)} className={INPUT} placeholder="مثلاً ۲ فقره سی‌دی" /></div>
          </div>
        </Section>

        <Section title="ارجاع فوری هنگام ثبت" right={<label className="flex items-center gap-2 text-[13px] cursor-pointer min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={referNow} onChange={(e) => setReferNow(e.target.checked)} />ارجاع بده</label>}>
          {referNow ? (
            <div className="space-y-3">
              <PeoplePicker value={toIds} onChange={setToIds} multiple />
              <div><label className={LABEL}>دستور ارجاع</label><textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} className={INPUT} maxLength={2000} /></div>
              <div><label className={LABEL}>مهلت اقدام</label><JalaliDateInput value={refDue} onChange={setRefDue} placeholder="اختیاری" /></div>
            </div>
          ) : <p className="text-[12.5px] text-muted">پس از ثبت، شماره‌ی دبیرخانه صادر و نامه در وضعیت «ثبت‌شده» می‌ماند؛ یا همین‌جا آن را ارجاع دهید تا «ارجاع‌شده» شود.</p>}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="اسکن نامه‌ی اصلی">
          <ScanManager pages={pages} onChange={setPages} />
        </Section>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <div className="flex gap-2 justify-end sticky bottom-3">
          <Link href="/correspondence/incoming" className={BTN_SOFT}>انصراف</Link>
          <button type="submit" className={BTN_PRIMARY} disabled={busy}>{busy ? progress ?? "در حال ثبت…" : "ثبت و صدور شماره‌ی دبیرخانه"}</button>
        </div>
      </div>
    </form>
  );
}
