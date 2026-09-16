"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { FlaskIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { fetchRationSamples, type RationSample, type RationSampleStatus } from "@/lib/api";

const STATUS_LABELS: Record<RationSampleStatus, string> = {
  AWAITING_LAB: "در انتظار آزمایشگاه",
  LAB_REVIEWED: "گزارش آمده",
  RESULT_SHARED: "نتیجه دیده‌شده",
};
const STATUS_TONES: Record<RationSampleStatus, "warning" | "primary" | "success"> = {
  AWAITING_LAB: "warning",
  LAB_REVIEWED: "primary",
  RESULT_SHARED: "success",
};

type Filter = "ALL" | RationSampleStatus;

export default function RationLabPage() {
  const [samples, setSamples] = useState<RationSample[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    fetchRationSamples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const filtered = samples?.filter((s) => filter === "ALL" || s.status === filter) ?? null;

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">آزمایشگاه جیره</h1>
            <ModuleHelp code="ration-lab" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">نمونه‌برداری از جیره‌ی دامداران و پیگیری نتیجه</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/ration-lab/reviewers" className="px-4 py-2.5 rounded-xl border border-border text-[12.5px] font-bold">
            کارشناسان آزمایشگاه
          </Link>
          <Link href="/ration-lab/reports" className="px-4 py-2.5 rounded-xl border border-border text-[12.5px] font-bold">
            گزارش تجمیعی
          </Link>
          <Link href="/ration-lab/new" className="px-4 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold">
            ثبت نمونه‌ی جدید
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-6 border-b border-border overflow-x-auto">
        {(
          [
            ["ALL", "همه"],
            ["AWAITING_LAB", "در انتظار آزمایشگاه"],
            ["LAB_REVIEWED", "گزارش آمده"],
            ["RESULT_SHARED", "نتیجه دیده‌شده"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors whitespace-nowrap ${
              filter === key ? "border-primary text-primary" : "border-transparent text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="mt-5 p-2">
        {filtered === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <FlaskIcon className="w-6 h-6" />
            نمونه‌ای در این وضعیت یافت نشد
          </div>
        ) : (
          filtered.map((s, i) => (
            <Link
              key={s.id}
              href={`/ration-lab/${s.id}`}
              className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${
                i < filtered.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold" dir="ltr">
                  {s.sampleCode}
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {s.contact.name}
                  {" · "}
                  {formatJalaliDate(s.collectedAt)}
                  {s.collectedBy ? ` · ${s.collectedBy.name}` : ""}
                </div>
              </div>
              <Badge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</Badge>
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
