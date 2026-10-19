"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { PencilIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchDashboardLayout, type DashboardMyLayout, type DashboardWidgetSize } from "@/lib/api";
import { DashboardEditor } from "@/components/dashboard/DashboardEditor";
import { DashboardSummaryProvider, SUMMARY_WIDGET_KEYS, WIDGET_RENDERERS } from "@/components/dashboard/DashboardWidgets";

// کلاس‌ها باید کامل و ثابت باشند تا Tailwind آن‌ها را تولید کند. موبایل: S = نصف عرض (۲ ستون)، بقیه تمام‌عرض.
const SIZE_CLASS: Record<DashboardWidgetSize, string> = {
  S: "col-span-6 lg:col-span-3",
  M: "col-span-12 lg:col-span-6",
  L: "col-span-12 lg:col-span-8",
  FULL: "col-span-12",
};

function Skeleton() {
  return (
    <div className="grid grid-cols-12 gap-4" aria-busy="true" aria-label="در حال بارگذاری داشبورد">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="col-span-6 lg:col-span-3 h-[104px] rounded-2xl bg-slate-100 animate-pulse" />
      ))}
      <div className="col-span-12 lg:col-span-8 h-[260px] rounded-2xl bg-slate-100 animate-pulse" />
      <div className="col-span-12 lg:col-span-4 h-[260px] rounded-2xl bg-slate-100 animate-pulse" />
    </div>
  );
}

export function DashboardBody() {
  const { me } = useWorkspace();
  const [layout, setLayout] = useState<DashboardMyLayout | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    fetchDashboardLayout()
      .then((l) => {
        setLayout(l);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const firstName = (me?.user.name ?? "").split(" ")[0] || "همکار";
  const widgets = (layout?.widgets ?? []).filter((w) => WIDGET_RENDERERS[w.key]);
  const needsSummary = widgets.some((w) => SUMMARY_WIDGET_KEYS.has(w.key));

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1240px] mx-auto min-w-0">
      <div className="flex items-start justify-between mb-5 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">سلام {firstName}، خوش برگشتی</h1>
            <ModuleHelp code="dashboard" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">خلاصه‌ی امروز کسب‌وکار شما</p>
        </div>
        {layout ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 min-h-10 px-3.5 rounded-xl border border-border bg-surface text-[12.5px] font-bold text-ink-soft flex items-center gap-1.5 cursor-pointer hover:border-primary hover:text-primary"
          >
            <PencilIcon className="w-4 h-4" />
            <span>ویرایش داشبورد</span>
          </button>
        ) : null}
      </div>

      {failed ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
          بارگذاری داشبورد ناموفق بود.{" "}
          <button type="button" onClick={load} className="font-bold text-primary cursor-pointer">
            تلاش دوباره
          </button>
        </div>
      ) : !layout ? (
        <Skeleton />
      ) : widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
          هیچ ویجتی برای نمایش فعال نیست. از «ویرایش داشبورد» ویجت‌ها را اضافه کنید.
        </div>
      ) : (
        <DashboardSummaryProvider enabled={needsSummary}>
          <div className="grid grid-cols-12 gap-4 items-stretch">
            {widgets.map((w) => {
              const Widget = WIDGET_RENDERERS[w.key];
              return (
                <div key={w.key} data-widget={w.key} className={clsx("min-w-0 empty:hidden [&>*]:h-full", SIZE_CLASS[w.size])}>
                  <Widget size={w.size} variant={w.variant} />
                </div>
              );
            })}
          </div>
        </DashboardSummaryProvider>
      )}

      {editing && layout ? (
        <DashboardEditor
          layout={layout}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
