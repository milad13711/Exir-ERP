"use client";

import { useEffect, useState, type ReactNode } from "react";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { SignatureConsentNotice } from "@/components/ui/SignatureConsentNotice";
import { useWorkspace } from "@/lib/workspace-context";
import { collectSignatureEvidence } from "@/lib/signature-evidence";
import {
  DELIVERY_LABELS, addFollowup, addParaph, archiveLetter, fetchFolders, markDelivered, markSent, referLetter, referralForward, reviewLetter, signLetter,
  submitForSignature, type ArchiveFolder,
} from "@/lib/correspondence-api";
import { BTN_PRIMARY, BTN_SOFT, ErrorBox, INPUT, LABEL, PeoplePicker, Sheet, errText } from "./corr-ui";

function Form({ title, onClose, onSubmit, submitLabel, children, busyLabel = "در حال انجام…", disabled }: {
  title: string; onClose: () => void; onSubmit: () => Promise<void>; submitLabel: string; children: ReactNode; busyLabel?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit();
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <div className="flex gap-2 justify-end">
          <button type="button" className={BTN_SOFT} onClick={onClose}>انصراف</button>
          <button type="submit" className={BTN_PRIMARY} disabled={busy || disabled}>{busy ? busyLabel : submitLabel}</button>
        </div>
      </form>
    </Sheet>
  );
}

type Done = { onClose: () => void; onDone: () => void };

export function SubmitDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [signer, setSigner] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [withReview, setWithReview] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Form title="ارجاع برای امضا" onClose={onClose} submitLabel="ارسال برای امضا" disabled={signer.length === 0} onSubmit={async () => {
      await submitForSignature(letterId, { signerUserId: signer[0], reviewerUserIds: withReview ? reviewers : undefined, note: note.trim() || undefined });
      onDone();
    }}>
      <div><label className={LABEL}>امضاکننده (مدیر)</label><PeoplePicker value={signer} onChange={setSigner} placeholder="جست‌وجوی مدیر امضاکننده…" /></div>
      <label className="flex items-center gap-2 text-[13px] cursor-pointer min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={withReview} onChange={(e) => setWithReview(e.target.checked)} />پیش از امضا بازبینی شود</label>
      {withReview ? <div><label className={LABEL}>بازبین‌ها</label><PeoplePicker value={reviewers} onChange={setReviewers} multiple excludeIds={signer} /></div> : null}
      <div><label className={LABEL}>یادداشت برای امضاکننده (اختیاری)</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={INPUT} maxLength={1000} /></div>
      <p className="text-[12px] text-muted">پس از ارسال، متن نامه تا برگشت‌خوردن قابل ویرایش نیست.</p>
    </Form>
  );
}

export function SignDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const { me } = useWorkspace();
  const manager = me?.permissions?.manager ?? false;
  const [confirm, setConfirm] = useState(false);
  const [useStamp, setUseStamp] = useState(false);
  return (
    <Form title="امضای نامه" onClose={onClose} submitLabel="امضا و صدور شماره" busyLabel="در حال امضا و ساخت PDF…" disabled={!confirm} onSubmit={async () => {
      const evidence = await collectSignatureEvidence();
      await signLetter(letterId, { confirm: true, useStamp: useStamp || undefined, evidence });
      onDone();
    }}>
      <p className="text-[13px] leading-7">با امضا، شماره‌ی نامه به‌صورت خودکار صادر و یک PDF تغییرناپذیر همراه QR صحت‌سنجی ساخته می‌شود. پس از آن نامه قابل ویرایش نیست.</p>
      <SignatureConsentNotice />
      {manager ? <label className="flex items-center gap-2 text-[13px] cursor-pointer min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={useStamp} onChange={(e) => setUseStamp(e.target.checked)} />درج امضا و مهر ثبت‌شده‌ی شرکت (فقط مالک یا نماینده‌ی مهر)</label> : null}
      <label className="flex items-start gap-2 text-[13px] cursor-pointer min-h-[40px]"><input type="checkbox" className="w-5 h-5 mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />متن نامه را خوانده‌ام و امضای آن را تأیید می‌کنم.</label>
    </Form>
  );
}

