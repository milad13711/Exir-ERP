"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatIcon, CloseIcon } from "@/components/icons";
import { getSupportSocket } from "@/lib/support-socket";

type Toast = {
  id: string;
  ticketId: string;
  title: string;
  body: string;
};

type TicketPayload = {
  id: string;
  subject: string;
  tenant?: { name: string };
};

/**
 * Mounted once in the admin app shell. Owns the single `/support` socket
 * connection and turns `ticket:new` / `message:new` events into a floating
 * popup — this is what makes support "live" in the admin panel instead of
 * only visible after navigating to /support and reloading.
 */
export function SupportLiveNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();

  useEffect(() => {
    const socket = getSupportSocket();
    if (!socket) return;

    function pushToast(toast: Toast) {
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 8000);
    }

    function onTicketNew(payload: { ticket: TicketPayload }) {
      const t = payload.ticket;
      pushToast({
        id: `ticket-${t.id}-${Date.now()}`,
        ticketId: t.id,
        title: t.tenant ? `تیکت جدید از ${t.tenant.name}` : "تیکت پشتیبانی جدید",
        body: t.subject,
      });
    }

    function onMessageNew(payload: { ticketId: string; message: { senderType: string; body: string } }) {
      if (payload.message.senderType !== "TENANT_USER") return;
      pushToast({
        id: `msg-${payload.ticketId}-${Date.now()}`,
        ticketId: payload.ticketId,
        title: "پیام جدید از تننت",
        body: payload.message.body,
      });
    }

    socket.on("ticket:new", onTicketNew);
    socket.on("message:new", onMessageNew);
    return () => {
      socket.off("ticket:new", onTicketNew);
      socket.off("message:new", onMessageNew);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-5 inset-x-3 lg:inset-x-auto lg:left-5 z-[100] flex flex-col gap-2.5 lg:w-[320px]" dir="rtl">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="bg-surface border border-border rounded-2xl shadow-2xl p-3.5 flex items-start gap-3 cursor-pointer animate-sheet"
          onClick={() => {
            router.push(`/support/${t.ticketId}`);
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
        >
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
            <ChatIcon className="w-[17px] h-[17px] text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-bold">{t.title}</div>
            <div className="text-[12px] text-muted mt-0.5 line-clamp-2">{t.body}</div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
            className="text-muted shrink-0"
            aria-label="بستن اعلان"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
