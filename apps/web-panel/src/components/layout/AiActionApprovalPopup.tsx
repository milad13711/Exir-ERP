"use client";

import { useEffect, useState } from "react";
import { getAiApprovalSocket } from "@/lib/ai-approval-socket";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchAiActions, approveAiAction, rejectAiAction, ApiError } from "@/lib/api";
import { BotIcon } from "@/components/icons";

type PendingAction = { id: string; toolName: string; operationType: string; summary: string };

const OPERATION_LABELS: Record<string, string> = { CREATE: "ثبت", UPDATE: "ویرایش", DELETE: "حذف" };

export function AiActionApprovalPopup() {
  const { installedModules } = useWorkspace();
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!installedModules.has("mcp")) return;

    fetchAiActions()
      .then((all) =>
        setPending(
          all
            .filter((a) => a.status === "PENDING")
            .map((a) => ({ id: a.id, toolName: a.toolName, operationType: a.operationType, summary: a.summary })),
        ),
      )
      .catch(() => {});

    const socket = getAiApprovalSocket();
    if (!socket) return;

    function onPending(payload: PendingAction) {
      setPending((prev) => (prev.some((p) => p.id === payload.id) ? prev : [...prev, payload]));
    }
    function onResolved(payload: { id: string }) {
      setPending((prev) => prev.filter((p) => p.id !== payload.id));
    }
    socket.on("action.pending", onPending);
    socket.on("action.resolved", onResolved);
    return () => {
      socket.off("action.pending", onPending);
      socket.off("action.resolved", onResolved);
    };
  }, [installedModules]);

  if (pending.length === 0) return null;

  async function handleDecision(id: string, approve: boolean) {
    setBusyId(id);
    try {
      if (approve) await approveAiAction(id);
      else await rejectAiAction(id);
      setPending((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      // خطای اجرای اقدام تأییدشده را همینجا نشان بده — ردیف را نگه دار تا کاربر متن خطا را ببیند
      if (err instanceof ApiError) alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[340px] flex flex-col gap-2.5">
      {pending.map((action) => {
        const opLabel = OPERATION_LABELS[action.operationType] ?? action.operationType;
        return (
          <div key={action.id} className="bg-surface border border-warning/30 rounded-2xl shadow-lg p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-warning-soft text-warning flex items-center justify-center shrink-0">
                <BotIcon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-bold text-warning">درخواست {opLabel} از دستیار هوشمند</div>
                <div className="text-[13px] mt-0.5">{action.summary}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={busyId === action.id}
                onClick={() => handleDecision(action.id, true)}
                className="flex-1 text-[12px] font-bold text-white bg-primary px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                تأیید و اجرا
              </button>
              <button
                disabled={busyId === action.id}
                onClick={() => handleDecision(action.id, false)}
                className="flex-1 text-[12px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                رد
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
