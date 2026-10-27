"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { AiActionDetails } from "@/components/api/AiActionDetails";
import { fetchAiActions, approveAiAction, rejectAiAction, ApiError, type AiActionRequest, type AiActionStatus } from "@/lib/api";

const STATUS_LABELS: Record<AiActionStatus, string> = {
  PENDING: "در انتظار تأیید",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
  EXECUTED: "اجراشده",
  FAILED: "ناموفق",
};
const STATUS_TONES: Record<AiActionStatus, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "neutral",
  REJECTED: "danger",
  EXECUTED: "success",
  FAILED: "danger",
};
const OPERATION_LABELS: Record<string, string> = { CREATE: "ثبت", UPDATE: "ویرایش", DELETE: "حذف" };

export default function AiAssistantSettingsPage() {
  const [actions, setActions] = useState<AiActionRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AiActionStatus | "ALL">("PENDING");
  const [cursor, setCursor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("open"),
  );

  function reload() {
    fetchAiActions({ status: filter === "ALL" ? undefined : filter, limit: 30 })
      .then((r) => {
        setActions(r.items);
        setCursor(r.nextCursor);
      })
      .catch(() => setActions([]));
  }
  function loadMore() {
    if (!cursor) return;
    fetchAiActions({ status: filter === "ALL" ? undefined : filter, cursor, limit: 30 }).then((r) => {
      setActions((prev) => [...(prev ?? []), ...r.items]);
      setCursor(r.nextCursor);
    });
  }
  useEffect(reload, [filter]);


  async function handleDecision(id: string, approve: boolean) {
    setBusyId(id);
    setError(null);
    try {
      if (approve) await approveAiAction(id);
      else await rejectAiAction(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-[720px]">
      <div>
        <h1 className="text-lg font-extrabold mb-1">دستیار هوشمند (MCP)</h1>
        <p className="text-[12.5px] text-muted">
          هر عملیات ثبت، ویرایش یا حذف که یک ایجنت هوش مصنوعی از طریق MCP درخواست می‌کند، اینجا برای تأیید شما نمایش داده می‌شود —
          عملیات‌های فقط-خواندنی (مثل فهرست‌کردن اطلاعات) نیازی به تأیید ندارند و بلافاصله اجرا می‌شوند.
        </p>
      </div>

      {error ? <div className="text-[12px] text-danger">{error}</div> : null}

      <div className="flex items-center gap-1.5 flex-wrap">
        {(["PENDING", "ALL", "EXECUTED", "FAILED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold border cursor-pointer ${filter === f ? "border-primary bg-primary text-white" : "border-border bg-slate-50 text-ink-soft"}`}
          >
            {f === "ALL" ? "همه" : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {actions === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : actions.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">هنوز درخواستی از دستیار هوشمند ثبت نشده است</div>
        ) : (
          actions.map((a, i) => (
            <div key={a.id} className={`px-4 py-3.5 ${i < actions.length - 1 ? "border-b border-border" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold">{a.summary}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {OPERATION_LABELS[a.operationType] ?? a.operationType} · {formatJalaliDateTime(a.createdAt)}
                    {a.decidedBy ? ` · تصمیم: ${a.decidedBy.name}` : ""}
                  </div>
                  {a.error ? <div className="text-[11.5px] text-danger mt-1">{a.error}</div> : null}
                  <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="text-[11.5px] font-bold text-primary mt-1 cursor-pointer">
                    {openId === a.id ? "پنهان‌کردن جزئیات" : "مشاهده‌ی جزئیات کامل"}
                  </button>
                </div>
                <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
              </div>
              {openId === a.id ? <AiActionDetails action={a} /> : null}
              {a.status === "PENDING" ? (
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    disabled={busyId === a.id}
                    onClick={() => (openId === a.id ? handleDecision(a.id, true) : setOpenId(a.id))}
                    className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {openId === a.id ? "تأیید و اجرا" : "تأیید (ابتدا جزئیات را ببینید)"}
                  </button>
                  <button
                    disabled={busyId === a.id}
                    onClick={() => handleDecision(a.id, false)}
                    className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    رد
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {cursor ? (
          <button onClick={loadMore} className="w-full py-2.5 text-[12px] font-bold text-primary cursor-pointer">
            نمایش بیشتر
          </button>
        ) : null}
      </Card>
    </div>
  );
}
