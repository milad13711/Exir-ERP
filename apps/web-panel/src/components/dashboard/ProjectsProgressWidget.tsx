"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ProjectProgressBar } from "@/components/projects/ProjectProgressBar";
import { toPersianDigits } from "@/lib/persian";
import { fetchProjects, type Project } from "@/lib/api";

const OPEN = new Set(["PLANNING", "ACTIVE", "ON_HOLD"]);

/**
 * ویجت داشبورد «پروژه‌های در جریان» با نوار درصد پیشرفت (محاسبه‌ی سرور از مراحل). فقط وقتی ماژول پروژه نصب است
 * رندر می‌شود؛ اگر کاربر دسترسی مشاهده ندارد یا خطایی رخ دهد، بی‌صدا پنهان می‌ماند.
 */
export function ProjectsProgressWidget() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    fetchProjects()
      .then((r) => setProjects(r))
      .catch(() => setHidden(true));
  }, []);

  if (hidden || !projects) return null;
  const open = projects
    .filter((p) => OPEN.has(p.status))
    .sort((a, b) => (a.endDate ? new Date(a.endDate).getTime() : Infinity) - (b.endDate ? new Date(b.endDate).getTime() : Infinity))
    .slice(0, 6);

  return (
    <Card className="p-5 mb-5" data-testid="projects-progress-widget">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[14.5px] font-bold">پروژه‌های در جریان</span>
        <Link href="/projects" className="text-[12px] font-bold text-primary">
          مشاهده‌ی همه
        </Link>
      </div>
      {open.length === 0 ? (
        <div className="text-[12.5px] text-muted py-3">پروژه‌ی بازی وجود ندارد.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {open.map((p) => (
            <Link key={p.id} href="/projects" className="border border-border rounded-xl p-3 hover:border-primary transition-colors flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold truncate">{p.name}</span>
                <span className="text-[11px] text-muted shrink-0">#{toPersianDigits(p.projectNo)}</span>
              </div>
              <ProjectProgressBar percent={p.progressPercent} done={p.stageProgress.done} total={p.stageProgress.total} size="sm" />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
