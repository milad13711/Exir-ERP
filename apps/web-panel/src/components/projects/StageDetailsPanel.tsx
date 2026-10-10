import { useEffect, useState } from "react";
import { TrashIcon } from "@/components/icons";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { VisibilityToggle } from "@/components/projects/VisibilityToggle";
import { safeHref } from "@/lib/safe-url";
import {
  addProjectNote,
  addProjectStageLink,
  deleteProjectNote,
  deleteProjectStageLink,
  fetchProjectNotes,
  setProjectNoteVisibility,
  setProjectStageAttachmentVisibility,
  setProjectStageLinkVisibility,
  updateProjectStage,
  type ProjectNote,
  type ProjectStage,
} from "@/lib/api";

/**
 * جزئیات یک مرحله: توضیح، لینک‌ها، پیوست‌ها و یادداشت‌های مرحله. همه‌ی آیتم‌ها پیش‌فرض «خصوصی» هستند و فقط با کلید
 * «نمایش به مشتری» (چشم) در لینک عمومی پروژه دیده می‌شوند.
 */
export function StageDetailsPanel({ projectId, stage, onStageChanged }: { projectId: string; stage: ProjectStage; onStageChanged: (s: ProjectStage) => void }) {
  const [description, setDescription] = useState(stage.description ?? "");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkVisible, setLinkVisible] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteVisible, setNoteVisible] = useState(false);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reloadNotes() {
    fetchProjectNotes(projectId)
      .then((all) => setNotes(all.filter((n) => n.stageId === stage.id && !n.parentId)))
      .catch(() => setNotes([]));
  }
  useEffect(reloadNotes, [projectId, stage.id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const saveStage = (data: Parameters<typeof updateProjectStage>[2]) =>
    run(async () => onStageChanged(await updateProjectStage(projectId, stage.id, data)));

  return (
    <div className="mt-2 flex flex-col gap-3 bg-white border border-border rounded-lg p-3">
      {error ? <div className="text-[11.5px] text-danger font-semibold">{error}</div> : null}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11.5px] font-bold text-ink-soft">توضیح مرحله</span>
          <VisibilityToggle compact visible={stage.descriptionVisibleToCustomer} disabled={busy || !stage.description} onChange={(v) => saveStage({ descriptionVisibleToCustomer: v })} />
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} placeholder="توضیح مرحله (اختیاری)" className="w-full text-[11.5px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5 focus:border-primary" />
        {description.trim() !== (stage.description ?? "") ? (
          <button type="button" disabled={busy} onClick={() => saveStage({ description: description.trim() })} className="mt-1 text-[11px] font-bold text-primary cursor-pointer disabled:opacity-50">
            ذخیره‌ی توضیح
          </button>
        ) : null}
      </div>

      <div>
        <div className="text-[11.5px] font-bold text-ink-soft mb-1">لینک‌ها</div>
        <div className="flex flex-col gap-1.5 mb-2">
          {stage.links.map((l) => (
            <div key={l.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-2.5 py-1.5">
              <a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer nofollow" className="flex-1 min-w-0 text-[11.5px] font-bold text-primary truncate">
                {l.title}
              </a>
              <VisibilityToggle
                compact
                visible={l.visibleToCustomer}
                disabled={busy}
                onChange={(v) =>
                  run(async () => {
                    await setProjectStageLinkVisibility(projectId, stage.id, l.id, v);
                    onStageChanged({ ...stage, links: stage.links.map((x) => (x.id === l.id ? { ...x, visibleToCustomer: v } : x)) });
                  })
                }
              />
              <button
                type="button"
                aria-label="حذف لینک"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await deleteProjectStageLink(projectId, stage.id, l.id);
                    onStageChanged({ ...stage, links: stage.links.filter((x) => x.id !== l.id) });
                  })
                }
                className="text-danger cursor-pointer disabled:opacity-50"
              >
                <TrashIcon className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!linkTitle.trim() || !linkUrl.trim()) return;
            run(async () => {
              const created = await addProjectStageLink(projectId, stage.id, { title: linkTitle.trim(), url: linkUrl.trim(), visibleToCustomer: linkVisible });
              onStageChanged({ ...stage, links: [...stage.links, created] });
              setLinkTitle("");
              setLinkUrl("");
              setLinkVisible(false);
            });
          }}
          className="flex flex-col gap-1.5"
        >
          <div className="flex gap-1.5">
            <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} maxLength={200} placeholder="عنوان لینک" className="flex-1 min-w-0 text-[11.5px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5" />
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} dir="ltr" placeholder="https://..." className="flex-1 min-w-0 text-[11.5px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
              <input type="checkbox" checked={linkVisible} onChange={(e) => setLinkVisible(e.target.checked)} className="w-3.5 h-3.5" />
              نمایش به مشتری
            </label>
            <button type="submit" disabled={busy || !linkTitle.trim() || !linkUrl.trim()} className="text-[11px] font-bold text-primary cursor-pointer disabled:opacity-50">
              افزودن لینک
            </button>
          </div>
        </form>
      </div>

      <AttachmentsSection
        entityType="ProjectStage"
        entityId={stage.id}
        onToggleCustomerVisibility={(attId, v) => setProjectStageAttachmentVisibility(projectId, stage.id, attId, v)}
      />

      <div>
        <div className="text-[11.5px] font-bold text-ink-soft mb-1">یادداشت‌های مرحله</div>
        <div className="flex flex-col gap-1.5 mb-2">
          {notes.map((n) => (
            <div key={n.id} className="bg-slate-50 border border-border rounded-lg px-2.5 py-1.5">
              <div className="text-[11.5px] whitespace-pre-wrap break-words">{n.body}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10.5px] text-muted">{n.authorName ?? ""}</span>
                <span className="flex items-center gap-2">
                  <VisibilityToggle compact visible={n.visibleToCustomer} disabled={busy} onChange={(v) => run(async () => { await setProjectNoteVisibility(projectId, n.id, v); reloadNotes(); })} />
                  <button type="button" aria-label="حذف یادداشت" disabled={busy} onClick={() => run(async () => { await deleteProjectNote(projectId, n.id); reloadNotes(); })} className="text-danger cursor-pointer disabled:opacity-50">
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} maxLength={4000} placeholder="یادداشت مرحله" className="text-[11.5px] outline-none bg-slate-50 border border-border rounded-lg px-2.5 py-1.5" />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
              <input type="checkbox" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} className="w-3.5 h-3.5" />
              نمایش به مشتری
            </label>
            <button
              type="button"
              disabled={busy || !noteBody.trim()}
              onClick={() =>
                run(async () => {
                  await addProjectNote(projectId, { body: noteBody.trim(), stageId: stage.id, visibleToCustomer: noteVisible });
                  setNoteBody("");
                  setNoteVisible(false);
                  reloadNotes();
                })
              }
              className="text-[11px] font-bold text-primary cursor-pointer disabled:opacity-50"
            >
              ثبت یادداشت
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
