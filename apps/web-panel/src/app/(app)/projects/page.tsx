"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BuildingIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import { fetchProjects, type Project, type ProjectStatus } from "@/lib/api";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { ProjectDetailModal } from "@/components/projects/ProjectDetailModal";

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

type StatusFilter = "همه" | ProjectStatus;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [openProject, setOpenProject] = useState<Project | null>(null);

  function reload() {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      const matchesStatus = statusFilter === "همه" || p.status === statusFilter;
      const matchesSearch =
        !search.trim() || p.name.includes(search) || (p.contact?.name.includes(search) ?? false) || String(p.projectNo).includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">مدیریت پروژه</h1>
          <p className="text-[13.5px] text-muted mt-1">پروژه‌ها، پیشرفت بر اساس وظایف، بودجه و مهلت</p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          پروژه جدید
        </button>
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
      </div>

      <Card className="p-2">
        {projects === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">پروژه‌ای یافت نشد</div>
        ) : (
          filtered.map((p, i) => {
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
          })
        )}
      </Card>

      {newOpen ? <NewProjectModal onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      {openProject ? (
        <ProjectDetailModal project={openProject} onClose={() => setOpenProject(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
