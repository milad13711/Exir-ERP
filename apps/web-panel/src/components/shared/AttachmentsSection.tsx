import { useEffect, useRef, useState } from "react";
import { safeHref } from "@/lib/safe-url";
import { DocsIcon, TrashIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchAttachments,
  createAttachment,
  deleteAttachment,
  renameAttachment,
  convertAttachmentToKnowledge,
  archiveAttachmentConfidential,
  ApiError,
  type Attachment,
} from "@/lib/api";

const CHECKLIST_ENTITY = "DailyChecklistItem";
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** نام دانلود = نام انتخابیِ کاربر + پسوند حدس‌زده‌شده از نوع فایل. */
function downloadName(title: string, fileUrl: string): string {
  const mime = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(fileUrl)?.[1];
  const ext = mime ? EXT_BY_MIME[mime] : undefined;
  return ext && !title.toLowerCase().endsWith(`.${ext}`) ? `${title}.${ext}` : title;
}

function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,6}$/, "").trim();
}

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
export function AttachmentsSection({ entityType, entityId, readOnly = false }: { entityType: string; entityId: string; readOnly?: boolean }) {
  const { installedModules } = useWorkspace();
  // نام انتخابیِ کاربر برای فایل‌های چک‌لیست اجباری است (فایلِ در انتظارِ نام‌گذاری)
  const mustName = entityType === CHECKLIST_ENTITY;
  const [pending, setPending] = useState<{ dataUrl: string; name: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const convertible = entityType === CHECKLIST_ENTITY || entityType === "Report";
  const canKnowledge = convertible && installedModules.has("reports");
  const canConfidential = convertible && installedModules.has("confidential-archive");
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
      if (mustName) {
        setPending({ dataUrl, name: stripExtension(file.name) });
      } else {
        await createAttachment({ entityType, entityId, title: file.name, fileUrl: dataUrl });
        reload();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "بارگذاری فایل ناموفق بود");
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirmName(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      await createAttachment({ entityType, entityId, title: pending.name.trim(), fileUrl: pending.dataUrl });
      setPending(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "بارگذاری فایل ناموفق بود");
    } finally {
      setUploading(false);
    }
  }

  async function handleRename(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await renameAttachment(id, renameValue.trim());
      setRenamingId(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تغییر نام ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  async function handleConvert(a: Attachment, kind: "knowledge" | "confidential") {
    const msg =
      kind === "knowledge"
        ? `فایل «${a.title}» به‌عنوان یک مورد در دانش سازمانی (ماژول گزارش‌ها) ثبت شود؟ فایل اصلی حذف نمی‌شود.`
        : `فایل «${a.title}» در اسناد محرمانه بایگانی شود؟ فقط خودِ شما و مالک/مدیر به آن دسترسی خواهند داشت. فایل اصلی حذف نمی‌شود.`;
    if (!window.confirm(msg)) return;
    setBusyId(a.id);
    setError(null);
    setNotice(null);
    try {
      if (kind === "knowledge") await convertAttachmentToKnowledge(a.id);
      else await archiveAttachmentConfidential(a.id);
      setNotice(kind === "knowledge" ? "به دانش سازمانی تبدیل شد ✓" : "در اسناد محرمانه بایگانی شد ✓");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تبدیل ناموفق بود");
    } finally {
      setBusyId(null);
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
        {readOnly ? null : (
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
        )}
      </div>

      {pending ? (
        <form onSubmit={handleConfirmName} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-2">
          <label className="text-[11.5px] font-bold text-ink-soft">برای این فایل یک نام انتخاب کنید (الزامی)</label>
          <input
            autoFocus
            value={pending.name}
            onChange={(e) => setPending({ ...pending, name: e.target.value })}
            placeholder="مثلاً: رسید پرداخت اجاره"
            maxLength={120}
            className="text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={uploading || pending.name.trim().length < 2}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
            >
              {uploading ? "در حال ثبت..." : "ثبت فایل با این نام"}
            </button>
            <button type="button" onClick={() => setPending(null)} className="px-3 py-2 rounded-lg text-[12px] font-bold text-ink-soft cursor-pointer">
              انصراف
            </button>
          </div>
        </form>
      ) : null}

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
      {notice && <div className="text-[12px] text-success font-semibold mb-2">{notice}</div>}

      {attachments === null ? (
        <div className="text-[12px] text-muted">در حال بارگذاری...</div>
      ) : attachments.length === 0 ? (
        <div className="text-[12px] text-muted">هنوز پیوستی اضافه نشده است</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a) => {
            const isUploadedFile = a.fileUrl.startsWith("data:");
            return (
              <div key={a.id} className="bg-slate-50 border border-border rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <DocsIcon className="w-3.5 h-3.5 text-muted shrink-0" />
                  {renamingId === a.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        maxLength={120}
                        className="flex-1 min-w-0 text-[12px] outline-none bg-surface border border-border rounded-md px-2 py-1"
                      />
                      <button onClick={() => handleRename(a.id)} disabled={busyId === a.id || renameValue.trim().length < 2} className="text-[11px] font-bold text-primary cursor-pointer disabled:opacity-50">
                        ذخیره
                      </button>
                      <button onClick={() => setRenamingId(null)} className="text-[11px] text-muted cursor-pointer">
                        انصراف
                      </button>
                    </>
                  ) : (
                    <>
                      <a
                        href={safeHref(a.fileUrl, { allowData: true })}
                        target={isUploadedFile ? undefined : "_blank"}
                        rel={isUploadedFile ? undefined : "noreferrer"}
                        download={isUploadedFile ? downloadName(a.title, a.fileUrl) : undefined}
                        className="flex-1 min-w-0 text-[12px] font-bold text-primary truncate"
                      >
                        {a.title}
                      </a>
                      <span className="text-[10.5px] text-muted shrink-0">{formatJalaliDate(a.createdAt)}</span>
                      {readOnly ? null : (
                        <>
                          <button
                            onClick={() => {
                              setRenamingId(a.id);
                              setRenameValue(stripExtension(a.title));
                            }}
                            className="text-[11px] font-bold text-ink-soft cursor-pointer shrink-0"
                          >
                            تغییر نام
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={deletingId === a.id}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-danger hover:bg-danger-soft cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {a.sourceNote && entityType === "Report" ? <div className="text-[10.5px] text-muted mt-1 pr-5">مربوط به: {a.sourceNote}</div> : null}
                {convertible && (entityType === CHECKLIST_ENTITY || a.sourceAttachmentId) && (canKnowledge || canConfidential) ? (
                  <div className="flex items-center gap-3 mt-1.5 pr-5 flex-wrap">
                    {canKnowledge ? (
                      <button onClick={() => handleConvert(a, "knowledge")} disabled={busyId === a.id} className="text-[11px] font-bold text-primary cursor-pointer disabled:opacity-50">
                        تبدیل به دانش سازمانی
                      </button>
                    ) : null}
                    {canConfidential ? (
                      <button onClick={() => handleConvert(a, "confidential")} disabled={busyId === a.id} className="text-[11px] font-bold text-ink-soft cursor-pointer disabled:opacity-50">
                        بایگانی در اسناد محرمانه
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
