"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { LogIcon, PlusIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import { fetchReports, fetchReportCategories, type Report, type ReportCategory } from "@/lib/api";
import { NewReportModal } from "@/components/reports/NewReportModal";
import { ReportDetailModal } from "@/components/reports/ReportDetailModal";
import { ReportCategoriesTab } from "@/components/reports/ReportCategoriesTab";

type ViewFilter = "all" | "referredToMe" | "knowledge" | "archived";

const VIEW_TABS: { key: ViewFilter; label: string }[] = [
  { key: "all", label: "همه‌ی گزارش‌ها" },
  { key: "referredToMe", label: "ارجاع‌شده به من" },
  { key: "knowledge", label: "دانش سازمانی" },
  { key: "archived", label: "آرشیو" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<ViewFilter>("all");
  const [showCategories, setShowCategories] = useState(false);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">گزارش‌ها</h1>
            <ModuleHelp code="reports" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">ثبت، ارجاع، پاراف و آرشیو گزارش‌های سازمانی</p>
        </div>
        <button
          onClick={() => setShowCategories(true)}
          className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2 rounded-xl cursor-pointer"
        >
          دسته‌بندی‌ها
        </button>
      </div>

      <div className="flex items-center gap-2 mt-6 mb-5 flex-wrap">
        {VIEW_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px] transition-colors cursor-pointer",
              tab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ReportsList tab={tab} />

      {showCategories && <ReportCategoriesTab onClose={() => setShowCategories(false)} />}
    </div>
  );
}

function ReportsList({ tab }: { tab: ViewFilter }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function reload() {
    fetchReports({
      categoryId: categoryFilter || undefined,
      referredToMe: tab === "referredToMe" ? true : undefined,
      isKnowledge: tab === "knowledge" ? true : undefined,
      isArchived: tab === "archived" ? true : tab === "all" ? false : undefined,
    })
      .then(setReports)
      .catch(() => setReports([]));
  }
  useEffect(reload, [tab, categoryFilter]);
  useEffect(() => {
    fetchReportCategories().then(setCategories);
  }, []);

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2.5 outline-none focus:border-primary"
        >
          <option value="">همه‌ی دسته‌بندی‌ها</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          گزارش جدید
        </button>
      </div>

      <Card className="p-2">
        {reports === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">گزارشی یافت نشد</div>
        ) : (
          reports.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setDetailId(r.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < reports.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <LogIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">
                  <span dir="ltr" className="text-muted">
                    #{toPersianDigits(r.reportNo)}
                  </span>{" "}
                  {r.title}
                </div>
                <div className="text-[11.5px] text-muted mt-0.5 truncate">
                  <span className="font-bold text-ink-soft">گزارش‌دهنده: {r.createdBy?.name ?? "نامشخص"}</span>
                  {" · "}
                  {r.category?.name ?? "بدون دسته‌بندی"}
                  {r.executionAt ? ` · زمان اجرا: ${formatJalaliDate(r.executionAt)}` : ""}
                  {r.referrals.length > 0 ? ` · ${toPersianDigits(r.referrals.length)} ارجاع` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.isKnowledge && <Badge tone="primary">دانش سازمانی</Badge>}
                {r.isArchived && <Badge tone="neutral">آرشیو</Badge>}
              </div>
            </button>
          ))
        )}
      </Card>

      {newOpen && (
        <NewReportModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            reload();
            setDetailId(id);
          }}
        />
      )}
      {detailId && <ReportDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}
