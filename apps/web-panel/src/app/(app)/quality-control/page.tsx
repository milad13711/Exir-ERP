"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FlaskIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { fetchSamples, type QualitySample, type QualityVerdict } from "@/lib/api";
import { ProductionOrderDetailModal } from "@/components/production/ProductionOrderDetailModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const VERDICT_LABELS: Record<QualityVerdict, string> = { PENDING: "در انتظار نتیجه", PASS: "قبول", FAIL: "رد" };
const VERDICT_TONES: Record<QualityVerdict, "success" | "danger" | "neutral" | "warning"> = {
  PENDING: "warning",
  PASS: "success",
  FAIL: "danger",
};

type Filter = "ALL" | QualityVerdict;

export default function QualityControlPage() {
  const [samples, setSamples] = useState<QualitySample[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  function reload() {
    fetchSamples().then(setSamples).catch(() => setSamples([]));
  }
  useEffect(reload, []);

  const filtered = samples?.filter((s) => filter === "ALL" || s.verdict === filter) ?? null;
  const counts = {
    ALL: samples?.length ?? 0,
    PENDING: samples?.filter((s) => s.verdict === "PENDING").length ?? 0,
    PASS: samples?.filter((s) => s.verdict === "PASS").length ?? 0,
    FAIL: samples?.filter((s) => s.verdict === "FAIL").length ?? 0,
  };

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-extrabold">کنترل کیفیت</h1>
          <ModuleHelp code="quality-control" />
        </div>
        <p className="text-[13.5px] text-muted mt-1">صف کار نمونه‌های آزمایشگاهی از همه‌ی دستورهای تولید</p>
      </div>

      <div className="flex items-center gap-2 mt-6 border-b border-border overflow-x-auto">
        {(
          [
            ["ALL", "همه"],
            ["PENDING", "در انتظار نتیجه"],
            ["FAIL", "ردشده"],
            ["PASS", "قبول‌شده"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors whitespace-nowrap ${
              filter === key ? "border-primary text-primary" : "border-transparent text-muted"
            }`}
          >
            {label} <span className="text-[11px] font-normal text-muted">({counts[key]})</span>
          </button>
        ))}
      </div>

      <Card className="mt-5 p-2">
        {filtered === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <FlaskIcon className="w-6 h-6" />
            نمونه‌ای در این وضعیت یافت نشد
          </div>
        ) : (
          filtered.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setOpenOrderId(s.productionOrderId)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors ${
                i < filtered.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold">
                  #{s.productionOrder.orderNo} — {s.productionOrder.bom.outputProduct.name}
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {s.source === "FINAL_PRODUCT" ? "محصول نهایی" : `میانه‌ی تولید${s.productionOrderStage ? ` — ${s.productionOrderStage.workCenter.name}` : ""}`}
                  {" · "}
                  {formatJalaliDateTime(s.sampledAt)}
                  {s.sampledBy ? ` · ${s.sampledBy.name}` : ""}
                </div>
              </div>
              <Badge tone={VERDICT_TONES[s.verdict]}>{VERDICT_LABELS[s.verdict]}</Badge>
            </button>
          ))
        )}
      </Card>

      {openOrderId ? (
        <ProductionOrderDetailModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} onChanged={reload} />
      ) : null}
    </div>
  );
}