export function ReviewDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"APPROVE" | "CHANGES">("APPROVE");
  return (
    <Form title="بازبینی نامه" onClose={onClose} submitLabel="ثبت نظر" disabled={decision === "CHANGES" && !note.trim()} onSubmit={async () => { await reviewLetter(letterId, { decision, note: note.trim() || undefined }); onDone(); }}>
      <div className="flex gap-2">
        <button type="button" className={decision === "APPROVE" ? BTN_PRIMARY : BTN_SOFT} onClick={() => setDecision("APPROVE")}>تأیید</button>
        <button type="button" className={decision === "CHANGES" ? BTN_PRIMARY : BTN_SOFT} onClick={() => setDecision("CHANGES")}>نیازمند اصلاح</button>
      </div>
      <div><label className={LABEL}>توضیح{decision === "CHANGES" ? " (الزامی)" : ""}</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={INPUT} /></div>
    </Form>
  );
}

export function ReferDialog({ letterId, onClose, onDone, excludeIds }: Done & { letterId: string; excludeIds?: string[] }) {
  const [to, setTo] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [due, setDue] = useState("");
  const [kind, setKind] = useState<"ACTION" | "INFO">("ACTION");
  return (
    <Form title="ارجاع نامه" onClose={onClose} submitLabel="ارجاع" disabled={to.length === 0} onSubmit={async () => {
      await referLetter(letterId, { toUserIds: to, instruction: instruction.trim() || undefined, dueAt: due ? `${due}T23:59:00+03:30` : undefined, kind });
      onDone();
    }}>
      <div className="flex gap-2">
        <button type="button" className={kind === "ACTION" ? BTN_PRIMARY : BTN_SOFT} onClick={() => setKind("ACTION")}>جهت اقدام</button>
        <button type="button" className={kind === "INFO" ? BTN_PRIMARY : BTN_SOFT} onClick={() => setKind("INFO")}>رونوشت / جهت اطلاع</button>
      </div>
      <div><label className={LABEL}>گیرندگان (می‌توانید چند نفر را انتخاب کنید)</label><PeoplePicker value={to} onChange={setTo} multiple excludeIds={excludeIds} /></div>
      <div><label className={LABEL}>دستور</label><textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} className={INPUT} maxLength={2000} /></div>
      {kind === "ACTION" ? <div><label className={LABEL}>مهلت اقدام</label><JalaliDateInput value={due} onChange={setDue} placeholder="اختیاری" /></div> : null}
    </Form>
  );
}

export function ForwardDialog({ referralId, onClose, onDone }: Done & { referralId: string }) {
  const [to, setTo] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [due, setDue] = useState("");
  return (
    <Form title="ارجاع مجدد به دیگری" onClose={onClose} submitLabel="ارجاع مجدد" disabled={to.length === 0} onSubmit={async () => {
      await referralForward(referralId, { toUserIds: to, instruction: instruction.trim() || undefined, dueAt: due ? `${due}T23:59:00+03:30` : undefined });
      onDone();
    }}>
      <div><label className={LABEL}>گیرندگان</label><PeoplePicker value={to} onChange={setTo} multiple /></div>
      <div><label className={LABEL}>دستور</label><textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} className={INPUT} /></div>
      <div><label className={LABEL}>مهلت</label><JalaliDateInput value={due} onChange={setDue} placeholder="اختیاری" /></div>
    </Form>
  );
}

export function ParaphDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [text, setText] = useState("");
  return (
    <Form title="پاراف" onClose={onClose} submitLabel="ثبت پاراف" disabled={!text.trim()} onSubmit={async () => { await addParaph(letterId, text.trim()); onDone(); }}>
      <div><label className={LABEL}>متن پاراف (زیر نامه چاپ می‌شود)</label><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={INPUT} maxLength={1000} autoFocus /></div>
      <p className="text-[12px] text-warning">پاراف پس از ثبت قابل ویرایش یا حذف نیست.</p>
    </Form>
  );
}

