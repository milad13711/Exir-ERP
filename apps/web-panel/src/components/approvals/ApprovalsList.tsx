"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { decideApproval, fetchApprovals, fetchApprovalDetail, ApiError, type ApprovalDetail, type ApprovalRequest } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";

const MODULE_LABELS: Record<string, string> = { recruitment: "جذب و استخدام", purchasing: "خرید", hr: "منابع انسانی", sales: "فروش", contracts: "قراردادها", projects: "پروژه‌ها" };

/**
 * لیست اسناد در انتظار تأیید کاربر — هم در صفحه‌ی کارتابل و هم در داشبورد استفاده می‌شود.
 * `autoOpenId`: وقتی از روی اعلان با `?open=<id>` وارد صفحه شده باشیم، جزئیات همان سند
 * را مستقل از تب/وضعیت فعلی باز می‌کند.
 */
export function ApprovalsList({
  limit,
  status = "PENDING",
  autoOpenId,
  onAutoOpened,
}: {
  limit?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  autoOpenId?: string | null;
  onAutoOpened?: () => void;
}) {
  const [items, setItems] = useState<ApprovalRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchApprovals(status)
      .then(setItems)
      .catch(() => setItems([]));
  }, [status]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!autoOpenId) return;
    fetchApprovalDetail(autoOpenId)
      .then(setDetail)
      .catch(() => {})
      .finally(() => onAutoOpened?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenId]);

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

  async function openDetail(item: ApprovalRequest) {
    setError(null);
    try {
      setDetail(await fetchApprovalDetail(item.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "بارگذاری جزئیات ناموفق بود");
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
        <div key={item.id} onClick={() => openDetail(item)} className="border border-border rounded-xl p-3.5 bg-surface cursor-pointer hover:border-primary transition-colors">
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
            <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
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
      {detail && (
        <Modal title={detail.request.title} onClose={() => setDetail(null)} width="max-w-[560px]">
          <div className="flex flex-col gap-3.5">
            {detail.request.summary && <div className="text-[12.5px] text-ink-soft">{detail.request.summary}</div>}
            <div className="border border-border rounded-xl overflow-hidden text-[12.5px]">
              {detail.detail.fields.map((f) => (
                <div key={f.label} className="flex border-b border-border last:border-b-0">
                  <div className="w-[120px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{f.label}</div>
                  <div className="flex-1 px-3 py-2.5 whitespace-pre-wrap">{f.value}</div>
                </div>
              ))}
              {detail.detail.fields.length === 0 && <div className="px-3 py-3 text-muted">جزئیات بیشتری برای این سند ثبت نشده است.</div>}
            </div>
            {detail.request.status === "PENDING" ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => { decide(detail.request, true).then(() => setDetail(null)); }} className="text-[12px] font-bold px-3 py-2 rounded-lg bg-success text-white cursor-pointer">تأیید</button>
                {detail.request.isOfficial && (
                  <button onClick={() => { decide(detail.request, true, true).then(() => setDetail(null)); }} className="text-[12px] font-bold px-3 py-2 rounded-lg bg-primary text-white cursor-pointer">تأیید و اجازه‌ی درج مهر و امضا</button>
                )}
                <button onClick={() => { decide(detail.request, false).then(() => setDetail(null)); }} className="text-[12px] font-bold px-3 py-2 rounded-lg bg-danger-soft text-danger cursor-pointer">رد</button>
                {detail.request.link && (
                  <Link href={detail.request.link} className="text-[12px] font-bold text-ink-soft mr-auto">
                    باز کردن در ماژول ←
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-muted">
                {detail.request.status === "APPROVED" ? "تأیید شد" : "رد شد"}
                {detail.request.decisionNote ? ` — ${detail.request.decisionNote}` : ""}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
