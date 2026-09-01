"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ChatIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { getSupportSocket } from "@/lib/support-socket";
import { fetchAdminTickets, type SupportTicket } from "@/lib/api";

const STATUS_LABELS: Record<SupportTicket["status"], string> = {
  OPEN: "باز",
  IN_PROGRESS: "در حال پیگیری",
  RESOLVED: "رفع‌شده",
  CLOSED: "بسته‌شده",
};

const STATUS_TONES: Record<SupportTicket["status"], "warning" | "primary" | "success" | "neutral"> = {
  OPEN: "warning",
  IN_PROGRESS: "primary",
  RESOLVED: "success",
  CLOSED: "neutral",
};

const PRIORITY_TONES: Record<SupportTicket["priority"], "danger" | "warning" | "neutral"> = {
  URGENT: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "همه" },
  { key: "OPEN", label: "باز" },
  { key: "IN_PROGRESS", label: "در حال پیگیری" },
  { key: "RESOLVED", label: "رفع‌شده" },
];

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchAdminTickets(filter || undefined).then(setTickets).catch(() => setTickets([]));
  }, [filter]);

  // Live: a new ticket or any status/message change re-pulls the list, so
  // an admin sitting on this page sees it without a manual refresh.
  useEffect(() => {
    const socket = getSupportSocket();
    if (!socket) return;
    function refresh() {
      fetchAdminTickets(filter || undefined).then(setTickets).catch(() => {});
    }
    socket.on("ticket:new", refresh);
    socket.on("ticket:updated", refresh);
    socket.on("message:new", refresh);
    return () => {
      socket.off("ticket:new", refresh);
      socket.off("ticket:updated", refresh);
      socket.off("message:new", refresh);
    };
  }, [filter]);

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <h1 className="text-xl font-extrabold">پشتیبانی — چت با تننت‌ها</h1>
      <p className="text-[13.5px] text-muted mt-1">تیکت‌های ثبت‌شده از پنل تننت‌ها، برای پیگیری و پاسخ</p>

      <div className="flex items-center gap-2 mt-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-[12px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer ${
              filter === f.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="mt-4 p-2">
        {tickets === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
            <ChatIcon className="w-6 h-6" />
            تیکتی یافت نشد
          </div>
        ) : (
          tickets.map((t, i) => (
            <Link
              key={t.id}
              href={`/support/${t.id}`}
              className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${
                i < tickets.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">{t.subject}</span>
                  <Badge tone={PRIORITY_TONES[t.priority]}>{t.priority}</Badge>
                </div>
                <div className="text-[11.5px] text-muted mt-1">
                  {t.tenant.name} · {formatJalaliDate(t.createdAt)}
                  {t.assignedAdmin ? ` · ارجاع به ${t.assignedAdmin.name}` : ""}
                </div>
              </div>
              <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge>
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