export function SentDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [method, setMethod] = useState("COURIER");
  const [tracking, setTracking] = useState("");
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  return (
    <Form title="ثبت ارسال نامه" onClose={onClose} submitLabel="ثبت ارسال" onSubmit={async () => {
      await markSent(letterId, { method, trackingCode: tracking.trim() || undefined, recipientName: who.trim() || undefined, note: note.trim() || undefined });
      onDone();
    }}>
      <div><label className={LABEL}>روش ارسال</label><select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT}>{Object.entries(DELIVERY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className={LABEL}>کد رهگیری</label><input value={tracking} onChange={(e) => setTracking(e.target.value)} className={INPUT} dir="ltr" /></div>
      <div><label className={LABEL}>تحویل‌گیرنده / پیک</label><input value={who} onChange={(e) => setWho(e.target.value)} className={INPUT} /></div>
      <div><label className={LABEL}>توضیح</label><input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} /></div>
    </Form>
  );
}

export function DeliveredDialog({ letterId, receipts, onClose, onDone }: Done & { letterId: string; receipts: { id: string; title: string }[] }) {
  const [receipt, setReceipt] = useState("");
  const [note, setNote] = useState("");
  return (
    <Form title="ثبت تحویل نامه" onClose={onClose} submitLabel="ثبت تحویل" onSubmit={async () => { await markDelivered(letterId, { receiptAttachmentId: receipt || undefined, note: note.trim() || undefined }); onDone(); }}>
      <div>
        <label className={LABEL}>فایل رسید تحویل (ابتدا در بخش «رسید تحویل» بارگذاری کنید)</label>
        <select value={receipt} onChange={(e) => setReceipt(e.target.value)} className={INPUT}><option value="">بدون رسید</option>{receipts.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
      </div>
      <div><label className={LABEL}>توضیح</label><input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} /></div>
    </Form>
  );
}

export function FollowupDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"NOTE" | "CALL" | "RESPONSE">("CALL");
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Form title="ثبت پیگیری بیرونی" onClose={onClose} submitLabel="ثبت" disabled={!text.trim()} onSubmit={async () => { await addFollowup(letterId, { text: text.trim(), kind, at: at ? `${at}T12:00:00+03:30` : undefined }); onDone(); }}>
      <div className="flex gap-2 flex-wrap">
        {([["CALL", "تماس"], ["NOTE", "یادداشت"], ["RESPONSE", "پاسخ فرستنده"]] as const).map(([k, l]) => <button key={k} type="button" className={kind === k ? BTN_PRIMARY : BTN_SOFT} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div><label className={LABEL}>تاریخ</label><JalaliDateInput value={at} onChange={setAt} /></div>
      <div><label className={LABEL}>شرح پیگیری با فرستنده</label><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={INPUT} maxLength={3000} /></div>
    </Form>
  );
}

export function ArchiveDialog({ letterId, onClose, onDone }: Done & { letterId: string }) {
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [retention, setRetention] = useState("");
  useEffect(() => {
    fetchFolders().then(setFolders).catch(() => {});
  }, []);
  return (
    <Form title="بایگانی نامه" onClose={onClose} submitLabel="بایگانی" onSubmit={async () => { await archiveLetter(letterId, { folderId: folderId || undefined, retentionUntil: retention ? `${retention}T00:00:00+03:30` : undefined }); onDone(); }}>
      <div><label className={LABEL}>پوشه</label><select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={INPUT}><option value="">بدون پوشه</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
      <div><label className={LABEL}>نگهداری تا (اختیاری؛ در صورت خالی بودن از پوشه گرفته می‌شود)</label><JalaliDateInput value={retention} onChange={setRetention} /></div>
    </Form>
  );
}
