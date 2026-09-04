"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
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

  function reload() {
    fetchAiActions().then(setActions).catch(() => setActions([]));
  }
  useEffect(reload, []);

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
                </div>
                <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
              </div>
              {a.status === "PENDING" ? (
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    disabled={busyId === a.id}
                    onClick={() => handleDecision(a.id, true)}
                    className="text-[11.5px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    تأیید و اجرا
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
      </Card>
    </div>
  );
}
