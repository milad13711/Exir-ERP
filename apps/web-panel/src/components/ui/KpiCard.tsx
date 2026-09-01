import type { ReactNode } from "react";
import clsx from "clsx";
import { formatNumber } from "@/lib/persian";
import { ArrowUpIcon } from "@/components/icons";

const toneClasses = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

export function KpiCard({
  label,
  value,
  unit,
  unitSuffix,
  valueSuffix,
  delta,
  note,
  tone,
  icon,
}: {
  label: string;
  value: number;
  unit?: string;
  unitSuffix?: string;
  valueSuffix?: string;
  delta?: string;
  note?: string;
  tone: keyof typeof toneClasses;
  icon: ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        <div
          className={clsx(
            "w-8.5 h-8.5 rounded-[10px] flex items-center justify-center",
            toneClasses[tone],
          )}
        >
          <div className="w-4.5 h-4.5">{icon}</div>
        </div>
      </div>
      <div className="text-2xl font-extrabold mt-3.5">
        {formatNumber(value)}
        {valueSuffix}
        {unitSuffix ? <span className="text-sm font-normal text-ink-soft"> {unitSuffix}</span> : null}
        {unit ? <span className="text-xs font-medium text-muted"> {unit}</span> : null}
      </div>
      {delta ? (
        <div className="text-xs text-success font-semibold mt-1.5 flex items-center gap-1">
          <ArrowUpIcon className="w-3 h-3" />
          {delta} نسبت به دیروز
        </div>
      ) : null}
      {note ? (
        <div
          className={clsx(
            "text-xs font-semibold mt-1.5",
            tone === "warning" ? "text-warning" : "text-muted",
          )}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
