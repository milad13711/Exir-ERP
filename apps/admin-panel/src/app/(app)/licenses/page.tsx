"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState, ListSkeleton } from "@/components/ui/EmptyState";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, BTN_SOFT, BTN_SUCCESS, INPUT } from "@/components/ui/styles";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { KeyIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { formatJalaliDate, formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  deleteLicense, downloadLicensesCsv, fetchLicenseList, resumeLicense, revokeLicense, suspendLicense,
  type EffectiveStatus, type LicenseList, type LicenseRow,
} from "@/lib/licenses-api";
import { LicenseFormModal } from "@/components/licenses/LicenseFormModal";
import { ActivationsDialog } from "@/components/licenses/ActivationsDialog";
import { InstallGuideDialog, OfflineTokenDialog, ReasonDialog, RenewDialog } from "@/components/licenses/LicenseDialogs";
import { LicenseEventsPanel } from "@/components/licenses/LicenseEventsPanel";
import { LicenseSettingsPanel } from "@/components/licenses/LicenseSettingsPanel";
import { STATUS_LABEL, StatusChip, copyText, errMsg } from "@/components/licenses/shared";

type Tab = "licenses" | "events" | "settings";
type Dialog =
  | { kind: "form"; license?: LicenseRow }
  | { kind: "renew" | "activations" | "offline" | "guide"; license: LicenseRow }
  | { kind: "suspend" | "revoke" | "delete"; license: LicenseRow }
  | null;

const ALL_STATUSES: EffectiveStatus[] = ["active", "expired", "suspended", "revoked"];

