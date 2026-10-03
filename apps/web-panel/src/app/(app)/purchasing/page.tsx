"use client";

import { useEffect, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { OrdersIcon, PlusIcon, ShieldIcon, BuildingIcon, WarningIcon } from "@/components/icons";
import { formatToman, formatJalaliDate } from "@/lib/persian";
import {
  fetchPurchaseOrders,
  fetchPurchaseApprovalThreshold,
  fetchPurchaseReturns,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type PurchaseReturn,
} from "@/lib/api";
import { NewPurchaseOrderModal } from "@/components/purchasing/NewPurchaseOrderModal";
import { PurchaseOrderDetailModal } from "@/components/purchasing/PurchaseOrderDetailModal";
import { ApprovalThresholdModal } from "@/components/purchasing/ApprovalThresholdModal";
import { SuppliersModal } from "@/components/purchasing/SuppliersModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  RECEIVED: "دریافت‌شده",
  PARTIALLY_PAID: "پرداخت جزئی",
  PAID: "پرداخت‌شده",
  CANCELLED: "باطل‌شده",
};

const STATUS_TONES: Record<PurchaseOrderStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  RECEIVED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

type Tab = "orders" | "returns";

export default function PurchasingPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [returns, setReturns] = useState<PurchaseReturn[] | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [thresholdModalOpen, setThresholdModalOpen] = useState(false);
  const [suppliersModalOpen, setSuppliersModalOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);
  const beginRequest = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();
  function loadList() {
    const isCurrent = beginRequest();
    const requested = debouncedSearch.trim();
    fetchPurchaseOrders(debouncedSearch.trim() || undefined)
      .then((r) => {
        if (isCurrent()) setOrders(r);
      })
      .catch(() => {
        if (isCurrent()) setOrders((prev) => prev ?? []);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(requested);
      });
  }
  const reload = loadList;
  function reloadReturns() {
    fetchPurchaseReturns().then(setReturns).catch(() => setReturns([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadList, [debouncedSearch]);
  useEffect(reloadReturns, []);
  useEffect(() => {
    fetchPurchaseApprovalThreshold()
      .then((res) => setThreshold(res.threshold))
      .catch(() => {});
  }, []);

  const filtered = orders ?? [];

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">خرید و تأمین‌کننده</h1>
            <ModuleHelp code="purchasing" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            از سفارش خرید تا رسید انبار و پرداخت — با اتصال خودکار به انبار و حسابداری
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSuppliersModalOpen(true)}
            title="مدیریت تأمین‌کنندگان"
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <BuildingIcon className="w-4 h-4" />
            تأمین‌کنندگان
          </button>
          <button
            onClick={() => setThresholdModalOpen(true)}
            title="تنظیمات تأیید سفارش خرید"
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <ShieldIcon className="w-4 h-4" />
            {threshold ? `تأیید بالای ${formatToman(threshold)}` : "تنظیمات تأیید"}
          </button>
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            سفارش خرید جدید
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-6">
        <button
          onClick={() => setTab("orders")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer ${
            tab === "orders" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <OrdersIcon className="w-4 h-4" />
          سفارش‌ها
        </button>
        <button
          onClick={() => setTab("returns")}
          className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2 rounded-xl cursor-pointer ${
            tab === "returns" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
          }`}
        >
          <WarningIcon className="w-4 h-4" />
          مرجوعی‌ها
        </button>
      </div>

      {tab === "orders" ? (
        <SearchInput className="max-w-[320px] mt-4 mb-4" value={search} onChange={setSearch} placeholder="جستجوی تأمین‌کننده یا شماره سفارش..." loading={searching} />
      ) : null}

      {tab === "returns" ? (
        <Card className="p-2 mt-4">
          {returns === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : returns.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <WarningIcon className="w-6 h-6" />
              هنوز مرجوعی‌ای ثبت نشده است
            </div>
          ) : (
            returns.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setOpenOrderId(r.order.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < returns.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">مرجوعی #{r.returnNo}</span>
                    <Badge tone="danger">سفارش #{r.order.orderNo}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {r.order.supplier.company || r.order.supplier.name} · {formatJalaliDate(r.createdAt)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0 text-danger">-{formatToman(r.total)}</div>
              </button>
            ))
          )}
        </Card>
      ) : (
        <Card className="p-2">
          {orders === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
              <OrdersIcon className="w-6 h-6" />
              سفارش خریدی ثبت نشده است
            </div>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.id}
                onClick={() => setOpenOrderId(o.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                  i < filtered.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">سفارش #{o.orderNo}</span>
                    {o.approvalStatus === "PENDING" ? <Badge tone="warning">در انتظار تأیید</Badge> : null}
                    {o.approvalStatus === "REJECTED" ? <Badge tone="danger">رد شده</Badge> : null}
                    {o.hasReturn ? (
                      <Badge tone="danger">مرجوع‌شده</Badge>
                    ) : (
                      <Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                    )}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {o.supplier.company || o.supplier.name} · {formatJalaliDate(o.issuedAt)}
                  </div>
                </div>
                <div className="text-[13px] font-extrabold shrink-0">{formatToman(o.total)}</div>
              </button>
            ))
          )}
        </Card>
      )}

      {newOpen ? (
        <NewPurchaseOrderModal
          onClose={() => setNewOpen(false)}
          onCreated={(order) => {
            reload();
            setOpenOrderId(order.id);
          }}
        />
      ) : null}

      {openOrderId ? (
        <PurchaseOrderDetailModal
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onChanged={() => {
            reload();
            reloadReturns();
          }}
        />
      ) : null}

      {thresholdModalOpen ? (
        <ApprovalThresholdModal
          currentThreshold={threshold}
          onClose={() => setThresholdModalOpen(false)}
          onSaved={setThreshold}
        />
      ) : null}

      {suppliersModalOpen ? <SuppliersModal onClose={() => setSuppliersModalOpen(false)} /> : null}
    </div>
  );
}
