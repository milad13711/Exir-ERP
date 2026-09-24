"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchAuditLogs, fetchErrorLogs, fetchSmsLogs, type AuditLogEntry, type ErrorLogEntry, type SmsLogEntry } from "@/lib/api";

type Tab = "errors" | "audit" | "sms";

const SMS_SOURCE_LABELS: Record<SmsLogEntry["source"], string> = {
  PLATFORM: "سیستمی",
  TENANT_OWN: "پنل خود تننت",
  TENANT_SYSTEM: "بسته‌ی پیامکی",
  TENANT_LEGACY: "پنل اصلی",
};

const LEVEL_TONES: Record<ErrorLogEntry["level"], "neutral" | "warning" | "danger"> = {
  INFO: "neutral",
  WARNING: "warning",
  ERROR: "danger",
  FATAL: "danger",
};
const LEVEL_LABELS: Record<ErrorLogEntry["level"], string> = {
  INFO: "اطلاع",
  WARNING: "هشدار",
  ERROR: "خطا",
  FATAL: "بحرانی",
};

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("errors");
  const [tenantId, setTenantId] = useState("");
  const [errors, setErrors] = useState<ErrorLogEntry[] | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsLogEntry[] | null>(null);
  const [smsStatus, setSmsStatus] = useState<"" | "success" | "failed">("");

  function reload() {
    if (tab === "errors") fetchErrorLogs(tenantId || undefined).then(setErrors).catch(() => setErrors([]));
    else if (tab === "sms") fetchSmsLogs(tenantId || undefined, smsStatus || undefined).then(setSmsLogs).catch(() => setSmsLogs([]));
    else fetchAuditLogs(tenantId || undefined).then(setAudit).catch(() => setAudit([]));
  }
  useEffect(reload, [tab, tenantId, smsStatus]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <h1 className="text-xl font-extrabold">لاگ فعالیت‌ها و خطاها</h1>
      <p className="text-[13.5px] text-muted mt-1">آخرین ۲۰۰ رکورد — برای فیلتر روی یک تننت خاص، شناسه‌ی آن را وارد کنید</p>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          {(["errors", "audit", "sms"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[12.5px] font-semibold px-3.5 py-2 rounded-[10px] cursor-pointer ${
                tab === t ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
              }`}
            >
              {t === "errors" ? "خطاها" : t === "audit" ? "رویدادها (audit)" : "پیامک‌ها"}
            </button>
          ))}
        </div>
        <input
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="شناسه‌ی تننت (اختیاری)"
          dir="ltr"
          className="text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2 outline-none focus:border-primary flex-1 min-w-[200px]"
        />
        {tab === "sms" ? (
          <select
            value={smsStatus}
            onChange={(e) => setSmsStatus(e.target.value as "" | "success" | "failed")}
            className="text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2 outline-none"
          >
            <option value="">همه‌ی وضعیت‌ها</option>
            <option value="success">فقط موفق</option>
            <option value="failed">فقط ناموفق</option>
          </select>
        ) : null}
      </div>

      <Card className="p-2">
        {tab === "sms" ? (
          smsLogs === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : smsLogs.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">پیامکی ثبت نشده است</div>
          ) : (
            smsLogs.map((l, i) => (
              <div key={l.id} className={`flex flex-wrap items-start gap-2 px-4 py-3.5 ${i < smsLogs.length - 1 ? "border-b border-border" : ""}`}>
                <Badge tone={l.success ? "success" : "danger"}>{l.success ? "موفق" : "ناموفق"}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold break-words">{l.message}</div>
                  {l.error ? <div className="text-[11.5px] text-danger mt-0.5 break-words">{l.error}</div> : null}
                  <div className="text-[11px] text-muted mt-0.5">
                    <span dir="ltr">{l.phone}</span> · {SMS_SOURCE_LABELS[l.source]}
                    {l.tenant ? ` · ${l.tenant.name}` : ""} · {formatJalaliDateTime(l.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )
        ) : tab === "errors" ? (
          errors === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : errors.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">خطایی ثبت نشده است</div>
          ) : (
            errors.map((e, i) => (
              <div key={e.id} className={`flex flex-wrap items-start gap-2 px-4 py-3.5 ${i < errors.length - 1 ? "border-b border-border" : ""}`}>
                <Badge tone={LEVEL_TONES[e.level]}>{LEVEL_LABELS[e.level]}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold break-words">{e.message}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {e.service}
                    {e.tenant ? ` · ${e.tenant.name}` : ""} · {formatJalaliDateTime(e.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )
        ) : audit === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : audit.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">رویدادی ثبت نشده است</div>
        ) : (
          audit.map((a, i) => (
            <div key={a.id} className={`flex flex-wrap items-start gap-2 px-4 py-3.5 ${i < audit.length - 1 ? "border-b border-border" : ""}`}>
              <Badge tone="neutral">{a.entityType}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold break-words">{a.action}</div>
                <div className="text-[11px] text-muted mt-0.5">
                  {a.actorType}
                  {a.tenant ? ` · ${a.tenant.name}` : ""} · {formatJalaliDateTime(a.createdAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
