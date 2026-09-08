"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuildingIcon, PlusIcon, SearchIcon, WarningIcon, SettingsIcon, DashboardIcon, OrdersIcon, SendIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchProjects, type Project, type ProjectStatus } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { ProjectDetailModal } from "@/components/projects/ProjectDetailModal";
import { StageTemplatesModal } from "@/components/projects/StageTemplatesModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
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
const KANBAN_COLUMNS: ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
const OPEN_STATUSES: ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD"];

type StatusFilter = "همه" | ProjectStatus;

/** روزهای باقی‌مانده تا مهلت — منفی یعنی از موعد گذشته. فقط برای پروژه‌های هنوز باز محاسبه می‌شود. */
function daysUntilDeadline(p: Project): number | null {
  if (!p.endDate || !OPEN_STATUSES.includes(p.status)) return null;
  return Math.ceil((new Date(p.endDate).getTime() - Date.now()) / 86_400_000);
}

function DeadlineBadge({ project }: { project: Project }) {
  const days = daysUntilDeadline(project);
  if (days == null || days > 7) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-1 rounded-lg shrink-0",
        days < 0 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
      )}
    >
      <WarningIcon className="w-3 h-3" />
      {days < 0 ? `${Math.abs(days)} روز عقب‌افتاده` : days === 0 ? "امروز ددلاین" : `${days} روز مانده`}
    </span>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [newOpen, setNewOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { me } = useWorkspace();

  function reload() {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }
  useEffect(reload, []);

  async function copyTrackingLink() {
    if (!me) return;
    const url = `${window.location.origin}/track/${me.tenant.slug}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const filtered = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      const matchesStatus = statusFilter === "همه" || p.status === statusFilter;
      const matchesSearch =
        !search.trim() || p.name.includes(search) || (p.contact?.name.includes(search) ?? false) || String(p.projectNo).includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, statusFilter]);

  function ProjectCard({ p }: { p: Project }) {
    const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
    return (
      <button
        onClick={() => setOpenProject(p)}
        className="w-full text-right p-3.5 rounded-xl bg-white border border-border hover:border-primary transition-colors flex flex-col gap-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[13px] font-bold truncate">{p.name}</div>
          <DeadlineBadge project={p} />
        </div>
        <div className="text-[11px] text-muted">
          #{p.projectNo}
          {p.contact ? ` · ${p.contact.name}` : ""}
        </div>
        {p.progress.total > 0 && (
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
          </div>
        )}
        {p.budget != null && <div className="text-[12px] font-extrabold">{formatToman(p.budget)}</div>}
      </button>
    );
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">مدیریت پروژه</h1>
            <ModuleHelp code="projects" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">پروژه‌ها، پیشرفت بر اساس وظایف، بودجه و مهلت</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setTemplatesOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            قالب‌های مراحل
          </button>
          <button
            onClick={copyTrackingLink}
            disabled={!me}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <SendIcon className="w-4 h-4" />
            {linkCopied ? "لینک کپی شد" : "لینک پیگیری مشتری"}
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            پروژه جدید
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام پروژه، مشتری یا شماره..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 mr-auto">
          <button
            onClick={() => setView("list")}
            className={clsx("w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer", view === "list" ? "bg-white text-primary shadow-sm" : "text-muted")}
            aria-label="نمای فهرستی"
          >
            <DashboardIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView("kanban")}
            className={clsx("w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer", view === "kanban" ? "bg-white text-primary shadow-sm" : "text-muted")}
            aria-label="نمای کانبان"
          >
            <OrdersIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {projects === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted text-sm">پروژه‌ای یافت نشد</Card>
      ) : view === "list" ? (
        <Card className="p-2">
          {filtered.map((p, i) => {
            const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
            return (
              <button
                key={p.id}
                onClick={() => setOpenProject(p)}
                className={clsx(
                  "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                  i < filtered.length - 1 && "border-b border-border",
                )}
              >
                <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <BuildingIcon className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-bold truncate">{p.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    #{p.projectNo}
                    {p.contact ? ` · ${p.contact.name}` : ""}
                    {p.progress.total > 0 ? ` · ${p.progress.done}/${p.progress.total} وظیفه (${pct}%)` : ""}
                  </div>
                </div>
                <DeadlineBadge project={p} />
                {p.endDate && (
                  <div className="text-[12px] text-muted w-[130px] text-left shrink-0 hidden sm:block">
                    تا {formatJalaliDate(p.endDate)}
                  </div>
                )}
                {p.budget != null && (
                  <div className="text-[13px] font-extrabold w-[110px] text-left shrink-0 hidden sm:block">
                    {formatToman(p.budget)}
                  </div>
                )}
                <Badge tone={STATUS_TONES[p.status]}>{STATUS_LABELS[p.status]}</Badge>
              </button>
            );
          })}
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {KANBAN_COLUMNS.map((status) => {
            const items = filtered.filter((p) => p.status === status);
            return (
              <div key={status} className="w-[270px] shrink-0 flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12.5px] font-bold">{STATUS_LABELS[status]}</span>
                  <span className="text-[11px] text-muted">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2 min-h-[60px]">
                  {items.map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {newOpen ? <NewProjectModal onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      {templatesOpen ? <StageTemplatesModal onClose={() => setTemplatesOpen(false)} onChanged={reload} /> : null}
      {openProject ? (
        <ProjectDetailModal project={openProject} onClose={() => setOpenProject(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
