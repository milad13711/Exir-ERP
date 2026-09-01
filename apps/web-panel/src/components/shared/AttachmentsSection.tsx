import { useEffect, useState } from "react";
import { DocsIcon, TrashIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { fetchAttachments, createAttachment, deleteAttachment, type Attachment } from "@/lib/api";

export function AttachmentsSection({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    fetchAttachments(entityType, entityId).then(setAttachments).catch(() => setAttachments([]));
  }
  useEffect(reload, [entityType, entityId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      await createAttachment({ entityType, entityId, title: title.trim(), fileUrl: url.trim() });
      setTitle("");
      setUrl("");
      setAdding(false);
      reload();
    } finally {
      setSubmitting(false);
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-muted">پیوست‌ها</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          افزودن لینک
        </button>
      </div>

      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 bg-slate-50 border border-border rounded-xl p-3 mb-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            disabled={submitting || !title.trim() || !url.trim()}
            className="py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : "افزودن پیوست"}
          </button>
        </form>
      ) : null}

      {attachments === null ? (
        <div className="text-[12px] text-muted">در حال بارگذاری...</div>
      ) : attachments.length === 0 ? (
        <div className="text-[12px] text-muted">هنوز پیوستی اضافه نشده است</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
              <DocsIcon className="w-3.5 h-3.5 text-muted shrink-0" />
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noreferrer"
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
          ))}
        </div>
      )}
    </div>
  );
}
