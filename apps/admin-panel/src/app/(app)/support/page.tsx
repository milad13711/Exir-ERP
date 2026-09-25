"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
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

const PRIORITY_LABELS: Record<SupportTicket["priority"], string> = { URGENT: "فوری", MEDIUM: "متوسط", LOW: "کم" };

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
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto">
      <PageHeader title="پشتیبانی — چت با تننت‌ها" subtitle="تیکت‌های ثبت‌شده از پنل تننت‌ها، برای پیگیری و پاسخ" />

      <div className="flex items-center gap-2 mt-5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 [&>button]:shrink-0">
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

      <div className="mt-4 flex flex-col gap-2.5">
        {tickets === null ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-slate-200/60 animate-pulse" />)
        ) : tickets.length === 0 ? (
          <Card className="p-10 text-center text-muted text-sm flex flex-col items-center gap-2">
            <ChatIcon className="w-6 h-6" />
            تیکتی یافت نشد
          </Card>
        ) : (
          tickets.map((t) => (
            <Link key={t.id} href={`/support/${t.id}`} className="block">
              <Card className="p-4 hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[13.5px] font-extrabold leading-6 min-w-0">{t.subject}</div>
                  <Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-2.5 text-[11.5px] text-muted">
                  <span className="font-semibold text-ink-soft">{t.tenant.name}</span>
                  <span>·</span>
                  <span>{formatJalaliDate(t.createdAt)}</span>
                  <Badge tone={PRIORITY_TONES[t.priority]}>{PRIORITY_LABELS[t.priority]}</Badge>
                  {t.assignedAdmin ? <span>· ارجاع به {t.assignedAdmin.name}</span> : null}
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
