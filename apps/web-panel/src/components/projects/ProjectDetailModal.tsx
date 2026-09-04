import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { TasksSection } from "@/components/shared/TasksSection";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { startProject, holdProject, completeProject, cancelProject, type Project, type ProjectStatus } from "@/lib/api";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "برنامه‌ریزی",
  ACTIVE: "در حال اجرا",
  ON_HOLD: "متوقف‌شده",
  COMPLETED: "تکمیل‌شده",
  CANCELLED: "لغوشده",
};
const STATUS_TONES: Record<ProjectStatus, "primary" | "success" | "warning" | "neutral" | "danger"> = {
  PLANNING: "neutral",
  ACTIVE: "success",
  ON_HOLD: "warning",
  COMPLETED: "primary",
  CANCELLED: "danger",
};

export function ProjectDetailModal({
  project,
  onClose,
  onChanged,
}: {
  project: Project;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const progressPct = project.progress.total > 0 ? Math.round((project.progress.done / project.progress.total) * 100) : 0;

  return (
    <Modal title={`پروژه شماره ${project.projectNo}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold">{project.name}</div>
            {project.contact && (
              <div className="text-[12.5px] text-muted mt-1">
                {project.contact.name}
                {project.contact.company ? ` — ${project.contact.company}` : ""}
              </div>
            )}
          </div>
          <Badge tone={STATUS_TONES[project.status]}>{STATUS_LABELS[project.status]}</Badge>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11.5px] text-muted mb-1.5">
            <span>پیشرفت بر اساس وظایف</span>
            <span>
              {project.progress.done} از {project.progress.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {project.budget != null && (
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-muted mb-1">بودجه</div>
              <div className="text-[13.5px] font-extrabold">{formatToman(project.budget)}</div>
            </div>
          )}
          {project.manager && (
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-muted mb-1">مدیر پروژه</div>
              <div className="text-[13.5px] font-bold">{project.manager.name}</div>
            </div>
          )}
          {project.startDate && (
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-muted mb-1">تاریخ شروع</div>
              <div className="text-[13px] font-bold">{formatJalaliDate(project.startDate)}</div>
            </div>
          )}
          {project.endDate && (
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-muted mb-1">تاریخ پایان</div>
              <div className="text-[13px] font-bold">{formatJalaliDate(project.endDate)}</div>
            </div>
          )}
        </div>

        {project.description && (
          <div className="text-[12.5px] text-ink-soft leading-relaxed bg-slate-50 rounded-xl p-3 whitespace-pre-wrap">
            {project.description}
          </div>
        )}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <div className="flex items-center gap-2 flex-wrap">
          {(project.status === "PLANNING" || project.status === "ON_HOLD") && (
            <button
              onClick={() => runAction(() => startProject(project.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              {project.status === "ON_HOLD" ? "از سرگیری" : "شروع پروژه"}
            </button>
          )}
          {project.status === "ACTIVE" && (
            <button
              onClick={() => runAction(() => holdProject(project.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl border border-border text-ink-soft text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              توقف موقت
            </button>
          )}
          {(project.status === "PLANNING" || project.status === "ACTIVE" || project.status === "ON_HOLD") && (
            <>
              <button
                onClick={() => runAction(() => completeProject(project.id))}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-success/30 text-success text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                اتمام پروژه
              </button>
              <button
                onClick={() => runAction(() => cancelProject(project.id))}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-danger/30 text-danger text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                لغو پروژه
              </button>
            </>
          )}
        </div>

        <TasksSection relatedModule="project" relatedEntityId={project.id} />
        <AttachmentsSection entityType="Project" entityId={project.id} />
      </div>
    </Modal>
  );
}
