import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { TrashIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { VisibilityToggle } from "@/components/projects/VisibilityToggle";
import { addProjectNote, deleteProjectNote, fetchProjectNotes, setProjectNoteVisibility, type ProjectNote } from "@/lib/api";

/** یادداشت‌های سطح پروژه + کامنت‌های مشتری (با پاسخ). یادداشت‌های مرحله در پنل خود مرحله هستند. */
export function ProjectNotesSection({ projectId, refreshKey }: { projectId: string; refreshKey?: number }) {
  const [notes, setNotes] = useState<ProjectNote[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyVisible, setReplyVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchProjectNotes(projectId).then(setNotes).catch(() => setNotes([]));
  }
  useEffect(reload, [projectId, refreshKey]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const top = (notes ?? []).filter((n) => !n.parentId && !n.stageId);
  const customerCount = top.filter((n) => n.source === "CUSTOMER").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12.5px] font-semibold text-ink-soft">یادداشت‌ها و کامنت‌های مشتری</span>
        {customerCount > 0 ? <Badge tone="primary">{customerCount} کامنت مشتری</Badge> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          run(async () => {
            await addProjectNote(projectId, { body: body.trim() });
            setBody("");
          });
        }}
        className="flex items-start gap-2 mb-2.5"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="یادداشت داخلی (برای مشتری نمایش داده نمی‌شود)"
          className="flex-1 text-[12px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary"
        />
        <button type="submit" disabled={busy || !body.trim()} className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50">
          ثبت
        </button>
      </form>
      {error ? <div className="text-[12px] text-danger font-semibold mb-2">{error}</div> : null}

      {notes === null ? (
        <div className="text-[12px] text-muted text-center py-2">در حال بارگذاری...</div>
      ) : top.length === 0 ? (
        <div className="text-[12px] text-muted bg-slate-50 rounded-xl p-3 text-center">یادداشتی ثبت نشده</div>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((n) => {
            const replies = (notes ?? []).filter((r) => r.parentId === n.id);
            const isCustomer = n.source === "CUSTOMER";
            const isSms = n.source === "SMS";
            return (
              <div key={n.id} className={`rounded-xl border p-3 ${isCustomer ? "border-primary/30 bg-primary-soft" : "border-border bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted mb-1">
                  <span className="flex items-center gap-1.5">
                    {isCustomer ? <Badge tone="primary">کامنت مشتری</Badge> : isSms ? <Badge tone="success">پیامک</Badge> : <Badge tone="neutral">داخلی</Badge>}
                    <span className="font-semibold text-ink-soft">{n.authorName ?? "—"}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {formatJalaliDateTime(n.createdAt)}
                    <button type="button" aria-label="حذف" disabled={busy} onClick={() => window.confirm("این یادداشت حذف شود؟") && run(() => deleteProjectNote(projectId, n.id))} className="text-danger cursor-pointer disabled:opacity-50">
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </span>
                </div>
                <div className="text-[12.5px] whitespace-pre-wrap break-words">{n.body}</div>

                {replies.map((r) => (
                  <div key={r.id} className="mt-2 mr-3 border-r-2 border-border pr-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted mb-0.5">
                      <span className="font-semibold text-ink-soft">{r.authorName ?? "تیم"}</span>
                      <span className="flex items-center gap-2">
                        {isCustomer ? <VisibilityToggle compact visible={r.visibleToCustomer} disabled={busy} onChange={(v) => run(() => setProjectNoteVisibility(projectId, r.id, v))} /> : null}
                        <button type="button" aria-label="حذف پاسخ" disabled={busy} onClick={() => run(() => deleteProjectNote(projectId, r.id))} className="text-danger cursor-pointer disabled:opacity-50">
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                    <div className="text-[12px] whitespace-pre-wrap break-words">{r.body}</div>
                  </div>
                ))}

                {replyTo === n.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={2} maxLength={4000} placeholder="پاسخ تیم..." className="text-[12px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5" />
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCustomer ? (
                        <label className="flex items-center gap-1.5 text-[11.5px] font-semibold cursor-pointer">
                          <input type="checkbox" checked={replyVisible} onChange={(e) => setReplyVisible(e.target.checked)} className="w-3.5 h-3.5" />
                          نمایش به مشتری (پاسخ تیم)
                        </label>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy || !replyBody.trim()}
                        onClick={() =>
                          run(async () => {
                            await addProjectNote(projectId, { body: replyBody.trim(), parentId: n.id, visibleToCustomer: isCustomer && replyVisible });
                            setReplyTo(null);
                            setReplyBody("");
                            setReplyVisible(false);
                          })
                        }
                        className="text-[11px] font-bold text-white bg-primary px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 mr-auto"
                      >
                        ثبت پاسخ
                      </button>
                      <button type="button" onClick={() => setReplyTo(null)} className="text-[11px] font-bold text-ink-soft cursor-pointer">
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : isSms ? null : (
                  <button type="button" onClick={() => { setReplyTo(n.id); setReplyBody(""); setReplyVisible(false); }} className="mt-1.5 text-[11px] font-bold text-primary cursor-pointer">
                    پاسخ
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
