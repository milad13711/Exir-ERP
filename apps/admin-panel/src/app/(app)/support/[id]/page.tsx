"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { SendIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { useAdmin } from "@/lib/admin-context";
import { getSupportSocket } from "@/lib/support-socket";
import {
  fetchAdminTicket,
  assignTicketToMe,
  replyToTicket,
  resolveTicket,
  type SupportTicket,
  type SupportMessage,
} from "@/lib/api";

const STATUS_LABELS: Record<SupportTicket["status"], string> = {
  OPEN: "باز",
  IN_PROGRESS: "در حال پیگیری",
  RESOLVED: "رفع‌شده",
  CLOSED: "بسته‌شده",
};

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { admin } = useAdmin();
  const [ticket, setTicket] = useState<(SupportTicket & { messages: SupportMessage[] }) | null>(null);
  const [reply, setReply] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function reload() {
    fetchAdminTicket(id).then(setTicket).catch(() => {});
  }
  useEffect(reload, [id]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [ticket?.messages.length]);

  // Live delivery: join this ticket's room and append messages as they
  // arrive, instead of requiring the admin to leave and re-open the page.
  useEffect(() => {
    const socket = getSupportSocket();
    if (!socket) return;
    socket.emit("ticket:join", id);

    function onMessageNew(payload: { ticketId: string; message: SupportMessage }) {
      if (payload.ticketId !== id) return;
      setTicket((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.some((m) => m.id === payload.message.id)
                ? prev.messages
                : [...prev.messages, payload.message],
            }
          : prev,
      );
    }
    function onTicketUpdated(payload: { ticket: SupportTicket }) {
      if (payload.ticket.id !== id) return;
      setTicket((prev) => (prev ? { ...prev, ...payload.ticket } : prev));
    }

    socket.on("message:new", onMessageNew);
    socket.on("ticket:updated", onTicketUpdated);
    return () => {
      socket.emit("ticket:leave", id);
      socket.off("message:new", onMessageNew);
      socket.off("ticket:updated", onTicketUpdated);
    };
  }, [id]);

  async function handleAssignToMe() {
    if (!admin) return;
    setBusy(true);
    try {
      await assignTicketToMe(id, admin.id);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await replyToTicket(id, reply.trim());
      setReply("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!resolveNote.trim()) return;
    setBusy(true);
    try {
      await resolveTicket(id, resolveNote.trim());
      setShowResolve(false);
      setResolveNote("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) return <div className="p-8 text-center text-muted">در حال بارگذاری...</div>;

  return (
    <div className="p-5 lg:p-7 max-w-[800px] mx-auto flex flex-col h-[calc(100vh-64px)]">
      <Link href="/support" className="text-[12.5px] text-muted font-semibold">
        → بازگشت به تیکت‌ها
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap mt-3 shrink-0">
        <div>
          <h1 className="text-lg font-extrabold">{ticket.subject}</h1>
          <p className="text-[12.5px] text-muted mt-1">
            {ticket.tenant.name} ({ticket.tenant.slug})
            {ticket.assignedAdmin ? ` · ارجاع به ${ticket.assignedAdmin.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={ticket.status === "RESOLVED" ? "success" : ticket.status === "OPEN" ? "warning" : "primary"}>
            {STATUS_LABELS[ticket.status]}
          </Badge>
          {!ticket.assignedAdmin ? (
            <button
              onClick={handleAssignToMe}
              disabled={busy}
              className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              پیگیری این تیکت
            </button>
          ) : null}
          {ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" ? (
            <button
              onClick={() => setShowResolve((v) => !v)}
              className="text-[12px] font-bold text-success bg-success-soft px-3 py-1.5 rounded-lg cursor-pointer"
            >
              رفع تیکت
            </button>
          ) : null}
        </div>
      </div>

      {showResolve ? (
        <form onSubmit={handleResolve} className="flex items-center gap-2 mt-3 shrink-0">
          <input
            autoFocus
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
            placeholder="نتیجه‌ی پیگیری را بنویسید..."
            className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
          />
          <button
            type="submit"
            disabled={busy || !resolveNote.trim()}
            className="text-[12.5px] font-bold text-white bg-success px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            ثبت
          </button>
        </form>
      ) : null}

      <div className="flex-1 overflow-y-auto mt-4 flex flex-col gap-3 py-2">
        {ticket.messages.map((m) => {
          const isAdmin = m.senderType === "ADMIN";
          const isSystem = m.senderType === "SYSTEM";
          if (isSystem) {
            return (
              <div key={m.id} className="text-center text-[11.5px] text-muted">
                {m.body}
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[13px] ${
                  isAdmin ? "bg-primary text-white rounded-bl-sm" : "bg-slate-100 text-ink rounded-br-sm"
                }`}
              >
                {m.body}
                <div className={`text-[10px] mt-1 ${isAdmin ? "text-white/70" : "text-muted"}`}>
                  {formatJalaliDate(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleReply} className="flex items-center gap-2 pt-3 border-t border-border shrink-0">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="پاسخ خود را بنویسید..."
          className="flex-1 text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
        />
        <button
          type="submit"
          disabled={busy || !reply.trim()}
          className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0"
        >
          <SendIcon className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
