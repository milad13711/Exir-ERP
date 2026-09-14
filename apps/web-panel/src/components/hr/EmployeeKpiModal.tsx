"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/KpiCard";
import { StarIcon, CalendarIcon, ClipboardCheckIcon, HeartIcon, DocsIcon } from "@/components/icons";
import { toPersianDigits, formatJalaliDate } from "@/lib/persian";
import { fetchEmployeeKpi, type EmployeeKpi } from "@/lib/api";

type Preset = "thisMonth" | "last3Months" | "thisYear";

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  if (preset === "thisMonth") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (preset === "last3Months") from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  else from = new Date(now.getFullYear(), 0, 1);
  return { from: from.toISOString(), to };
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: "thisMonth", label: "این ماه" },
  { key: "last3Months", label: "۳ ماه اخیر" },
  { key: "thisYear", label: "امسال" },
];

function scoreTone(score: number | null): "success" | "warning" | "danger" {
  if (score == null || score < 40) return "danger";
  if (score < 70) return "warning";
  return "success";
}

export function EmployeeKpiModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [kpi, setKpi] = useState<EmployeeKpi | null>(null);

  useEffect(() => {
    const { from, to } = presetRange(preset);
    setKpi(null);
    fetchEmployeeKpi(employeeId, from, to).then(setKpi);
  }, [employeeId, preset]);

  return (
    <Modal title="گزارش KPI" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer ${
                preset === p.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {!kpi ? (
          <div className="text-center text-muted py-10 text-sm">در حال محاسبه...</div>
        ) : (
          <>
            <div className="text-[12px] text-muted">
              بازه: {formatJalaliDate(kpi.period.from)} تا {formatJalaliDate(kpi.period.to)}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard
                label="نمره‌ی کلی KPI"
                value={kpi.overallScore ?? 0}
                unitSuffix="از ۱۰۰"
                tone={scoreTone(kpi.overallScore)}
                icon={<StarIcon />}
              />
              <KpiCard
                label="نرخ حضور"
                value={kpi.attendance.rate ?? 0}
                unitSuffix="٪"
                note={`حاضر ${toPersianDigits(kpi.attendance.present)} · غایب ${toPersianDigits(kpi.attendance.absent)}`}
                tone="primary"
                icon={<CalendarIcon />}
              />
              <KpiCard
                label="تکمیل وظایف"
                value={kpi.tasks?.completionRate ?? 0}
                unitSuffix="٪"
                note={kpi.tasks ? `${toPersianDigits(kpi.tasks.completed)} از ${toPersianDigits(kpi.tasks.assigned)}` : "بدون حساب کاربری"}
                tone="accent"
                icon={<ClipboardCheckIcon />}
              />
              <KpiCard
                label="پاداش / جریمه"
                value={kpi.netRewardScore}
                note={`${toPersianDigits(kpi.rewardsCount)} پاداش · ${toPersianDigits(kpi.penaltiesCount)} جریمه`}
                tone={kpi.netRewardScore >= 0 ? "success" : "danger"}
                icon={<HeartIcon />}
              />
              <KpiCard
                label="رکورد ایجادشده"
                value={kpi.totalRecordsCreated}
                note={`در ${toPersianDigits(kpi.moduleActivity.length)} ماژول`}
                tone="warning"
                icon={<DocsIcon />}
              />
            </div>

            <div>
              <div className="text-[12px] text-muted mb-2">فعالیت به تفکیک ماژول (بر اساس دسترسی‌های این فرد)</div>
              {kpi.moduleActivity.length === 0 ? (
                <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
                  رکوردی در این بازه ثبت نشده است
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {kpi.moduleActivity.map((m) => (
                    <div
                      key={m.moduleCode}
                      className="flex items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                    >
                      <span className="text-[12.5px] font-semibold">{m.label}</span>
                      <span className="text-[12.5px] font-bold text-primary shrink-0">{toPersianDigits(m.recordsCreated)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
