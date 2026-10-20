"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { ContactCombobox } from "@/components/shared/ContactCombobox";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  CONF_LABELS, PRIORITY_LABELS, createLetter, fetchCategories, previewNumber, updateLetter,
  type Category, type Confidentiality, type LetterDetail, type Priority, type Recipient,
} from "@/lib/correspondence-api";
import {
  fetchCorrTemplates, fetchLetterheads, previewLetterPdfUrl, renderCorrTemplate, type CorrTemplate, type Letterhead,
} from "@/lib/correspondence-docs-api";
import { RichTextEditor } from "./RichTextEditor";
import { BTN_PRIMARY, BTN_SOFT, ErrorBox, INPUT, LABEL, PeoplePicker, Section, errText, usePeople } from "./corr-ui";
import { SubmitDialog } from "./LetterDialogs";

type Props = { letter?: LetterDetail; type?: "OUTGOING" | "INTERNAL"; replyToLetterId?: string; onChanged?: () => void };

const isoDay = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

/** ویرایشگر نامه‌ی صادره/داخلی: قالب، سربرگ، گیرندگان، متن غنی، پیش‌نمایش زنده‌ی PDF، پیوست و ذخیره‌ی خودکار. */
export function LetterEditor({ letter, type: typeProp, onChanged }: Props) {
  const router = useRouter();
  const type = (letter?.type as "OUTGOING" | "INTERNAL" | undefined) ?? typeProp ?? "OUTGOING";
  const [id, setId] = useState<string | undefined>(letter?.id);
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(letter?.updatedAt);
  const [subject, setSubject] = useState(letter?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(letter?.bodyHtml ?? "");
  const [recipients, setRecipients] = useState<Recipient[]>(letter?.recipients ?? []);
  const [ccNames, setCcNames] = useState((letter?.ccNames ?? []).join("، "));
  const [categoryId, setCategoryId] = useState(letter?.categoryId ?? "");
  const [priority, setPriority] = useState<Priority>(letter?.priority ?? "NORMAL");
  const [conf, setConf] = useState<Confidentiality>(letter?.confidentiality ?? "NORMAL");
  const [letterDate, setLetterDate] = useState(isoDay(letter?.letterDate) || new Date().toISOString().slice(0, 10));
  const [attachmentsText, setAttachmentsText] = useState(letter?.attachmentsText ?? "");
  const [letterheadId, setLetterheadId] = useState(letter?.letterheadId ?? "");
  const [templateId, setTemplateId] = useState(letter?.templateId ?? "");
  const [cats, setCats] = useState<Category[]>([]);
  const [heads, setHeads] = useState<Letterhead[]>([]);
  const [templates, setTemplates] = useState<CorrTemplate[] | null>(null);
  const [nextNo, setNextNo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [internalPick, setInternalPick] = useState<string[]>([]);
  const people = usePeople();
  const savingRef = useRef(false);

  useEffect(() => {
    fetchCategories().then((c) => setCats(c.filter((x) => x.isActive))).catch(() => {});
    fetchLetterheads().then((h) => setHeads(h.filter((x) => x.isActive))).catch(() => {});
    fetchCorrTemplates({ letterType: type, activeOnly: true }).then(setTemplates).catch(() => setTemplates([]));
    previewNumber(type, undefined).then((r) => setNextNo(r.next ?? null)).catch(() => {});
  }, [type]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const payload = useCallback(
    () => ({
      subject, bodyHtml, recipients: recipients.filter((r) => r.name.trim()), ccNames: ccNames.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean),
      categoryId: categoryId || null, priority, confidentiality: conf, letterDate: letterDate ? `${letterDate}T08:00:00+03:30` : undefined,
      attachmentsText, letterheadId: letterheadId || null, templateId: templateId || null,
    }),
    [subject, bodyHtml, recipients, ccNames, categoryId, priority, conf, letterDate, attachmentsText, letterheadId, templateId],
  );

  const save = useCallback(
    async (autosave: boolean): Promise<string | undefined> => {
      if (savingRef.current) return id;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const data = payload();
        let saved: LetterDetail;
        if (!id) {
          saved = await createLetter(type, { ...data, categoryId: data.categoryId ?? undefined, letterheadId: data.letterheadId ?? undefined, templateId: data.templateId ?? undefined });
          setId(saved.id);
          window.history.replaceState(null, "", `/correspondence/${saved.id}`);
        } else {
          saved = await updateLetter(id, { ...data, autosave, baseUpdatedAt: updatedAt });
        }
        setUpdatedAt(saved.updatedAt);
        setDirty(false);
        setSavedAt(new Date());
        onChanged?.();
        return saved.id;
      } catch (e) {
        setError(errText(e));
        return undefined;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [id, payload, type, updatedAt, onChanged],
  );

  // ذخیره‌ی خودکار (بدون نسخه) ۳ ثانیه پس از آخرین تغییر؛ نامه‌ی کاملاً خالی ساخته نمی‌شود
  const key = JSON.stringify(payload());
  useEffect(() => {
    if (!dirty) return;
    if (!id && !subject.trim() && !bodyHtml.trim()) return;
    const t = setTimeout(() => void save(true), 3000);
    return () => clearTimeout(t);
  }, [key, dirty, id, subject, bodyHtml, save]);

  // پیش‌نمایش زنده
  const pkey = useDebouncedValue(JSON.stringify([subject, bodyHtml, recipients, letterheadId, attachmentsText, conf, priority]), 1500);
  useEffect(() => {
    if (!previewOn) return;
    let alive = true;
    const first = recipients.find((r) => r.name.trim());
    previewLetterPdfUrl({
      letterheadId: letterheadId || undefined, subject, bodyHtml, attachmentsText: attachmentsText || undefined, recipientName: first?.name, recipientTitle: first?.title,
      confidentialityLabel: conf === "NORMAL" ? undefined : CONF_LABELS[conf], priorityLabel: priority === "NORMAL" ? undefined : PRIORITY_LABELS[priority],
      watermark: "DRAFT", persianDigits: true,
    })
      .then((u) => {
        if (!alive) return URL.revokeObjectURL(u);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return u;
        });
        setPreviewErr(null);
      })
      .catch((e) => alive && setPreviewErr(errText(e, "پیش‌نمایش ساخته نشد")));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkey, previewOn]);

  async function applyTemplate(tid: string) {
    setTemplateId(tid);
    setDirty(true);
    if (!tid) return;
    const first = recipients.find((r) => r.name.trim());
    try {
      const r = await renderCorrTemplate(tid, { recipientName: first?.name ?? null, recipientTitle: first?.title ?? null, subject: subject || null });
      if (!bodyHtml.trim() || window.confirm("متن فعلی با متن قالب جایگزین شود؟")) {
        setBodyHtml(r.bodyHtml);
        if (!subject.trim() && r.subject) setSubject(r.subject);
        if (r.defaultLetterheadId && !letterheadId) setLetterheadId(r.defaultLetterheadId);
      }
    } catch (e) {
      setError(errText(e, "اعمال قالب ناموفق بود"));
    }
  }

  const upRecipient = (i: number, patch: Partial<Recipient>) => {
    setRecipients((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const readOnly = !!letter && !letter.flags.canEdit;
  const signerPrompt = async () => {
    const sid = await save(false);
    if (sid) setSubmitOpen(true);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-4">
      <div className="space-y-4 min-w-0">
        {letter?.lastReturnNote && letter.status === "RETURNED_FOR_EDIT" ? <ErrorBox>برگشت برای اصلاح: {letter.lastReturnNote}</ErrorBox> : null}
        <Section title="مشخصات نامه" right={<span className="text-[11.5px] text-muted">{type === "INTERNAL" ? "نامه‌ی داخلی" : "نامه‌ی صادره"}{nextNo ? ` · شماره‌ی بعدی (تقریبی): ${nextNo}` : ""}</span>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className={LABEL}>موضوع</label><input value={subject} onChange={(e) => touch(setSubject)(e.target.value)} className={INPUT} maxLength={300} disabled={readOnly} /></div>
            <div>
              <label className={LABEL}>قالب متن</label>
              <select value={templateId} onChange={(e) => void applyTemplate(e.target.value)} className={INPUT} disabled={readOnly || templates === null}>
                <option value="">بدون قالب</option>{(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>سربرگ</label>
              <select value={letterheadId} onChange={(e) => touch(setLetterheadId)(e.target.value)} className={INPUT} disabled={readOnly}>
                <option value="">سربرگ پیش‌فرض</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>تاریخ نامه (هنگام امضا، تاریخ صدور جایگزین می‌شود)</label><JalaliDateInput value={letterDate} onChange={touch(setLetterDate)} /></div>
            <div>
              <label className={LABEL}>دسته</label>
              <select value={categoryId} onChange={(e) => touch(setCategoryId)(e.target.value)} className={INPUT} disabled={readOnly}>
                <option value="">بدون دسته</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>فوریت</label>
              <select value={priority} onChange={(e) => touch(setPriority)(e.target.value as Priority)} className={INPUT} disabled={readOnly}>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div>
              <label className={LABEL}>محرمانگی</label>
              <select value={conf} onChange={(e) => touch(setConf)(e.target.value as Confidentiality)} className={INPUT} disabled={readOnly}>{Object.entries(CONF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div className="sm:col-span-2"><label className={LABEL}>پیوست‌ها (متن چاپی)</label><input value={attachmentsText} onChange={(e) => touch(setAttachmentsText)(e.target.value)} className={INPUT} placeholder="مثلاً یک فقره قرارداد" disabled={readOnly} /></div>
          </div>
        </Section>

        <Section title="گیرندگان" right={!readOnly ? <button type="button" className={BTN_SOFT} onClick={() => { setRecipients((p) => [...p, { name: "" }]); setDirty(true); }}>+ گیرنده</button> : null}>
          <div className="space-y-3">
            {recipients.length === 0 ? <p className="text-[12.5px] text-muted">گیرنده‌ای اضافه نشده است.</p> : null}
            {recipients.map((r, i) => (
              <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={r.name} onChange={(e) => upRecipient(i, { name: e.target.value })} className={INPUT} placeholder="نام گیرنده" disabled={readOnly} />
                  <input value={r.title ?? ""} onChange={(e) => upRecipient(i, { title: e.target.value || undefined })} className={INPUT} placeholder="سمت" disabled={readOnly} />
                  <input value={r.org ?? ""} onChange={(e) => upRecipient(i, { org: e.target.value || undefined })} className={INPUT} placeholder="سازمان" disabled={readOnly} />
                </div>
                {type === "OUTGOING" && !readOnly ? (
                  <ContactCombobox value={r.contactId ?? ""} onChange={(cid, c) => upRecipient(i, { contactId: cid || undefined, ...(c ? { name: r.name || c.name, org: r.org || c.company || undefined } : {}) })} source="customer" allowCreate={false} placeholder="انتخاب از مشتریان (اختیاری)" />
                ) : null}
                {!readOnly ? <button type="button" className="text-[12px] text-danger min-h-[36px] cursor-pointer" onClick={() => { setRecipients((p) => p.filter((_, j) => j !== i)); setDirty(true); }}>حذف گیرنده</button> : null}
              </div>
            ))}
            {type === "INTERNAL" && !readOnly ? (
              <div>
                <label className={LABEL}>افزودن همکار به‌عنوان گیرنده (به او دید می‌دهد)</label>
                <PeoplePicker value={internalPick} multiple onChange={(ids) => {
                  const added = ids.filter((x) => !internalPick.includes(x));
                  setInternalPick(ids);
                  const p = people?.find((u) => u.id === added[0]);
                  if (p) { setRecipients((cur) => (cur.some((r) => r.userId === p.id) ? cur : [...cur, { name: p.name, title: p.title ?? undefined, userId: p.id }])); setDirty(true); }
                }} />
              </div>
            ) : null}
            <div><label className={LABEL}>رونوشت (نام‌ها با ویرگول جدا شوند)</label><input value={ccNames} onChange={(e) => touch(setCcNames)(e.target.value)} className={INPUT} disabled={readOnly} /></div>
          </div>
        </Section>

        <Section title="متن نامه">
          <RichTextEditor value={bodyHtml} onChange={(h) => touch(setBodyHtml)(h)} minHeight={320} disabled={readOnly} />
        </Section>

        {id ? <Section title="پیوست‌ها"><AttachmentsSection entityType="Letter" entityId={id} readOnly={readOnly} capture /></Section> : <p className="text-[12px] text-muted">برای افزودن پیوست، ابتدا نامه ذخیره می‌شود (خودکار).</p>}

        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2 sticky bottom-3 bg-bg/90 backdrop-blur rounded-xl p-2">
            <span className="text-[11.5px] text-muted me-auto">{saving ? "در حال ذخیره…" : dirty ? "ذخیره‌نشده" : savedAt ? `ذخیره شد ${savedAt.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            <button type="button" className={BTN_SOFT} onClick={() => setPreviewOn((v) => !v)}>{previewOn ? "بستن پیش‌نمایش" : "پیش‌نمایش PDF"}</button>
            <button type="button" className={BTN_SOFT} disabled={saving} onClick={() => void save(false).then((sid) => sid && router.refresh())}>ذخیره</button>
            <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={() => void signerPrompt()}>ارجاع برای امضا</button>
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        {previewOn ? (
          <div className="lg:sticky lg:top-4">
            <Section title="پیش‌نمایش زنده">
              {previewErr ? <ErrorBox>{previewErr}</ErrorBox> : null}
              {previewUrl ? <iframe title="پیش‌نمایش نامه" src={previewUrl} className="w-full h-[70vh] rounded-xl border border-border bg-white" /> : <div className="text-center text-muted text-[13px] py-16">در حال ساخت پیش‌نمایش…</div>}
            </Section>
          </div>
        ) : null}
      </div>
      {submitOpen && id ? <SubmitDialog letterId={id} onClose={() => setSubmitOpen(false)} onDone={() => { setSubmitOpen(false); onChanged?.(); router.push(`/correspondence/${id}`); router.refresh(); }} /> : null}
    </div>
  );
}
