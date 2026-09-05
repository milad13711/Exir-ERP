"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TruckIcon, PlusIcon, SearchIcon, SettingsIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchShipments, type Shipment, type ShipmentStatus } from "@/lib/api";
import { NewShipmentModal } from "@/components/fleet/NewShipmentModal";
import { ShipmentDetailModal } from "@/components/fleet/ShipmentDetailModal";
import { DriversModal } from "@/components/fleet/DriversModal";

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "ثبت‌شده",
  OFFERED: "در حال پیشنهاد",
  ACCEPTED: "پذیرفته‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغوشده",
};
const STATUS_TONES: Record<ShipmentStatus, "primary" | "success" | "warning" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  OFFERED: "warning",
  ACCEPTED: "primary",
  DELIVERED: "success",
  CANCELLED: "danger",
};

type StatusFilter = "همه" | ShipmentStatus;

export default function FleetPage() {
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [driversOpen, setDriversOpen] = useState(false);
  const [openShipment, setOpenShipment] = useState<Shipment | null>(null);

  function reload() {
    fetchShipments().then(setShipments).catch(() => setShipments([]));
  }
  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!shipments) return [];
    return shipments.filter((s) => {
      const matchesStatus = statusFilter === "همه" || s.status === statusFilter;
      const matchesSearch =
        !search.trim() ||
        s.cargoType.includes(search) ||
        (s.contact?.name.includes(search) ?? false) ||
        (s.driver?.name.includes(search) ?? false) ||
        String(s.shipmentNo).includes(search);
      return matchesStatus && matchesSearch;
    });
  }, [shipments, search, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">ناوگان حمل و نقل</h1>
          <p className="text-[13.5px] text-muted mt-1">ثبت بار، تطبیق و پیشنهاد راننده، پیگیری تا تحویل</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setDriversOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            راننده‌ها
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            ثبت بار جدید
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <div className="relative max-w-[300px] flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نوع بار، مشتری، راننده یا شماره..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "DRAFT", "OFFERED", "ACCEPTED", "DELIVERED", "CANCELLED"] as StatusFilter[]).map((s) => (
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
        {shipments === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">باری یافت نشد</div>
        ) : (
          filtered.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setOpenShipment(s)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < filtered.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <TruckIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">{s.cargoType}</div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  #{toPersianDigits(s.shipmentNo)}
                  {s.contact ? ` · ${s.contact.name}` : ""}
                  {s.driver ? ` · ${s.driver.name}` : ""}
                </div>
              </div>
              <div className="text-[12px] text-muted w-[150px] text-left shrink-0 hidden sm:block">
                {formatJalaliDateTime(s.pickupAt)}
              </div>
              <Badge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</Badge>
            </button>
          ))
        )}
      </Card>

      {newOpen ? <NewShipmentModal onClose={() => setNewOpen(false)} onCreated={reload} /> : null}
      {driversOpen ? <DriversModal onClose={() => setDriversOpen(false)} onChanged={() => {}} /> : null}
      {openShipment ? (
        <ShipmentDetailModal shipment={openShipment} onClose={() => setOpenShipment(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
