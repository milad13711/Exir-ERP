"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { SearchInput } from "@/components/ui/SearchInput";
import { PlusIcon, SettingsIcon, TruckIcon } from "@/components/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  DISPATCH_STATUS_LABELS,
  downloadDispatchCsv,
  fetchDispatchDrivers,
  fetchDispatchReport,
  type DispatchDriver,
  type DispatchFilters,
  type DispatchReport,
} from "@/lib/dispatch-api";
import { DeclareShipmentModal } from "./DeclareShipmentModal";
import { BTN_PRIMARY, BTN_SOFT, INPUT, LABEL, StatusBadge, errText, kgText } from "./dispatch-ui";

const QUICK = ["", "AWAITING_DRIVER", "ACCEPTED", "LOADED", "AWAITING_DOCS", "FINAL_CHECK", "READY_TO_DEPART", "IN_TRANSIT", "DELIVERED", "SUSPENDED"] as const;

/** variant="board": نمای عملیاتی (گیت/باسکول)؛ variant="report": گزارش کامل با فیلتر، جمع و CSV. */
export function DispatchListView({ variant }: { variant: "board" | "report" }) {
  const { me } = useWorkspace();
  const manager = me?.permissions?.manager ?? false;
  const [data, setData] = useState<DispatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [f, setF] = useState<DispatchFilters>({});
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const begin = useRequestGuard();

  useEffect(() => {
    fetchDispatchDrivers().then(setDrivers).catch(() => {});
  }, []);

  useEffect(() => {
    const ok = begin();
    fetchDispatchReport({ ...f, q: dq.trim() || undefined })
      .then((r) => {
        if (ok()) {
          setData(r);
          setError(null);
        }
      })
      .catch((e) => ok() && setError(errText(e, "بارگذاری ناموفق بود")));
  }, [f, dq, begin]);

  const set = (patch: Partial<DispatchFilters>) => setF((p) => ({ ...p, ...patch }));

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">{variant === "report" ? "گزارش اعلام بار و حمل" : "اعلام بار و اسناد حمل"}</h1>
            <ModuleHelp code="dispatch" />
          </div>
          <p className="text-[13px] text-muted mt-1">چک‌لیست بارگیری، وزن‌کشی، اسناد و رسید راننده</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {variant === "board" ? (
            <Link href="/dispatch/report" className={BTN_SOFT}>گزارش‌ها</Link>
          ) : (
            <Link href="/dispatch" className={BTN_SOFT}>نمای عملیاتی</Link>
          )}
          {manager ? (
            <Link href="/dispatch/settings" className={`${BTN_SOFT} flex items-center gap-1.5`}>
              <SettingsIcon className="w-4 h-4" />
              تنظیمات
            </Link>
          ) : null}
          <button onClick={() => setDeclareOpen(true)} className={`${BTN_PRIMARY} flex items-center gap-1.5`}>
            <PlusIcon className="w-4 h-4" />
            اعلام بار جدید
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <SearchInput className="max-w-[360px]" value={q} onChange={setQ} placeholder="جستجوی شماره، مشتری، راننده، پلاک..." />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {QUICK.map((s) => (
            <button
              key={s || "all"}
              onClick={() => set({ status: s || undefined })}
              className={clsx("shrink-0 text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border", (f.status ?? "") === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}
            >
              {s ? DISPATCH_STATUS_LABELS[s] : "همه"}
              {s && data?.summary.byStatus[s] ? ` (${toPersianDigits(data.summary.byStatus[s])})` : ""}
            </button>
          ))}
        </div>

        {variant === "report" ? (
          <Card className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className={LABEL}>راننده</label>
              <select value={f.driverId ?? ""} onChange={(e) => set({ driverId: e.target.value || undefined })} className={INPUT}>
                <option value="">همه</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>منطقه</label>
              <input value={f.region ?? ""} onChange={(e) => set({ region: e.target.value || undefined })} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>نوع بار</label>
              <input value={f.cargoType ?? ""} onChange={(e) => set({ cargoType: e.target.value || undefined })} className={INPUT} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>وزن خالص از (kg)</label>
                <input value={f.minNetKg ?? ""} onChange={(e) => set({ minNetKg: e.target.value.replace(/[^\d.]/g, "") || undefined })} dir="ltr" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>تا (kg)</label>
                <input value={f.maxNetKg ?? ""} onChange={(e) => set({ maxNetKg: e.target.value.replace(/[^\d.]/g, "") || undefined })} dir="ltr" className={INPUT} />
              </div>
            </div>
            <div>
              <label className={LABEL}>از تاریخ ثبت</label>
              <JalaliDateInput value={f.from ?? ""} onChange={(v) => set({ from: v || undefined })} />
            </div>
            <div>
              <label className={LABEL}>تا تاریخ</label>
              <JalaliDateInput value={f.to ?? ""} onChange={(v) => set({ to: v || undefined })} />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <button onClick={() => { setF({}); setQ(""); }} className={BTN_SOFT}>پاک کردن فیلترها</button>
              <button
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await downloadDispatchCsv({ ...f, q: dq.trim() || undefined });
                  } catch (e) {
                    setError(errText(e));
                  } finally {
                    setExporting(false);
                  }
                }}
                className={BTN_PRIMARY}
              >
                {exporting ? "در حال آماده‌سازی..." : "خروجی CSV"}
              </button>
            </div>
          </Card>
        ) : null}

        {data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="bg-surface border border-border rounded-2xl p-3.5">
              <div className="text-[11px] text-muted">تعداد بار</div>
              <div className="text-[18px] font-extrabold mt-0.5">{toPersianDigits(data.summary.count)}</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-3.5">
              <div className="text-[11px] text-muted">جمع وزن خالص</div>
              <div className="text-[18px] font-extrabold mt-0.5">{kgText(data.summary.totalNetKg)}</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-3.5 col-span-2 sm:col-span-1">
              <div className="text-[11px] text-muted">دارای وزن ثبت‌شده</div>
              <div className="text-[18px] font-extrabold mt-0.5">{toPersianDigits(data.summary.withWeight)}</div>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className="mt-3 text-[12.5px] text-danger font-semibold">{error}</div> : null}

      <Card className="p-2 mt-4">
        {!data ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : data.rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">باری یافت نشد</div>
        ) : (
          data.rows.map((r, i) => (
            <Link
              key={r.id}
              href={`/dispatch/${r.id}`}
              className={clsx("flex items-center gap-3 px-3 sm:px-4 py-3.5 hover:bg-slate-50 transition-colors", i < data.rows.length - 1 && "border-b border-border")}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <TruckIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">
                  #{toPersianDigits(r.shipmentNo)} · {r.cargoType}
                </div>
                <div className="text-[11.5px] text-muted mt-0.5 truncate">
                  {r.customerName ?? "—"}
                  {r.driverName ? ` · ${r.driverName}${r.plateNumber ? ` (${r.plateNumber})` : ""}` : ""}
                  {r.region ? ` · ${r.region}` : ""}
                </div>
              </div>
              <div className="hidden sm:block text-left shrink-0 w-[130px]">
                <div className="text-[12px] font-bold">{kgText(r.netKg)}</div>
                <div className="text-[10.5px] text-muted">{formatJalaliDate(r.createdAt)}</div>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))
        )}
      </Card>

      {declareOpen ? <DeclareShipmentModal onClose={() => setDeclareOpen(false)} /> : null}
    </div>
  );
}
