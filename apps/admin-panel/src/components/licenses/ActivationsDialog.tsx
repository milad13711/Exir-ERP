import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { BTN_DANGER } from "@/components/ui/styles";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchActivations, releaseActivation, type LicenseActivationRow, type LicenseRow } from "@/lib/licenses-api";
import { errMsg } from "./shared";

export function ActivationsDialog({ license, onClose, onChanged }: { license: LicenseRow; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<LicenseActivationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { fetchActivations(license.id).then(setRows).catch((e) => { setRows([]); setError(errMsg(e, "بارگذاری ناموفق")); }); }, [license.id]);
  useEffect(load, [load]);

  async function release(a: LicenseActivationRow) {
    if (!window.confirm(`فعال‌سازی «${a.identifier}» آزاد شود؟ ظرفیت آن برمی‌گردد و آن نصب در check-in بعدی «فعال‌نشده» می‌شود.`)) return;
    try { await releaseActivation(license.id, a.id); load(); onChanged(); } catch (e) { setError(errMsg(e, "آزادسازی ناموفق")); }
  }

  return (
    <Modal title={`فعال‌سازی‌ها — ${license.orgName}`} onClose={onClose} width="max-w-[760px]">
      <div className="text-[12px] text-muted mb-3">ظرفیت: {toPersianDigits(rows?.length ?? 0)} / {license.maxActivations === 0 ? "∞" : toPersianDigits(license.maxActivations)}</div>
      {error ? <div className="text-[12px] text-danger mb-2">{error}</div> : null}
      {rows === null ? <div className="h-20 rounded-xl bg-slate-200/60 animate-pulse" /> : rows.length === 0 ? <div className="text-center text-muted text-[13px] py-6">فعال‌سازی ثبت نشده است</div> : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => (
            <div key={a.id} className="border border-border rounded-xl p-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0 basis-[200px]">
                <div dir="ltr" className="font-mono text-[12.5px] font-bold text-left break-all">{a.identifier}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted mt-1.5">
                  <span>فعال‌سازی: {formatJalaliDateTime(a.activatedAt)}</span>
                  <span>آخرین اتصال: {formatJalaliDateTime(a.lastCheckAt)}</span>
                  {a.ip ? <span dir="ltr">IP {a.ip}</span> : null}
                  {a.appVersion ? <span dir="ltr">v{a.appVersion}</span> : null}
                  {a.lastTelemetry?.users !== undefined ? <span>{toPersianDigits(a.lastTelemetry.users)} کاربر</span> : null}
                </div>
              </div>
              {a.tamperStatus && a.tamperStatus !== "ok" && a.tamperStatus !== "disabled" ? <Badge tone="danger">دستکاری: {a.tamperStatus}</Badge> : a.tamperStatus === "ok" ? <Badge tone="success">یکپارچه</Badge> : null}
              {a.lastTelemetry?.clockRollback ? <Badge tone="warning">برگشت ساعت</Badge> : null}
              <button className={BTN_DANGER} onClick={() => release(a)}>آزادسازی</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
