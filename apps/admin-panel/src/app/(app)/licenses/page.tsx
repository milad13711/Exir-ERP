"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KeyIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchLicenses, revokeLicense, ApiError, type AdminLicense } from "@/lib/api";
import { IssueLicenseModal } from "@/components/licenses/IssueLicenseModal";

function isExpired(license: AdminLicense): boolean {
  return new Date(license.expiresAt).getTime() < Date.now();
}

// چک‌این هر ۱۵ دقیقه انجام می‌شود (LicenseRuntimeService) — تا نیم‌ساعت یعنی هنوز آنلاین است.
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function relativeTimeFa(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "چند لحظه پیش";
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return `${toPersianDigits(days)} روز پیش`;
}

function connectivity(license: AdminLicense): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (!license.lastCheckInAt) return { label: "هرگز متصل نشده", tone: "neutral" };
  const diffMs = Date.now() - new Date(license.lastCheckInAt).getTime();
  if (diffMs <= ONLINE_THRESHOLD_MS) return { label: `آنلاین · ${relativeTimeFa(license.lastCheckInAt)}`, tone: "success" };
  if (diffMs <= STALE_THRESHOLD_MS) return { label: `آخرین اتصال: ${relativeTimeFa(license.lastCheckInAt)}`, tone: "warning" };
  return { label: `قطع — آخرین اتصال: ${relativeTimeFa(license.lastCheckInAt)}`, tone: "danger" };
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<AdminLicense[] | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    fetchLicenses().then(setLicenses).catch(() => setLicenses([]));
  }
  useEffect(reload, []);

  async function handleRevoke(license: AdminLicense) {
    const reason = window.prompt(`دلیل لغو لایسنس «${license.orgName}» را وارد کنید:`);
    if (reason === null) return;
    if (!reason.trim()) return;
    setActionError(null);
    try {
      await revokeLicense(license.id, reason.trim());
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "لغو لایسنس ناموفق بود");
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">لایسنس‌های استقرار اختصاصی</h1>
          <p className="text-[13.5px] text-muted mt-1">صدور و لغو کلید لایسنس برای نسخه‌های on-premise</p>
        </div>
        <button
          onClick={() => setIssueOpen(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          صدور لایسنس جدید
        </button>
      </div>

      {actionError && (
        <div className="mt-4 text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3.5 py-2.5">{actionError}</div>
      )}

      {licenses === null ? (
        <Card className="mt-6 p-8 text-center text-muted text-sm">در حال بارگذاری...</Card>
      ) : licenses.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-muted text-sm">هنوز لایسنسی صادر نشده است</Card>
      ) : (
        <div className="flex flex-col gap-3 mt-6">
          {licenses.map((l) => {
            const conn = connectivity(l);
            return (
              <Card key={l.id} className="p-5">
                <div className="flex items-start gap-3.5 flex-wrap">
                  <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                    <KeyIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[15px] font-extrabold break-words">{l.orgName}</div>
                      {l.status === "REVOKED" ? (
                        <Badge tone="neutral">لغوشده</Badge>
                      ) : isExpired(l) ? (
                        <Badge tone="warning">منقضی‌شده</Badge>
                      ) : (
                        <Badge tone="success">فعال</Badge>
                      )}
                    </div>
                    {l.tenant && <div className="text-[12.5px] text-ink-soft mt-1 break-words">تننت: {l.tenant.name}</div>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted mt-2.5">
                      <span>{toPersianDigits(l.allowedModules.length)} ماژول</span>
                      <span>{toPersianDigits(l.seats)} کاربر</span>
                      <span>انقضا: {formatJalaliDate(l.expiresAt)}</span>
                      {l.lastCheckInIp && (
                        <span dir="ltr" className="text-left">
                          IP: {l.lastCheckInIp}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <Badge tone={conn.tone}>{conn.label}</Badge>
                    {l.status === "ACTIVE" && !isExpired(l) && (
                      <button
                        onClick={() => handleRevoke(l)}
                        className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer"
                      >
                        لغو
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {issueOpen && <IssueLicenseModal onClose={() => setIssueOpen(false)} onIssued={reload} />}
    </div>
  );
}
