"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import {
  ApiError,
  createProposal,
  fetchCrmDeals,
  fetchProposal,
  fetchProposalTemplates,
  fetchUsers,
  updateProposal,
  type CrmDeal,
  type ProposalInvoiceLine,
  type ProposalTemplate,
  type TenantUser,
} from "@/lib/api";
import { ContactPicker, type PickedContact } from "./ContactPicker";
import { inputClass, labelClass } from "./constants";

const STEPS = ["اطلاعات پایه", "متن پروپوزال", "شرایط مالی", "پیوست‌ها"];

type FormState = {
  title: string;
  contact: PickedContact | null;
  dealId: string;
  assignedUserId: string;
  validUntil: string;
  content: string;
  durationText: string;
  amount: string;
  paymentMethodText: string;
  paymentTerms: string;
  paymentDeadline: string;
  paymentDueAt: string;
  bankInfo: string;
  internalNote: string;
  lines: ProposalInvoiceLine[];
};

const EMPTY: FormState = {
  title: "",
  contact: null,
  dealId: "",
  assignedUserId: "",
  validUntil: "",
  content: "",
  durationText: "",
  amount: "",
  paymentMethodText: "انتقال بانکی (کارت به کارت)",
  paymentTerms: "",
  paymentDeadline: "",
  paymentDueAt: "",
  bankInfo: "",
  internalNote: "",
  lines: [],
};

