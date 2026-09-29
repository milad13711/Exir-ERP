"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  createConfidentialDocument,
  CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS,
  type ConfidentialDocument,
  type ConfidentialDocumentCategory,
  ApiError,
} from "@/lib/api";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CATEGORIES = Object.keys(CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS) as ConfidentialDocumentCategory[];

/**
 * فرم ثبت سند جدید — همیشه در دسترس، بدون OTP و بدون نیاز به مجوز آرشیو؛
 * هر کاربری که ماژول نصب دارد می‌تواند سند ثبت کند حتی اگر خودش هیچ‌وقت
 * نتواند آرشیو را ببیند (نک: توضیح طراحی در ConfidentialArchiveService).
 */
export function NewDocumentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (doc: ConfidentialDocument) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ConfidentialDocumentCategory>("PASSWORD");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setFileData(await readAsDataUrl(file));
  }

  async function submit() {
    if (!title.trim()) {
      setError("عنوان سند الزامی است");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const doc = await createConfidentialDocument({
        title: title.trim(),
        category,
        content: content.trim() || undefined,
        fileName: fileName ?? undefined,
        fileData: fileData ?? undefined,
      });
      onCreated(doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت سند ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ثبت سند جدید" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-ink-soft">دسته‌بندی</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ConfidentialDocumentCategory)}
            className="text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-ink-soft">عنوان</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً رمز پنل هاست شرکت"
            className="text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2.5 focus:border-primary"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-ink-soft">متن / توضیحات</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder={category === "SYSTEM_LOG" ? "متن لاگ را همین‌جا بچسبانید…" : "متن محرمانه…"}
            className="text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2.5 focus:border-primary resize-y"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-ink-soft">پیوست (اختیاری)</span>
          <input
            type="file"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="text-[12.5px]"
          />
          {fileName ? <span className="text-[11.5px] text-muted">{fileName}</span> : null}
        </label>

        <button
          onClick={submit}
          disabled={saving}
          className="mt-2 text-[13px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-60"
        >
          {saving ? "در حال ثبت…" : "ثبت سند"}
        </button>
      </div>
    </Modal>
  );
}
