"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  updateConfidentialDocument,
  deleteConfidentialDocument,
  CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS,
  ApiError,
  type ConfidentialDocument,
  type ConfidentialDocumentCategory,
} from "@/lib/api";
import { formatJalaliDate } from "@/lib/persian";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CATEGORIES = Object.keys(CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS) as ConfidentialDocumentCategory[];

/** جزئیات/ویرایش یک سند — فقط وقتی باز می‌شود که بلیط طاق معتبر در دست است. */
export function DocumentDetailModal({
  doc,
  canEdit,
  vaultTicket,
  onClose,
  onUpdated,
  onDeleted,
  onExpired,
}: {
  doc: ConfidentialDocument;
  canEdit: boolean;
  vaultTicket: string;
  onClose: () => void;
  onUpdated: (doc: ConfidentialDocument) => void;
  onDeleted: (id: string) => void;
  onExpired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [content, setContent] = useState(doc.content ?? "");
  const [fileName, setFileName] = useState(doc.fileName);
  const [fileData, setFileData] = useState(doc.fileData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAuthError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      onExpired();
      return true;
    }
    return false;
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setFileData(await readAsDataUrl(file));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateConfidentialDocument(
        doc.id,
        { title: title.trim(), category, content: content.trim(), fileName: fileName ?? undefined, fileData: fileData ?? undefined },
        vaultTicket,
      );
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      if (!handleAuthError(err)) setError(err instanceof ApiError ? err.message : "ویرایش ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("این سند برای همیشه حذف شود؟")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteConfidentialDocument(doc.id, vaultTicket);
      onDeleted(doc.id);
    } catch (err) {
      if (!handleAuthError(err)) setError(err instanceof ApiError ? err.message : "حذف ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "ویرایش سند" : doc.title} onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-3">
        {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

        {editing ? (
          <>
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
                className="text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2.5 focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink-soft">متن / توضیحات</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                className="text-[13px] outline-none bg-surface border border-border rounded-lg px-3 py-2.5 focus:border-primary resize-y"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink-soft">پیوست</span>
              <input type="file" onChange={(e) => handleFile(e.target.files?.[0])} className="text-[12.5px]" />
              {fileName ? <span className="text-[11.5px] text-muted">{fileName}</span> : null}
            </label>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={save}
                disabled={saving}
                className="text-[13px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-60"
              >
                {saving ? "در حال ذخیره…" : "ذخیره"}
              </button>
              <button onClick={() => setEditing(false)} className="text-[12.5px] font-bold text-ink-soft cursor-pointer">
                انصراف
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] font-bold text-primary bg-primary-soft w-fit px-2.5 py-1 rounded-md">
              {CONFIDENTIAL_DOCUMENT_CATEGORY_LABELS[doc.category]}
            </div>
            {doc.content ? <p className="text-[13px] leading-7 whitespace-pre-wrap">{doc.content}</p> : null}
            {doc.fileData && doc.fileName ? (
              <a href={doc.fileData} download={doc.fileName} className="text-[12.5px] font-bold text-primary">
                دانلود پیوست: {doc.fileName}
              </a>
            ) : null}
            <div className="text-[11.5px] text-muted mt-2">
              ثبت‌شده توسط {doc.createdBy?.name ?? "—"} در {formatJalaliDate(doc.createdAt)}
              {doc.updatedBy ? <> · آخرین ویرایش توسط {doc.updatedBy.name}</> : null}
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => setEditing(true)}
                  className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2 rounded-lg cursor-pointer"
                >
                  ویرایش
                </button>
                <button onClick={remove} disabled={saving} className="text-[12.5px] font-bold text-danger cursor-pointer disabled:opacity-60">
                  حذف سند
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
