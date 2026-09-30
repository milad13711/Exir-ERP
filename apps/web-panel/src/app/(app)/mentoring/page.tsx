"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CompassIcon, PlusIcon, SearchIcon, BoltIcon, BellIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";
import {
  fetchMentoringEngagements,
  fetchMentoringOverview,
  fetchMentoringSmsSettings,
  updateMentoringSmsSettings,
  type MentoringEngagement,
  type MentoringEngagementStatus,
  type MentoringOverview,
  type MentoringSmsSettings,
} from "@/lib/api";
import { NewEngagementModal } from "@/components/mentoring/NewEngagementModal";
import { EngagementDetailModal } from "@/components/mentoring/EngagementDetailModal";
import { MentoringReportsModal } from "@/components/mentoring/MentoringReportsModal";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { SmsTemplatesModal } from "@/components/sms/SmsTemplatesModal";

const STATUS_LABELS: Record<MentoringEngagementStatus, string> = {
  ACTIVE: "فعال",
  PAUSED: "متوقف‌شده",
  COMPLETED: "پایان‌یافته",
  CANCELLED: "لغوشده",
};
const STATUS_TONES: Record<MentoringEngagementStatus, "success" | "warning" | "primary" | "neutral"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "primary",
  CANCELLED: "neutral",
};
const PRICING_LABELS_FA: Record<string, string> = { HOURLY: "ساعتی", PACKAGE: "بسته‌ای", PROJECT_BASED: "پروژه‌ای", SUBSCRIPTION: "اشتراکی" };

type StatusFilter = "همه" | MentoringEngagementStatus;

export default function MentoringPage() {
  const [engagements, setEngagements] = useState<MentoringEngagement[] | null>(null);
  const [overview, setOverview] = useState<MentoringOverview | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [newOpen, setNewOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [openEngagementId, setOpenEngagementId] = useState<string | null>(null);
  const [smsSettingsOpen, setSmsSettingsOpen] = useState(false);

  function reload() {
    fetchMentoringEngagements().then(setEngagements).catch(() => setEngagements([]));
    fetchMentoringOverview().then(setOverview).catch(() => setOverview(null));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!engagements) return [];
    return engagements.filter((e) => {
      const matchesStatus = statusFilter === "همه" || e.status === statusFilter;
      const matchesSearch = !search.trim() || e.title.includes(search) || e.contact.name.includes(search) || e.advisor.name.includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [engagements, search, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">منتورینگ، مشاوره و کوچینگ</h1>
            <ModuleHelp code="mentoring" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">همکاری با مشتریان، جلسات، اهداف پیشرفت و گزارش‌ها</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setReportsOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <BoltIcon className="w-4 h-4" />
            گزارش‌ها
          </button>
          <button
            onClick={() => setSmsSettingsOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <BellIcon className="w-4 h-4" />
            تنظیمات پیامک
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            همکاری جدید
          </button>
        </div>
      </div>

      {smsSettingsOpen ? (
        <SmsTemplatesModal<MentoringSmsSettings>
          title="تنظیمات پیامک — منتورینگ"
          fetchSettings={fetchMentoringSmsSettings}
          updateSettings={updateMentoringSmsSettings}
          onClose={() => setSmsSettingsOpen(false)}
          fields={[
            { label: "ثبت جلسه — مشتری", key: "scheduledContactTemplate", placeholders: "{title} {when} {mode} {addressPart}" },
            { label: "ثبت جلسه — مشاور", key: "scheduledAdvisorTemplate", placeholders: "{contactName} {when} {mode}" },
            { label: "یادآوری جلسه — مشتری", key: "reminderContactTemplate", placeholders: "{title} {when}" },
            { label: "یادآوری جلسه — مشاور", key: "reminderAdvisorTemplate", placeholders: "{contactName} {when}" },
            { label: "نظرسنجی پس از پایان جلسه", key: "surveyTemplate", placeholders: "{title} {link}" },
          ]}
        />
      ) : null}

      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <Card className="p-3.5">
            <div className="text-[11.5px] text-muted">همکاری فعال</div>
            <div className="text-lg font-extrabold mt-1">{toPersianDigits(overview.activeEngagements)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11.5px] text-muted">جلسات این ماه</div>
            <div className="text-lg font-extrabold mt-1">{toPersianDigits(overview.sessionsThisMonth)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11.5px] text-muted">جلسات هفته‌ی آینده</div>
            <div className="text-lg font-extrabold mt-1">{toPersianDigits(overview.upcomingSessions7d)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11.5px] text-muted">درآمد این ماه</div>
            <div className="text-lg font-extrabold mt-1">{formatToman(overview.revenueThisMonth)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11.5px] text-muted">رضایت مشتریان</div>
            <div className="text-lg font-extrabold mt-1">
              {overview.avgSatisfaction != null ? `${toPersianDigits(overview.avgSatisfaction)} از ۵` : "—"}
            </div>
            {overview.surveyResponseCount > 0 && (
              <div className="text-[10.5px] text-muted mt-0.5">از {toPersianDigits(overview.surveyResponseCount)} نظرسنجی</div>
            )}
          </Card>
        </div>
      )}

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی عنوان، مشتری یا مشاور..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
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
        {engagements === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">همکاری‌ای یافت نشد</div>
        ) : (
          filtered.map((e, i) => (
            <button
              key={e.id}
              onClick={() => setOpenEngagementId(e.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < filtered.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <CompassIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">{e.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {e.contact.name} · مشاور: {e.advisor.name} · {PRICING_LABELS_FA[e.pricingModel]}
                </div>
              </div>
              <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {newOpen && <NewEngagementModal onClose={() => setNewOpen(false)} onCreated={reload} />}
      {reportsOpen && <MentoringReportsModal onClose={() => setReportsOpen(false)} />}
      {openEngagementId && <EngagementDetailModal engagementId={openEngagementId} onClose={() => setOpenEngagementId(null)} onChanged={reload} />}
    </div>
  );
}