export default function LicensesPage() {
  const [tab, setTab] = useState<Tab>("licenses");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statuses, setStatuses] = useState<EffectiveStatus[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LicenseList | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const reload = useCallback(() => {
    fetchLicenseList({ q: debouncedQ || undefined, status: statuses.join(",") || undefined, page, pageSize: 25 })
      .then(setData)
      .catch((e) => { setData({ total: 0, page: 1, pageSize: 25, items: [] }); setError(errMsg(e, "بارگذاری لایسنس‌ها ناموفق بود")); });
  }, [debouncedQ, statuses, page]);
  useEffect(reload, [reload]);

  const toggleStatus = (s: EffectiveStatus) => { setStatuses((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s])); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try { await fn(); setNotice(ok); reload(); } catch (e) { setError(errMsg(e, "عملیات ناموفق بود")); }
  }
  async function copyKey(l: LicenseRow) {
    if (l.licenseKey && (await copyText(l.licenseKey))) setNotice("کلید کپی شد");
  }

  const TABS: [Tab, string][] = [["licenses", "لایسنس‌ها"], ["events", "ردپای عملیات"], ["settings", "تنظیمات و کلید"]];

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1100px] mx-auto">
      <PageHeader
        title="مدیریت لایسنس"
        subtitle="صدور، تمدید، تعلیق و ابطال لایسنس نرم‌افزار و ماژول‌ها (ابری و سرور اختصاصی)"
        action={tab === "licenses" ? (
          <button onClick={() => setDialog({ kind: "form" })} className={BTN_PRIMARY}><PlusIcon className="w-4 h-4" />صدور لایسنس جدید</button>
        ) : undefined}
      />

      <div className="flex gap-1.5 mt-5 border-b border-border overflow-x-auto" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-[13px] font-bold whitespace-nowrap cursor-pointer border-b-2 -mb-px ${tab === id ? "border-primary text-primary" : "border-transparent text-muted"}`}>{label}</button>
        ))}
      </div>

      {notice ? <div className="mt-4 text-[12.5px] text-success font-semibold bg-success-soft rounded-xl px-3.5 py-2.5" role="status">{notice}</div> : null}
      {error ? <div className="mt-4 text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3.5 py-2.5" role="alert">{error}</div> : null}

      {tab === "events" ? <LicenseEventsPanel /> : tab === "settings" ? <LicenseSettingsPanel /> : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو: کلید، سازمان، مشتری، ایمیل" className={`${INPUT} !ps-9`} aria-label="جستجو" />
            </div>
            {ALL_STATUSES.map((s) => (
              <button key={s} onClick={() => toggleStatus(s)} aria-pressed={statuses.includes(s)}
                className={`text-[12px] font-bold px-3 py-2 rounded-xl cursor-pointer border ${statuses.includes(s) ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"}`}>{STATUS_LABEL[s]}</button>
            ))}
            <button className={BTN_GHOST} onClick={() => downloadLicensesCsv({ q: debouncedQ, status: statuses.join(",") }).catch((e) => setError(errMsg(e, "خروجی ناموفق بود")))}>خروجی CSV</button>
          </div>

          {data === null ? (
            <div className="mt-5 flex flex-col gap-3"><ListSkeleton /></div>
          ) : data.items.length === 0 ? (
            <div className="mt-5"><EmptyState icon={<KeyIcon className="w-6 h-6" />}>لایسنسی یافت نشد</EmptyState></div>
          ) : (
            <div className="flex flex-col gap-3 mt-5">
              {data.items.map((l) => (
                <Card key={l.id} className="p-4 sm:p-5">
                  <div className="flex items-start gap-3.5 flex-wrap">
                    <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0"><KeyIcon className="w-5 h-5" /></div>
                    <div className="flex-1 min-w-0 basis-[240px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[15px] font-extrabold break-words">{l.orgName}</div>
                        <StatusChip status={l.effectiveStatus} />
                        {!l.expiresAt ? <Badge tone="primary">دائمی</Badge> : null}
                        {l.edition ? <Badge tone="neutral">{l.edition}</Badge> : null}
                        {l.lastTamperStatus && !["ok", "disabled"].includes(l.lastTamperStatus) ? <Badge tone="danger">دستکاری کد: {l.lastTamperStatus}</Badge> : null}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span dir="ltr" className="font-mono text-[12.5px] text-ink-soft select-all">{l.licenseKey ?? "—"}</span>
                        <button className={BTN_SOFT} onClick={() => copyKey(l)} disabled={!l.licenseKey}>کپی</button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted mt-2.5">
                        {l.customerName ? <span>{l.customerName}</span> : null}
                        <span dir="ltr">{l.productName}</span>
                        <span>{toPersianDigits(l.allowedModules.length)} ماژول</span>
                        <span>{toPersianDigits(l.seats)} کاربر</span>
                        <span>فعال‌سازی: {toPersianDigits(l.activationCount)} / {l.maxActivations === 0 ? "∞" : toPersianDigits(l.maxActivations)}</span>
                        <span>انقضا: {l.expiresAt ? formatJalaliDate(l.expiresAt) : "بدون انقضا"}</span>
                        {l.updatesUntil ? <span>به‌روزرسانی تا: {formatJalaliDate(l.updatesUntil)}</span> : null}
                        {l.lastCheckInAt ? <span>آخرین اتصال: {formatJalaliDateTime(l.lastCheckInAt)}</span> : <span>هرگز متصل نشده</span>}
                        {l.lastAppVersion ? <span dir="ltr">v{l.lastAppVersion}</span> : null}
                      </div>
                      {l.status === "SUSPENDED" && l.suspendedReason ? <div className="text-[12px] text-ink-soft mt-2">دلیل تعلیق: {l.suspendedReason}</div> : null}
                      {l.status === "REVOKED" && l.revokedReason ? <div className="text-[12px] text-ink-soft mt-2">دلیل لغو: {l.revokedReason}</div> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 pt-3.5 border-t border-border">
                    <button className={BTN_GHOST} onClick={() => setDialog({ kind: "activations", license: l })}>فعال‌سازی‌ها</button>
                    <button className={BTN_GHOST} onClick={() => setDialog({ kind: "form", license: l })}>ویرایش</button>
                    {l.status !== "REVOKED" ? <button className={BTN_SOFT} onClick={() => setDialog({ kind: "renew", license: l })}>تمدید</button> : null}
                    <button className={BTN_GHOST} onClick={() => setDialog({ kind: "guide", license: l })}>راهنمای نصب</button>
                    {l.status === "ACTIVE" ? <button className={BTN_GHOST} onClick={() => setDialog({ kind: "offline", license: l })}>توکن آفلاین</button> : null}
                    {l.status === "ACTIVE" ? <button className={BTN_DANGER} onClick={() => setDialog({ kind: "suspend", license: l })}>تعلیق</button> : null}
                    {l.status === "SUSPENDED" ? <button className={BTN_SUCCESS} onClick={() => act(() => resumeLicense(l.id), "لایسنس ازسرگرفته شد")}>ازسرگیری</button> : null}
                    {l.status !== "REVOKED" ? <button className={BTN_DANGER} onClick={() => setDialog({ kind: "revoke", license: l })}>لغو</button> : null}
                    <button className={BTN_DANGER} onClick={() => setDialog({ kind: "delete", license: l })}>حذف</button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 justify-center mt-5">
            <button className={BTN_GHOST} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span className="text-[12px] text-muted">{toPersianDigits(page)} / {toPersianDigits(pages)} · {toPersianDigits(data?.total ?? 0)} لایسنس</span>
            <button className={BTN_GHOST} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        </>
      )}

      {dialog?.kind === "form" ? (
        <LicenseFormModal license={dialog.license} onClose={() => setDialog(null)} onSaved={(created) => { setNotice(created ? `لایسنس ساخته شد: ${created.licenseKey}` : "ذخیره شد"); reload(); }} />
      ) : null}
      {dialog?.kind === "renew" ? <RenewDialog license={dialog.license} onClose={() => setDialog(null)} onDone={() => { setNotice("تمدید انجام شد"); reload(); }} /> : null}
      {dialog?.kind === "activations" ? <ActivationsDialog license={dialog.license} onClose={() => setDialog(null)} onChanged={reload} /> : null}
      {dialog?.kind === "offline" ? <OfflineTokenDialog license={dialog.license} onClose={() => setDialog(null)} onDone={reload} /> : null}
      {dialog?.kind === "guide" ? <InstallGuideDialog license={dialog.license} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "suspend" ? (
        <ReasonDialog title="تعلیق لایسنس" confirmLabel="تعلیق" description={`«${dialog.license.orgName}» در check-in بعدی (تا چند دقیقه) قفل می‌شود. با «ازسرگیری» برمی‌گردد.`}
          onClose={() => setDialog(null)} onConfirm={async (r) => { await suspendLicense(dialog.license.id, r); setNotice("لایسنس معلق شد"); reload(); }} />
      ) : null}
      {dialog?.kind === "revoke" ? (
        <ReasonDialog title="لغو دائمی لایسنس" confirmLabel="لغو لایسنس" description={`لغو «${dialog.license.orgName}» برگشت‌ناپذیر است و در فهرست ابطال (CRL) منتشر می‌شود.`}
          onClose={() => setDialog(null)} onConfirm={async (r) => { await revokeLicense(dialog.license.id, r); setNotice("لایسنس لغو شد"); reload(); }} />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ReasonDialog title="حذف لایسنس" confirmLabel="حذف" description={`«${dialog.license.orgName}» حذف نرم می‌شود: API آن را «یافت نشد» اعلام می‌کند و ردپا حفظ می‌شود.`}
          onClose={() => setDialog(null)} onConfirm={async (r) => { await deleteLicense(dialog.license.id, r); setNotice("لایسنس حذف شد"); reload(); }} />
      ) : null}
    </div>
  );
}
