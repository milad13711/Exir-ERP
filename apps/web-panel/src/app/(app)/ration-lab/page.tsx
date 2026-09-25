"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { FlaskIcon, SendIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { fetchRationSamples, type RationSample, type RationSampleStatus } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const STATUS_LABELS: Record<RationSampleStatus, string> = {
  COLLECTED: "جمع‌آوری اولیه",
  IN_TRANSIT: "انتقال به آزمایشگاه",
  LAB_CONFIRMED: "تأیید تحویل آزمایشگاه",
  REPORT_SUBMITTED: "ثبت نظر متخصص",
  SENT_TO_EXPERT: "ارسال‌شده برای کارشناس",
  VIEWED_BY_FARMER: "رویت‌شده توسط دامدار",
};
const STATUS_TONES: Record<RationSampleStatus, "warning" | "primary" | "success" | "neutral" | "accent"> = {
  COLLECTED: "neutral",
  IN_TRANSIT: "warning",
  LAB_CONFIRMED: "accent",
  REPORT_SUBMITTED: "primary",
  SENT_TO_EXPERT: "primary",
  VIEWED_BY_FARMER: "success",
};

type Filter = "ALL" | RationSampleStatus;

export default function RationLabPage() {
  const [samples, setSamples] = useState<RationSample[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [copied, setCopied] = useState<"lab" | "result" | null>(null);
  const { me } = useWorkspace();

  useEffect(() => {
    fetchRationSamples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const filtered = samples?.filter((s) => filter === "ALL" || s.status === filter) ?? null;

  async function copyLink(kind: "lab" | "result") {
    if (!me) return;
    const path = kind === "lab" ? "lab-review" : "ration-result";
    const url = `${window.location.origin}/${path}/${me.tenant.publicKey ?? me.tenant.slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => copyLink("lab")}
            disabled={!me}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <SendIcon className="w-4 h-4" />
            {copied === "lab" ? "لینک کپی شد" : "لینک ورود آزمایشگاه"}
          </button>
          <button
            onClick={() => copyLink("result")}
            disabled={!me}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <SendIcon className="w-4 h-4" />
            {copied === "result" ? "لینک کپی شد" : "لینک نتیجه برای دامدار"}
          </button>
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

      <p className="text-[11.5px] text-muted mt-3">
        «لینک ورود آزمایشگاه» را فقط به کارشناسانی که در «کارشناسان آزمایشگاه» ثبت کرده‌اید بدهید — «لینک نتیجه برای
        دامدار» را می‌توانید عمومی به همه‌ی دامداران بدهید، هرکس فقط نمونه‌های متصل به شماره‌ی خودش را می‌بیند.
      </p>

      <div className="flex items-center gap-2 mt-6 border-b border-border overflow-x-auto">
        {(
          [
            ["ALL", "همه"],
            ["COLLECTED", "جمع‌آوری اولیه"],
            ["IN_TRANSIT", "انتقال به آزمایشگاه"],
            ["LAB_CONFIRMED", "تأیید تحویل آزمایشگاه"],
            ["REPORT_SUBMITTED", "ثبت نظر متخصص"],
            ["SENT_TO_EXPERT", "ارسال‌شده برای کارشناس"],
            ["VIEWED_BY_FARMER", "رویت‌شده توسط دامدار"],
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
                  #{s.sampleNo}
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