function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ساخت/ویرایش پروپوزال در ۴ گام کوتاه: پایه ← متن ← شرایط مالی ← پیوست‌ها (پیوست پس از ذخیره‌ی اول ممکن می‌شود). */
export function ProposalFormModal({
  proposalId,
  initialContact,
  onClose,
  onSaved,
}: {
  proposalId?: string;
  initialContact?: PickedContact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({ ...EMPTY, contact: initialContact ?? null });
  const [id, setId] = useState<string | undefined>(proposalId);
  const [loading, setLoading] = useState(!!proposalId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetchUsers().then((u) => setUsers(u.filter((x) => x.status !== "DISABLED"))).catch(() => undefined);
    fetchCrmDeals().then(setDeals).catch(() => undefined);
    if (!proposalId) fetchProposalTemplates().then(setTemplates).catch(() => undefined);
  }, [proposalId]);

  useEffect(() => {
    if (!proposalId) return;
    fetchProposal(proposalId)
      .then((p) => {
        setForm({
          title: p.title,
          contact: { id: p.contact.id, name: p.contact.name, company: p.contact.company, phone: p.contact.phone },
          dealId: p.dealId ?? "",
          assignedUserId: p.assignedUserId ?? "",
          validUntil: dateOnly(p.validUntil),
          content: p.content,
          durationText: p.durationText ?? "",
          amount: p.amount ? String(p.amount) : "",
          paymentMethodText: p.paymentMethodText ?? "",
          paymentTerms: p.paymentTerms ?? "",
          paymentDeadline: p.paymentDeadline ?? "",
          paymentDueAt: dateOnly(p.paymentDueAt),
          bankInfo: p.bankInfo ?? "",
          internalNote: p.internalNote ?? "",
          lines: p.invoiceLines ?? [],
        });
      })
      .catch(() => setError("بارگذاری پروپوزال ناموفق بود"))
      .finally(() => setLoading(false));
  }, [proposalId]);

  function applyTemplate(tid: string) {
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    setForm((f) => ({
      ...f,
      title: f.title || t.title,
      content: t.content,
      durationText: t.durationText ?? "",
      amount: t.amount ? String(t.amount) : "",
      paymentMethodText: t.paymentMethodText ?? f.paymentMethodText,
      paymentTerms: t.paymentTerms ?? "",
      paymentDeadline: t.paymentDeadline ?? "",
      bankInfo: t.bankInfo ?? "",
      validUntil: t.validDays ? plusDays(t.validDays) : f.validUntil,
    }));
  }

  async function save(): Promise<boolean> {
    if (form.title.trim().length < 2) {
      setError("عنوان پروپوزال را وارد کنید");
      setStep(0);
      return false;
    }
    if (!form.contact) {
      setError("مشتری را انتخاب کنید");
      setStep(0);
      return false;
    }
    const amount = Number(form.amount.replace(/[^\d]/g, "")) || 0;
    const lines = form.lines.filter((l) => l.description.trim());
    const payload = {
      title: form.title.trim(),
      contactId: form.contact.id,
      dealId: form.dealId || null,
      assignedUserId: form.assignedUserId || null,
      validUntil: form.validUntil || null,
      content: form.content,
      durationText: form.durationText.trim() || null,
      amount,
      paymentMethodText: form.paymentMethodText.trim() || null,
      paymentTerms: form.paymentTerms.trim() || null,
      paymentDeadline: form.paymentDeadline.trim() || null,
      paymentDueAt: form.paymentDueAt || null,
      bankInfo: form.bankInfo.trim() || null,
      internalNote: form.internalNote.trim() || null,
      invoiceLines: lines.length ? lines : null,
    };
    setSaving(true);
    setError(null);
    try {
      if (id) {
        await updateProposal(id, payload);
      } else {
        const created = await createProposal({ ...payload, title: payload.title, contactId: payload.contactId });
        setId(created.id);
      }
      onSaved();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    if (step === 2 || (step < 2 && id)) {
      // گام مالی ذخیره می‌کند تا پیوست‌ها شناسه داشته باشند؛ در ویرایش هر گام ذخیره می‌شود
      if (!(await save())) return;
    }
    setStep((s) => Math.min(3, s + 1));
  }

  const dealOptions = deals.filter((d) => d.contactId === form.contact?.id);

  return (
    <Modal title={proposalId ? "ویرایش پروپوزال" : "پروپوزال جدید"} onClose={onClose} width="max-w-[640px]">
      {loading ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => (i === 3 && !id ? undefined : setStep(i))}
                className={clsx(
                  "flex-1 text-[11.5px] font-bold py-2 rounded-lg border cursor-pointer",
                  step === i ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
                  i === 3 && !id && "opacity-50 cursor-not-allowed",
                )}
              >
                {toPersianDigits(i + 1)}. {s}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="flex flex-col gap-3">
              {templates.length > 0 && !proposalId ? (
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>ساخت از قالب آماده (اختیاری)</span>
                  <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className={inputClass}>
                    <option value="">— بدون قالب —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>عنوان پروپوزال</span>
                <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200} className={inputClass} placeholder="مثلاً: طراحی و پیاده‌سازی وب‌سایت فروشگاهی" />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className={labelClass}>مشتری</span>
                <ContactPicker value={form.contact} onChange={(c) => setForm((f) => ({ ...f, contact: c, dealId: "" }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>معامله‌ی مرتبط (اختیاری)</span>
                  <select value={form.dealId} onChange={(e) => set("dealId", e.target.value)} disabled={!form.contact} className={inputClass}>
                    <option value="">— بدون معامله —</option>
                    {dealOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>ارجاع به همکار برای پیگیری</span>
                  <select value={form.assignedUserId} onChange={(e) => set("assignedUserId", e.target.value)} className={inputClass}>
                    <option value="">— بدون ارجاع —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className={labelClass}>تاریخ انقضای پروپوزال (آخرین مهلت پذیرش)</span>
                <JalaliDateInput value={form.validUntil} onChange={(v) => set("validUntil", v)} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-2">
              <span className={labelClass}>متن پروپوزال</span>
              <textarea
                value={form.content}
                onChange={(e) => set("content", e.target.value)}
                rows={14}
                maxLength={60000}
                className={clsx(inputClass, "leading-7 resize-y")}
                placeholder={"# معرفی پروژه\nشرح کلی...\n\n# محدوده‌ی کار\n- مورد اول\n- مورد دوم"}
              />
              <div className="text-[11px] text-muted leading-6">
                راهنما: خطی که با «# » شروع شود عنوان بخش می‌شود، خط خالی پاراگراف جدا می‌کند و «- » آیتم فهرست می‌سازد. تصاویر را در گام «پیوست‌ها» اضافه کنید.
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>مدت زمان پیاده‌سازی</span>
                  <input value={form.durationText} onChange={(e) => set("durationText", e.target.value)} className={inputClass} placeholder="مثلاً ۳ ماه" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>مبلغ پروژه (تومان)</span>
                  <input
                    value={form.amount ? toPersianDigits(Number(form.amount.replace(/[^\d]/g, "") || 0).toLocaleString("en-US")) : ""}
                    onChange={(e) => set("amount", e.target.value.replace(/[^\d۰-۹]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>روش پرداخت</span>
                <input value={form.paymentMethodText} onChange={(e) => set("paymentMethodText", e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>شیوه و زمان‌بندی پرداخت (اقساط، مراحل...)</span>
                <textarea value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} rows={3} className={clsx(inputClass, "resize-y")} placeholder="۴۰٪ پیش‌پرداخت، ۳۰٪ پس از تحویل مرحله‌ی اول، ۳۰٪ هنگام تحویل نهایی" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>مهلت پرداخت (متن)</span>
                  <input value={form.paymentDeadline} onChange={(e) => set("paymentDeadline", e.target.value)} className={inputClass} placeholder="مثلاً ۷ روز پس از تأیید" />
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className={labelClass}>تاریخ سررسید (برای فاکتور)</span>
                  <JalaliDateInput value={form.paymentDueAt} onChange={(v) => set("paymentDueAt", v)} />
                </div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>شماره کارت / حساب برای واریز</span>
                <input value={form.bankInfo} onChange={(e) => set("bankInfo", e.target.value)} dir="ltr" className={inputClass} placeholder="6037-xxxx-xxxx-xxxx — به نام ..." />
              </label>
              <div className="border border-border rounded-xl p-3 bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <span className={labelClass}>ردیف‌های فاکتور (اختیاری — پیش‌فرض یک ردیف به مبلغ پروژه)</span>
                  <button type="button" onClick={() => set("lines", [...form.lines, { description: "", quantity: 1, unitPrice: 0 }])} className="text-[11.5px] font-bold text-primary flex items-center gap-1 cursor-pointer">
                    <PlusIcon className="w-3.5 h-3.5" />
                    ردیف
                  </button>
                </div>
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_60px_110px_28px] gap-1.5 mb-1.5 items-center">
                    <input value={l.description} onChange={(e) => set("lines", form.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="شرح" className={inputClass} />
                    <input type="number" min={1} value={l.quantity} onChange={(e) => set("lines", form.lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} className={inputClass} />
                    <input type="number" min={0} value={l.unitPrice} onChange={(e) => set("lines", form.lines.map((x, j) => (j === i ? { ...x, unitPrice: Math.max(0, Number(e.target.value) || 0) } : x)))} className={inputClass} />
                    <button type="button" onClick={() => set("lines", form.lines.filter((_, j) => j !== i))} className="text-danger cursor-pointer" aria-label="حذف ردیف">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>یادداشت داخلی (برای مشتری نمایش داده نمی‌شود)</span>
                <textarea value={form.internalNote} onChange={(e) => set("internalNote", e.target.value)} rows={2} className={clsx(inputClass, "resize-y")} />
              </label>
            </div>
          )}

          {step === 3 &&
            (id ? (
              <div className="flex flex-col gap-2">
                <div className="text-[12px] text-ink-soft leading-6">تصاویر در صفحه‌ی مشتری درون متن نمایش داده می‌شوند و سایر فایل‌ها قابل دانلود هستند.</div>
                <AttachmentsSection entityType="Proposal" entityId={id} />
              </div>
            ) : (
              <div className="text-[12.5px] text-muted text-center py-6">ابتدا پروپوزال را ذخیره کنید.</div>
            ))}

          {error ? <div className="text-[12.5px] text-danger font-semibold">{error}</div> : null}

          <div className="flex items-center gap-2 pt-1">
            {step > 0 ? (
              <button type="button" onClick={() => setStep((s) => s - 1)} className="px-4 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[13px] font-bold cursor-pointer">
                قبلی
              </button>
            ) : null}
            <div className="flex-1" />
            {step < 3 ? (
              <>
                <button type="button" onClick={async () => { if (await save()) onClose(); }} disabled={saving} className="px-4 py-2.5 rounded-xl bg-surface border border-border text-ink-soft text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                  ذخیره و بستن
                </button>
                <button type="button" onClick={next} disabled={saving} className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50 cursor-pointer">
                  {saving ? "در حال ذخیره..." : step === 2 ? "ذخیره و پیوست‌ها" : "بعدی"}
                </button>
              </>
            ) : (
              <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer">
                پایان
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
