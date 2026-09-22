import { useEffect, useRef, useState } from "react";
import { DocsIcon, TrashIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { fetchAttachments, createAttachment, deleteAttachment, ApiError, type Attachment } from "@/lib/api";

// باید کمی زیر کران واقعی سرور (۱۵ مگابایت base64 ≈ ۱۱ مگابایت خام) بماند تا خطا همیشه
// همین‌جا و روشن نشان داده شود، نه بعد از رفتن به سرور با یک پیام عمومی.
const MAX_FILE_BYTES = 11 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت` : `${Math.ceil(bytes / 1024)} کیلوبایت`;
}

/** پیوست فایل عمومی روی هر رکورد — یا با آپلود واقعی فایل از دستگاه، یا با چسباندن یک لینک خارجی. */
export function AttachmentsSection({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submittingLink, setSubmittingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reload() {
    fetchAttachments(entityType, entityId).then(setAttachments).catch(() => setAttachments([]));
  }
  useEffect(reload, [entityType, entityId]);

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(`حجم فایل (${formatBytes(file.size)}) بیشتر از سقف مجاز (۱۱ مگابایت) است`);
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      await createAttachment({ entityType, entityId, title: file.name, fileUrl: dataUrl });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "بارگذاری فایل ناموفق بود");
    } finally {
      setUploading(false);
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkTitle.trim() || !url.trim()) return;
    setSubmittingLink(true);
    setError(null);
    try {
      await createAttachment({ entityType, entityId, title: linkTitle.trim(), fileUrl: url.trim() });
      setLinkTitle("");
      setUrl("");
      setLinkOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن لینک ناموفق بود");
    } finally {
      setSubmittingLink(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteAttachment(id);
      reload();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-[12px] text-muted">پیوست‌ها</span>
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" onChange={handlePickFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer disabled:opacity-50"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            {uploading ? "در حال بارگذاری..." : "بارگذاری فایل"}
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen((v) => !v)}
            className="flex items-center gap-1 text-[11.5px] font-bold text-ink-soft cursor-pointer"
          >
            افزودن لینک
          </button>
        </div>
      </div>

      {linkOpen ? (
        <form onSubmit={handleAddLink} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-2">
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="عنوان فایل"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="لینک فایل (مثلاً از گوگل‌درایو یا هر سرویس دیگر)"
            dir="ltr"
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <button
            type="submit"
            disabled={submittingLink || !linkTitle.trim() || !url.trim()}
            className="py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submittingLink ? "در حال ثبت..." : "افزودن پیوست"}
          </button>
        </form>
      ) : null}

      {error && <div className="text-[12px] text-danger font-semibold mb-2">{error}</div>}

      {attachments === null ? (
        <div className="text-[12px] text-muted">در حال بارگذاری...</div>
      ) : attachments.length === 0 ? (
        <div className="text-[12px] text-muted">هنوز پیوستی اضافه نشده است</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a) => {
            const isUploadedFile = a.fileUrl.startsWith("data:");
            return (
              <div key={a.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
                <DocsIcon className="w-3.5 h-3.5 text-muted shrink-0" />
                <a
                  href={a.fileUrl}
                  target={isUploadedFile ? undefined : "_blank"}
                  rel={isUploadedFile ? undefined : "noreferrer"}
                  download={isUploadedFile ? a.title : undefined}
                  className="flex-1 min-w-0 text-[12px] font-bold text-primary truncate"
                >
                  {a.title}
                </a>
                <span className="text-[10.5px] text-muted shrink-0">{formatJalaliDate(a.createdAt)}</span>
                <button
                  onClick={() => handleDelete(a.id)}
                  disabled={deletingId === a.id}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <TrashIcon className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
