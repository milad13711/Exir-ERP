"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BillingIcon, PlusIcon, SettingsIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchChecks,
  fetchCheckReminderChannels,
  type Check,
  type CheckDirection,
  type CheckStatus,
} from "@/lib/api";
import { NewCheckModal } from "@/components/checks/NewCheckModal";
import { CheckDetailModal } from "@/components/checks/CheckDetailModal";
import { CheckReminderSettingsModal } from "@/components/checks/CheckReminderSettingsModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const STATUS_LABELS_BY_DIRECTION: Record<CheckDirection, Record<CheckStatus, string>> = {
  RECEIVED: {
    PENDING: "ثبت‌شده",
    DEPOSITED: "واگذار به بانک",
    CLEARED: "پاس‌شده",
    BOUNCED: "برگشت‌خورده",
    CANCELLED: "باطل‌شده",
    ENDORSED: "پشت‌نویسی‌شده",
  },
  ISSUED: {
    PENDING: "صادرشده",
    DEPOSITED: "نزد بانک طرف مقابل",
    CLEARED: "پاس‌شده",
    BOUNCED: "برگشت‌خورده",
    CANCELLED: "باطل‌شده",
    ENDORSED: "پشت‌نویسی‌شده",
  },
};

const STATUS_TONES: Record<CheckStatus, "neutral" | "warning" | "success" | "danger" | "primary"> = {
  PENDING: "warning",
  DEPOSITED: "primary",
  CLEARED: "success",
  BOUNCED: "danger",
  CANCELLED: "neutral",
  ENDORSED: "primary",
};

type DirectionFilter = "ALL" | CheckDirection;

export default function ChecksPage() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const [openCheck, setOpenCheck] = useState<Check | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [now] = useState(() => Date.now());

  function reload() {
    fetchChecks(direction === "ALL" ? undefined : { direction })
      .then(setChecks)
      .catch(() => setChecks([]));
  }
  useEffect(reload, [direction]);
  useEffect(() => {
    fetchCheckReminderChannels()
      .then((res) => {
        setSmsEnabled(res.sms);
        setNotificationEnabled(res.notification);
      })
      .catch(() => {});
  }, []);

  const pendingSoon = (checks ?? []).filter((c) => {
    if (c.status !== "PENDING" && c.status !== "DEPOSITED") return false;
    const daysLeft = Math.ceil((new Date(c.dueDate).getTime() - now) / 86_400_000);
    return daysLeft <= 7;
  });

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">چک‌های دریافتی و صادرشده</h1>
            <ModuleHelp code="checks" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            رهگیری چک با شماره صیادی و سررسید — با یادآوری خودکار پیش از موعد
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSettingsOpen(true)}
            title="تنظیمات یادآوری"
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            تنظیمات یادآوری
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            چک جدید
          </button>
        </div>
      </div>

      {pendingSoon.length > 0 ? (
        <div className="bg-warning-soft text-warning text-[12.5px] rounded-xl px-3.5 py-2.5 mt-5">
          {pendingSoon.length} چک ظرف ۷ روز آینده سررسید می‌شود.
        </div>
      ) : null}

      <div className="flex items-center gap-2 mt-6 mb-4">
        {(
          [
            ["ALL", "همه"],
            ["RECEIVED", "دریافتی"],
            ["ISSUED", "صادرشده"],
          ] as [DirectionFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setDirection(key)}
            className={`text-[12px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer ${
              direction === key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {checks === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : checks.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <BillingIcon className="w-6 h-6" />
            چکی ثبت نشده است
          </div>
        ) : (
          checks.map((c, i) => {
            const party = c.contact;
            const daysLeft = Math.ceil((new Date(c.dueDate).getTime() - now) / 86_400_000);
            return (
              <button
                key={c.id}
                onClick={() => setOpenCheck(c)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < checks.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{party?.company || party?.name || "—"}</span>
                    <Badge tone={c.direction === "RECEIVED" ? "primary" : "accent"}>
                      {c.direction === "RECEIVED" ? "دریافتی" : "صادرشده"}
                    </Badge>
                    <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS_BY_DIRECTION[c.direction][c.status]}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1" dir="ltr">
                    صیادی: {c.sayadId} · سررسید: {formatJalaliDate(c.dueDate)}
                    {(c.status === "PENDING" || c.status === "DEPOSITED") && daysLeft >= 0 && daysLeft <= 7 ? ` (${daysLeft} روز مانده)` : ""}
                  </div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0">{formatToman(c.amount)}</div>
              </button>
            );
          })
        )}
      </Card>

      {newOpen ? (
        <NewCheckModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            reload();
          }}
        />
      ) : null}

      {openCheck ? (
        <CheckDetailModal
          check={openCheck}
          onClose={() => setOpenCheck(null)}
          onChanged={() => {
            reload();
          }}
        />
      ) : null}

      {settingsOpen ? (
        <CheckReminderSettingsModal
          currentSms={smsEnabled}
          currentNotification={notificationEnabled}
          onClose={() => setSettingsOpen(false)}
          onSaved={(sms, notification) => {
            setSmsEnabled(sms);
            setNotificationEnabled(notification);
          }}
        />
      ) : null}
    </div>
  );
}
