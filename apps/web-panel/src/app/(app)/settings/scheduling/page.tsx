"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchSchedulableJobs,
  updateSchedulableJob,
  ApiError,
  type SchedulableJob,
  type JobScheduleConfig,
} from "@/lib/api";

const MODULE_LABELS: Record<string, string> = {
  sales: "فروش",
  "daily-checklist": "چک‌لیست روزانه",
  warranty: "گارانتی",
  checks: "چک‌ها",
  contracts: "قراردادها",
  mentoring: "منتورینگ",
  "ration-lab": "آزمایشگاه جیره",
  "referral-marketing": "رفرال و نمایندگی",
};

function offsetKey(config: Pick<JobScheduleConfig, "offsetDays" | "unit">): string {
  return `${config.unit}:${config.offsetDays}`;
}

function offsetLabel(config: Pick<JobScheduleConfig, "offsetDays" | "unit">): string {
  if (config.unit === "SAME_DAY") return "همان روز";
  if (config.unit === "DAYS_BEFORE") return `${config.offsetDays} روز قبل`;
  return `${config.offsetDays} روز بعد`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export default function SchedulingSettingsPage() {
  const [jobs, setJobs] = useState<SchedulableJob[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, JobScheduleConfig>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSchedulableJobs()
      .then((rows) => {
        setJobs(rows);
        setDrafts(Object.fromEntries(rows.map((r) => [r.code, r.config])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "بارگذاری فهرست کارها ناموفق بود"));
  }, []);

  const groups = useMemo(() => {
    if (!jobs) return [];
    const byModule = new Map<string, SchedulableJob[]>();
    for (const job of jobs) {
      const list = byModule.get(job.moduleCode) ?? [];
      list.push(job);
      byModule.set(job.moduleCode, list);
    }
    return [...byModule.entries()].map(([moduleCode, items]) => ({
      moduleCode,
      label: MODULE_LABELS[moduleCode] ?? moduleCode,
      items,
    }));
  }, [jobs]);

  function updateDraft(code: string, patch: Partial<JobScheduleConfig>) {
    setDrafts((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  async function save(job: SchedulableJob) {
    const draft = drafts[job.code];
    if (!draft) return;
    setSavingCode(job.code);
    setError(null);
    try {
      const saved = await updateSchedulableJob(job.code, draft);
      setDrafts((prev) => ({ ...prev, [job.code]: saved }));
      setJobs((prev) => prev?.map((j) => (j.code === job.code ? { ...j, config: saved } : j)) ?? prev);
      setSavedCode(job.code);
      setTimeout(() => setSavedCode((c) => (c === job.code ? null : c)), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold mb-1">زمان‌بندی ارسال خودکار</h1>
      <p className="text-[13px] text-muted mb-5 max-w-[620px]">
        برای هر کارِ خودکارِ پیامکی/اعلانی، تعیین کنید نسبت به تاریخ رویداد چند روز قبل یا بعد، و در چه ساعتی از روز ارسال شود. برای کارهایی که هنوز به این تنظیم متصل نشده‌اند، فقط نمایشی است و زمان‌بندی فعلی‌شان ثابت باقی می‌ماند.
      </p>
      {error && <div className="text-[12.5px] text-danger mb-3">{error}</div>}

      {jobs === null ? (
        <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        groups.map((group) => (
          <div key={group.moduleCode} className="mb-6">
            <div className="text-[12.5px] font-bold text-muted mb-2">{group.label}</div>
            <Card className="p-2">
              {group.items.map((job, i) => {
                const draft = drafts[job.code] ?? job.config;
                const currentKey = offsetKey(draft);
                return (
                  <div
                    key={job.code}
                    className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i < group.items.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-[13.5px] font-bold">{job.label}</div>
                      {!job.behaviorWired && (
                        <div className="text-[11px] text-muted mt-0.5">نمایشی — زمان‌بندی واقعی این کار هنوز ثابت است</div>
                      )}
                    </div>

                    <select
                      value={currentKey}
                      disabled={savingCode === job.code}
                      onChange={(e) => {
                        const preset = job.allowedOffsets.find((o) => offsetKey(o) === e.target.value);
                        if (preset) updateDraft(job.code, { offsetDays: preset.offsetDays, unit: preset.unit });
                      }}
                      className="w-[140px] text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
                    >
                      {job.allowedOffsets.map((o) => (
                        <option key={offsetKey(o)} value={offsetKey(o)}>
                          {offsetLabel(o)}
                        </option>
                      ))}
                    </select>

                    <input
                      type="time"
                      value={`${pad2(draft.hour)}:${pad2(draft.minute)}`}
                      disabled={savingCode === job.code}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map(Number);
                        if (Number.isFinite(h) && Number.isFinite(m)) updateDraft(job.code, { hour: h, minute: m });
                      }}
                      className="w-[110px] text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
                    />

                    <button
                      type="button"
                      disabled={savingCode === job.code}
                      onClick={() => save(job)}
                      className="text-[12.5px] font-bold px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer"
                    >
                      {savingCode === job.code ? "در حال ذخیره..." : "ذخیره"}
                    </button>

                    {savedCode === job.code && <span className="text-[12px] text-success font-semibold">ذخیره شد ✓</span>}
                  </div>
                );
              })}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}
