"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createJobPosting, updateJobPosting, fetchContractTemplates, ApiError, type ContractTemplate, type JobPosting, type JobEmploymentType } from "@/lib/api";

const EMPLOYMENT_TYPES: { value: JobEmploymentType; label: string }[] = [
  { value: "FULL_TIME", label: "تمام‌وقت" },
  { value: "PART_TIME", label: "پاره‌وقت" },
  { value: "PROJECT_BASED", label: "پروژه‌ای" },
  { value: "INTERN", label: "کارآموزی" },
];

export function NewPostingModal({ posting, onClose, onCreated }: { posting?: JobPosting; onClose: () => void; onCreated: (id: string) => void }) {
  const editing = !!posting;
  const [title, setTitle] = useState(posting?.title ?? "");
  const [jobField, setJobField] = useState(posting?.jobField ?? "");
  const [employmentType, setEmploymentType] = useState<JobEmploymentType>(posting?.employmentType ?? "FULL_TIME");
  const [capacity, setCapacity] = useState(posting ? String(posting.capacity) : "1");
  const [publishChannel, setPublishChannel] = useState(posting?.publishChannel ?? "");
  const [publishBudget, setPublishBudget] = useState(posting?.publishBudget != null ? String(posting.publishBudget) : "");
  const [description, setDescription] = useState(posting?.description ?? "");
  const [contractTemplateId, setContractTemplateId] = useState(posting?.contractTemplateId ?? "");
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ماژول قراردادها ممکن است نصب/مجاز نباشد — در آن صورت انتخاب قرارداد فقط پنهان می‌شود.
  useEffect(() => {
    fetchContractTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        jobField: jobField.trim(),
        employmentType,
        capacity: Number(capacity) || 1,
        publishChannel: publishChannel.trim() || undefined,
        publishBudget: publishBudget ? Number(publishBudget) : undefined,
        description: description.trim() || undefined,
        contractTemplateId: contractTemplateId || (editing ? null : undefined),
      };
      const saved = posting ? await updateJobPosting(posting.id, payload) : await createJobPosting(payload);
      onCreated(saved.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساخت آگهی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? "ویرایش آگهی" : "آگهی استخدام جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">عنوان شغلی</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">زمینه‌ی شغلی</span>
          <input
            value={jobField}
            onChange={(e) => setJobField(e.target.value)}
            placeholder="مثلاً: فنی، فروش، اداری"
            required
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">مدل جذب</span>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as JobEmploymentType)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">ظرفیت جذب</span>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">کانال انتشار</span>
            <input
              value={publishChannel}
              onChange={(e) => setPublishChannel(e.target.value)}
              placeholder="مثلاً: جاب‌ویژن"
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">بودجه‌ی انتشار (تومان)</span>
            <input
              type="number"
              min={0}
              value={publishBudget}
              onChange={(e) => setPublishBudget(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">توضیحات (اختیاری)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary resize-none"
          />
        </label>

        {templates.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-ink-soft">قالب قرارداد و قوانین همکاری این آگهی</span>
            <select
              value={contractTemplateId}
              onChange={(e) => setContractTemplateId(e.target.value)}
              className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
            >
              <option value="">بدون قالب</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted">
              متن قالب برای هر متقاضی با اطلاعات خودش (نام، حقوق، تاریخ شروع و…) پر می‌شود و قبل از تأیید و امضا در لینک «شرایط و قوانین» نمایش داده می‌شود. قالب‌ها را از ماژول قراردادها بسازید.
            </span>
          </label>
        )}
        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <button type="submit" disabled={busy} className="text-[13px] font-bold px-4 py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer">
          {busy ? "در حال ذخیره..." : editing ? "ذخیره تغییرات" : "ساخت آگهی"}
        </button>
      </form>
    </Modal>
  );
}
