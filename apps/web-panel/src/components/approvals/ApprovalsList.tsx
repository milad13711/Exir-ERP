"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { decideApproval, fetchApprovals, ApiError, type ApprovalRequest } from "@/lib/api";

const MODULE_LABELS: Record<string, string> = { recruitment: "جذب و استخدام", purchasing: "خرید", hr: "منابع انسانی", sales: "فروش", contracts: "قراردادها", projects: "پروژه‌ها" };

/** لیست اسناد در انتظار تأیید کاربر — هم در صفحه‌ی کارتابل و هم در داشبورد استفاده می‌شود. */
export function ApprovalsList({ limit, status = "PENDING" }: { limit?: number; status?: "PENDING" | "APPROVED" | "REJECTED" }) {
  const [items, setItems] = useState<ApprovalRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchApprovals(status)
      .then(setItems)
      .catch(() => setItems([]));
  }, [status]);
  useEffect(load, [load]);

  async function decide(item: ApprovalRequest, approved: boolean, withStamp = false) {
    let note: string | undefined;
    if (!approved) {
      const reason = window.prompt("دلیل رد (اختیاری):");
      if (reason === null) return;
      note = reason || undefined;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await decideApproval(item.id, { approved, withStamp, note });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت تصمیم ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  if (!items) return <div className="text-[13px] text-muted py-6 text-center">در حال بارگذاری...</div>;
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) {
    return <div className="text-[13px] text-muted py-6 text-center">{status === "PENDING" ? "سندی در انتظار تأیید شما نیست ✓" : "موردی یافت نشد"}</div>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error && <div className="text-[12.5px] text-danger">{error}</div>}
      {shown.map((item) => (
        <div key={item.id} className="border border-border rounded-xl p-3.5 bg-surface">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="text-[13.5px] font-bold">{item.title}</div>
            <Badge tone={item.status === "PENDING" ? "warning" : item.status === "APPROVED" ? "success" : "danger"}>
              {item.status === "PENDING" ? "در انتظار" : item.status === "APPROVED" ? "تأیید شد" : "رد شد"}
            </Badge>
          </div>
          {item.summary && <div className="text-[12.5px] text-ink-soft mb-1.5">{item.summary}</div>}
          <div className="text-[11.5px] text-muted mb-2.5">
            {MODULE_LABELS[item.moduleCode] ?? item.moduleCode} · {formatJalaliDateTime(item.createdAt)}
            {item.status === "APPROVED" && item.stampApplied ? " · با مهر و امضای شرکت" : ""}
          </div>
          {item.status === "PENDING" && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => decide(item, true)}
                disabled={busyId === item.id}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-success text-white disabled:opacity-50 cursor-pointer"
              >
                تأیید
              </button>
              {item.isOfficial && (
                <button
                  onClick={() => decide(item, true, true)}
                  disabled={busyId === item.id}
                  className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50 cursor-pointer"
                >
                  تأیید و اجازه‌ی درج مهر و امضا
                </button>
              )}
              <button
                onClick={() => decide(item, false)}
                disabled={busyId === item.id}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-danger-soft text-danger disabled:opacity-50 cursor-pointer"
              >
                رد
              </button>
              {item.link && (
                <Link href={item.link} className="text-[12px] font-bold text-ink-soft mr-auto">
                  مشاهده‌ی سند ←
                </Link>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
