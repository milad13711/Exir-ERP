import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, PlusIcon } from "@/components/icons";
import { TasksSection } from "@/components/shared/TasksSection";
import { ProjectProgressBar } from "@/components/projects/ProjectProgressBar";
import { ProjectShareSection } from "@/components/projects/ProjectShareSection";
import { ProjectNotesSection } from "@/components/projects/ProjectNotesSection";
import { ProjectDocumentsSection } from "@/components/projects/ProjectDocumentsSection";
import { StageDetailsPanel } from "@/components/projects/StageDetailsPanel";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { NewInvoiceModal } from "@/components/sales/NewInvoiceModal";
import {
  startProject,
  holdProject,
  completeProject,
  cancelProject,
  deleteProject,
  updateProjectStage,
  deleteProjectStage,
  addProjectStage,
  assignProjectStage,
  requestStageStart,
  approveStage,
  rejectStage,
  completeStage,
  fetchProject,
  fetchUsers,
  type Project,
  type ProjectStatus,
  type ProjectStage,
  type ProjectStageStatus,
  type TenantUser,
} from "@/lib/api";

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

const STAGE_STATUS_LABELS: Record<ProjectStageStatus, string> = {
  PENDING: "شروع‌نشده",
  AWAITING_APPROVAL: "منتظر تأیید مدیر",
  IN_PROGRESS: "در حال اجرا",
  DONE: "انجام‌شده",
  REJECTED: "رد‌شده",
};
const STAGE_STATUS_TONES: Record<ProjectStageStatus, "primary" | "success" | "warning" | "neutral" | "danger"> = {
  PENDING: "neutral",
  AWAITING_APPROVAL: "warning",
  IN_PROGRESS: "primary",
  DONE: "success",
  REJECTED: "danger",
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
  const [stages, setStages] = useState<ProjectStage[]>(project.stages);
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState("");
  const [newStageNeedsApproval, setNewStageNeedsApproval] = useState(true);
  const [openDetailsId, setOpenDetailsId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ percent: project.progressPercent, done: project.stageProgress.done, total: project.stageProgress.total });
  const [docsVersion, setDocsVersion] = useState(0);
  const [rejectingStageId, setRejectingStageId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [completingStageId, setCompletingStageId] = useState<string | null>(null);
  const [completionReport, setCompletionReport] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editStageTitle, setEditStageTitle] = useState("");

  /** درصد پیشرفت را سرور حساب می‌کند؛ بعد از هر تغییر مرحله دوباره می‌خوانیم. */
  function refreshProgress() {
    fetchProject(project.id)
      .then((p) => setProgress({ percent: p.progressPercent, done: p.stageProgress.done, total: p.stageProgress.total }))
      .catch(() => undefined);
  }
  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

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

  function replaceStage(updated: ProjectStage) {
    setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    refreshProgress();
    onChanged();
  }

  async function runStageAction(fn: () => Promise<ProjectStage>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      replaceStage(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newStageTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const stage = await addProjectStage(project.id, newStageTitle.trim(), undefined, newStageNeedsApproval);
      setStages((prev) => [...prev, stage]);
      refreshProgress();
      setNewStageTitle("");
      setNewStageNeedsApproval(true);
      setAddStageOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "افزودن مرحله ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignResponsible(stageId: string, responsibleUserId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await assignProjectStage(project.id, stageId, responsibleUserId || undefined);
      replaceStage(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تخصیص مسئول ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(stageId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await completeStage(project.id, stageId, completionReport.trim() || undefined);
      replaceStage(updated);
      setCompletingStageId(null);
      setCompletionReport("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تکمیل مرحله ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(stageId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await rejectStage(project.id, stageId, rejectReason.trim() || undefined);
      replaceStage(updated);
      setRejectingStageId(null);
      setRejectReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "رد مرحله ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveStageTitle(stageId: string) {
    if (!editStageTitle.trim()) return;
    await runStageAction(() => updateProjectStage(project.id, stageId, { title: editStageTitle.trim() }));
    setEditingStageId(null);
  }

  async function handleDeleteStage(stageId: string) {
    if (!window.confirm("این مرحله حذف شود؟")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProjectStage(project.id, stageId);
      setStages((prev) => prev.filter((s) => s.id !== stageId));
      refreshProgress();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حذف مرحله ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

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
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={STATUS_TONES[project.status]}>{STATUS_LABELS[project.status]}</Badge>
          </div>
        </div>

        <div className="flex items-center gap-2 -mt-2">
          {project.status !== "COMPLETED" && project.status !== "CANCELLED" && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
            >
              ویرایش پروژه
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("این پروژه با همه‌ی مراحل و وظایفش برای همیشه حذف شود؟")) runAction(() => deleteProject(project.id));
            }}
            disabled={busy}
            className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          >
            حذف پروژه
          </button>
        </div>

        <div>
          <div className="text-[11.5px] text-muted mb-1.5">پیشرفت پروژه (بر اساس مراحل)</div>
          <ProjectProgressBar percent={progress.percent} done={progress.done} total={progress.total} />
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

        {project.members.length > 0 && (
          <div>
            <div className="text-[11px] text-muted mb-1.5">اعضای تیم اجرایی</div>
            <div className="flex flex-wrap gap-1.5">
              {project.members.map((m) => (
                <span key={m.id} className="text-[11.5px] font-semibold bg-slate-50 border border-border rounded-lg px-2.5 py-1">
                  {m.user.name}
                </span>
              ))}
            </div>
          </div>
        )}

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

        {/* مراحل پروژه */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] font-semibold text-ink-soft">مراحل پروژه</span>
            <button
              type="button"
              onClick={() => setAddStageOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-bold text-primary cursor-pointer"
            >
              <PlusIcon className="w-3 h-3" />
              افزودن مرحله
            </button>
          </div>

          {addStageOpen && (
            <form onSubmit={handleAddStage} className="flex flex-col gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={newStageTitle}
                  onChange={(e) => setNewStageTitle(e.target.value)}
                  placeholder="عنوان مرحله"
                  className="flex-1 text-[12.5px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2 focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={busy || !newStageTitle.trim()}
                  className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  افزودن
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-[11.5px] font-semibold cursor-pointer">
                <input type="checkbox" checked={newStageNeedsApproval} onChange={(e) => setNewStageNeedsApproval(e.target.checked)} className="w-3.5 h-3.5" />
                نیاز به تأیید مدیر
              </label>
            </form>
          )}

          {stages.length === 0 ? (
            <div className="text-[12px] text-muted bg-slate-50 rounded-xl p-3 text-center">مرحله‌ای ثبت نشده</div>
          ) : (
            <div className="flex flex-col gap-2">
              {stages.map((s, i) => (
                <div key={s.id} className="bg-slate-50 border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-muted shrink-0">{i + 1}.</span>
                      {editingStageId === s.id ? (
                        <input
                          autoFocus
                          value={editStageTitle}
                          onChange={(e) => setEditStageTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveStageTitle(s.id);
                            if (e.key === "Escape") setEditingStageId(null);
                          }}
                          className="text-[12.5px] font-bold outline-none bg-white border border-border rounded-lg px-2 py-1 min-w-0"
                        />
                      ) : (
                        <span className="text-[12.5px] font-bold truncate">{s.title}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {editingStageId === s.id ? (
                        <>
                          <button type="button" onClick={() => handleSaveStageTitle(s.id)} disabled={busy} className="text-[11px] font-bold text-primary cursor-pointer">
                            ذخیره
                          </button>
                          <button type="button" onClick={() => setEditingStageId(null)} className="text-[11px] font-bold text-ink-soft cursor-pointer">
                            انصراف
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStageId(s.id);
                              setEditStageTitle(s.title);
                            }}
                            className="text-[11px] font-bold text-ink-soft cursor-pointer"
                          >
                            ویرایش
                          </button>
                          <button type="button" onClick={() => handleDeleteStage(s.id)} disabled={busy} className="text-[11px] font-bold text-danger cursor-pointer disabled:opacity-50">
                            حذف
                          </button>
                        </>
                      )}
                      <Badge tone={STAGE_STATUS_TONES[s.status]}>{STAGE_STATUS_LABELS[s.status]}</Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[11px] text-muted shrink-0">مسئول مرحله:</span>
                    <select
                      value={s.responsibleUserId ?? ""}
                      onChange={(e) => handleAssignResponsible(s.id, e.target.value)}
                      disabled={busy || s.status === "DONE"}
                      className="flex-1 text-[11.5px] outline-none bg-white border border-border rounded-lg px-2 py-1 disabled:opacity-60"
                    >
                      <option value="">بدون تخصیص</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[11.5px] font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.requiresManagerApproval}
                        disabled={busy || s.status === "DONE"}
                        onChange={(e) => runStageAction(() => updateProjectStage(project.id, s.id, { requiresManagerApproval: e.target.checked }))}
                        className="w-3.5 h-3.5"
                      />
                      نیاز به تأیید مدیر
                    </label>
                    <button
                      type="button"
                      onClick={() => setOpenDetailsId((cur) => (cur === s.id ? null : s.id))}
                      className="text-[11px] font-bold text-primary cursor-pointer"
                    >
                      {openDetailsId === s.id ? "بستن جزئیات" : "جزئیات و نمایش به مشتری"}
                    </button>
                  </div>

                  {openDetailsId === s.id ? <StageDetailsPanel projectId={project.id} stage={s} onStageChanged={replaceStage} /> : null}

                  {s.status === "REJECTED" && s.rejectionReason && (
                    <div className="text-[11px] text-danger mt-1.5">دلیل رد: {s.rejectionReason}</div>
                  )}
                  {s.status === "DONE" && s.completionReport && (
                    <div className="text-[11.5px] text-ink-soft mt-1.5 bg-white border border-border rounded-lg p-2 whitespace-pre-wrap">
                      <span className="text-muted">گزارش تکمیل: </span>
                      {s.completionReport}
                    </div>
                  )}

                  {completingStageId === s.id ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <textarea
                        value={completionReport}
                        onChange={(e) => setCompletionReport(e.target.value)}
                        rows={2}
                        placeholder="گزارش/یادداشت نتیجه‌ی این مرحله (اختیاری)"
                        className="text-[11.5px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleComplete(s.id)}
                          disabled={busy}
                          className="text-[11px] font-bold text-white bg-success px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          ثبت تکمیل مرحله
                        </button>
                        <button
                          onClick={() => {
                            setCompletingStageId(null);
                            setCompletionReport("");
                          }}
                          className="text-[11px] font-bold text-ink-soft"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>
                  ) : rejectingStageId === s.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="دلیل رد (اختیاری)"
                        className="flex-1 text-[11.5px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5"
                      />
                      <button
                        onClick={() => handleReject(s.id)}
                        disabled={busy}
                        className="text-[11px] font-bold text-white bg-danger px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        تأیید رد
                      </button>
                      <button
                        onClick={() => setRejectingStageId(null)}
                        className="text-[11px] font-bold text-ink-soft"
                      >
                        انصراف
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mt-2">
                      {(s.status === "PENDING" || s.status === "REJECTED") && (
                        <button
                          onClick={() => runStageAction(() => requestStageStart(project.id, s.id))}
                          disabled={busy}
                          className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {s.requiresManagerApproval ? "درخواست شروع" : "شروع مرحله"}
                        </button>
                      )}
                      {(s.status === "PENDING" || s.status === "REJECTED") && !s.requiresManagerApproval && (
                        <button
                          onClick={() => {
                            setCompletingStageId(s.id);
                            setCompletionReport("");
                          }}
                          disabled={busy}
                          className="text-[11px] font-bold text-success bg-success-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          علامت‌گذاری به‌عنوان انجام‌شده
                        </button>
                      )}
                      {s.status === "AWAITING_APPROVAL" && (
                        <>
                          <button
                            onClick={() => runStageAction(() => approveStage(project.id, s.id))}
                            disabled={busy}
                            className="flex items-center gap-1 text-[11px] font-bold text-success bg-success-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            <CheckIcon className="w-3 h-3" />
                            تأیید مدیر
                          </button>
                          <button
                            onClick={() => setRejectingStageId(s.id)}
                            disabled={busy}
                            className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            رد
                          </button>
                        </>
                      )}
                      {s.status === "IN_PROGRESS" && (
                        <button
                          onClick={() => {
                            setCompletingStageId(s.id);
                            setCompletionReport("");
                          }}
                          disabled={busy}
                          className="text-[11px] font-bold text-success bg-success-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          علامت‌گذاری به‌عنوان انجام‌شده
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <ProjectShareSection projectId={project.id} />

        <ProjectDocumentsSection projectId={project.id} version={docsVersion} onCreateInvoice={() => setNewInvoiceOpen(true)} />

        <ProjectNotesSection projectId={project.id} />

        <TasksSection relatedModule="project" relatedEntityId={project.id} />
        <AttachmentsSection entityType="Project" entityId={project.id} />
      </div>

      {newInvoiceOpen && (
        <NewInvoiceModal
          onClose={() => setNewInvoiceOpen(false)}
          onCreated={() => {
            setDocsVersion((v) => v + 1);
            setNewInvoiceOpen(false);
          }}
          prefill={{ contactId: project.contactId ?? undefined, projectId: project.id }}
        />
      )}
      {editOpen ? (
        <NewProjectModal
          project={project}
          onClose={() => setEditOpen(false)}
          onCreated={() => {
            onChanged();
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}
