"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CloseIcon, ChatIcon, SendIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import {
  fetchTickets,
  createTicket,
  fetchTicketMessages,
  addTicketMessage,
  type SupportTicket,
  type SupportMessage,
} from "@/lib/api";
import { getSupportSocket } from "@/lib/support-socket";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { TasksSection } from "@/components/shared/TasksSection";

const statusLabel: Record<SupportTicket["status"], string> = {
  OPEN: "در انتظار بررسی",
  IN_PROGRESS: "در حال بررسی",
  RESOLVED: "رفع شده",
  CLOSED: "بسته شده",
};

export function SupportChat({
  open,
  onClose,
  onUnreadChange,
}: {
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (unread: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [view, setView] = useState<"list" | "thread">("thread");
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const ticketIdRef = useRef<string | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || loaded) return;
    fetchTickets()
      .then(async (list) => {
        setTickets(list);
        const latest = list[0] ?? null;
        setTicket(latest);
        if (latest) {
          const res = await fetchTicketMessages(latest.id);
          setMessages(res.messages);
        }
      })
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  async function openTicketThread(t: SupportTicket) {
    setView("thread");
    setTicket(t);
    setMessages([]);
    const res = await fetchTicketMessages(t.id);
    setMessages(res.messages);
  }

  function startNewTicket() {
    setView("thread");
    setTicket(null);
    setMessages([]);
  }

  // Live delivery: one shared socket per tab, joined to this ticket's room
  // once it's known, and to the tenant-wide room by default (server-side) so
  // a reply lands here immediately instead of waiting for a manual reload.
  useEffect(() => {
    const socket = getSupportSocket();
    if (!socket) return;

    function onMessageNew(payload: { ticketId: string; message: SupportMessage }) {
      if (payload.ticketId !== ticketIdRef.current) return;
      setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
      if (payload.message.senderType !== "TENANT_USER" && !openRef.current) {
        onUnreadChange?.(true);
      }
    }
    function onTicketUpdated(payload: { ticket: SupportTicket }) {
      setTickets((prev) => prev.map((t) => (t.id === payload.ticket.id ? { ...t, ...payload.ticket } : t)));
      if (payload.ticket.id !== ticketIdRef.current) return;
      setTicket((prev) => (prev ? { ...prev, ...payload.ticket } : prev));
    }

    socket.on("message:new", onMessageNew);
    socket.on("ticket:updated", onTicketUpdated);
    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("ticket:updated", onTicketUpdated);
    };
  }, [onUnreadChange]);

  const ticketId = ticket?.id ?? null;
  useEffect(() => {
    ticketIdRef.current = ticketId;
    if (!ticketId) return;
    const socket = getSupportSocket();
    socket?.emit("ticket:join", ticketId);
    return () => {
      socket?.emit("ticket:leave", ticketId);
    };
  }, [ticketId]);

  useEffect(() => {
    if (open) onUnreadChange?.(false);
  }, [open, onUnreadChange]);

  async function handleOpenTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !draft.trim()) return;
    setSending(true);
    try {
      const created = await createTicket(subject.trim(), draft.trim());
      setTicket(created);
      setMessages(created.messages);
      setTickets((prev) => [created, ...prev]);
      setDraft("");
      setSubject("");
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !ticket) return;
    setSending(true);
    try {
      const msg = await addTicketMessage(ticket.id, draft.trim());
      setMessages((prev) => [...prev, msg]);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 bg-slate-900/30 z-40 transition-opacity lg:bg-transparent lg:pointer-events-none",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />
      <div
        className={clsx(
          "fixed z-50 bottom-0 inset-x-0 lg:inset-x-auto lg:bottom-6 lg:end-6",
          "w-full lg:w-[400px] h-[85vh] lg:h-[620px]",
          "bg-surface rounded-t-3xl lg:rounded-3xl shadow-2xl border border-border",
          "flex flex-col overflow-hidden transition-transform duration-200",
          open ? "translate-y-0" : "translate-y-full lg:translate-y-8 lg:opacity-0 pointer-events-none",
        )}
        role="dialog"
        aria-label="پشتیبانی زنده"
      >
        <div className="bg-gradient-to-br from-indigo-800 to-teal-600 px-4.5 pt-4.5 pb-4 text-white shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9.5 h-9.5 rounded-[11px] bg-white/20 flex items-center justify-center shrink-0">
                <ChatIcon className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold">پشتیبانی زنده اکسیر</div>
                <div className="text-[11.5px] text-white/80 flex items-center gap-1.5 mt-0.5 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  {ticket?.assignedAdmin ? `کارشناس: ${ticket.assignedAdmin.name}` : "پیام خود را ثبت کنید"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {tickets.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setView((v) => (v === "list" ? "thread" : "list"))}
                  className="text-[11.5px] font-bold text-white/90 cursor-pointer"
                >
                  {view === "list" ? "بازگشت" : "تاریخچه"}
                </button>
              ) : null}
              <button type="button" onClick={onClose} aria-label="بستن پشتیبانی">
                <CloseIcon className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>
        </div>

        {view === "list" ? null : ticket ? (
          <div className="mx-4 mt-3.5 p-3 rounded-2xl bg-warning-soft border border-amber-200 shrink-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[12.5px] font-bold text-amber-800 min-w-0 truncate">{ticket.subject}</div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAttachmentsOpen((v) => !v)}
                  className="text-[11px] font-bold text-amber-800 cursor-pointer"
                >
                  {attachmentsOpen ? "پنهان کردن" : "پیوست‌ها و وظایف"}
                </button>
                <button
                  type="button"
                  onClick={startNewTicket}
                  className="text-[11px] font-bold text-amber-800 cursor-pointer"
                >
                  گفتگوی جدید
                </button>
              </div>
            </div>
            <div className="text-[11.5px] text-amber-800 mt-0.5">
              وضعیت: {statusLabel[ticket.status]}
              {ticket.assignedAdmin ? ` · ارجاع به: ${ticket.assignedAdmin.name}` : ""}
            </div>
            {attachmentsOpen ? (
              <div className="mt-2.5 pt-2.5 border-t border-amber-200 flex flex-col gap-3 max-h-[220px] overflow-y-auto">
                <AttachmentsSection entityType="SupportTicket" entityId={ticket.id} />
                <TasksSection relatedModule="support" relatedEntityId={ticket.id} />
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "list" ? (
          <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={startNewTicket}
              className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer shrink-0"
            >
              + شروع گفتگوی جدید
            </button>
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openTicketThread(t)}
                className="text-start p-3 rounded-xl bg-slate-50 border border-border hover:border-primary transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-bold truncate">{t.subject}</span>
                  <span className="text-[10.5px] text-muted shrink-0">{formatJalaliDate(t.createdAt)}</span>
                </div>
                <div className="text-[11px] text-muted mt-1">
                  وضعیت: {statusLabel[t.status]}
                  {t.messages[0] ? ` · ${t.messages[0].body.slice(0, 40)}` : ""}
                </div>
              </button>
            ))}
          </div>
        ) : !loaded ? (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">در حال بارگذاری...</div>
        ) : !ticket ? (
          <form onSubmit={handleOpenTicket} className="flex-1 flex flex-col px-4 py-3 gap-3">
            <div className="text-[13px] text-ink-soft leading-relaxed">
              مشکل یا سؤال خود را بنویسید تا کارشناس پشتیبانی بررسی کند.
            </div>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="موضوع (مثلاً: خطا در صدور فاکتور)"
              className="px-3.5 py-2.5 rounded-xl border border-border text-[13px] outline-none focus:border-primary"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="توضیح دهید چه مشکلی پیش آمده..."
              rows={4}
              className="px-3.5 py-2.5 rounded-xl border border-border text-[13px] outline-none focus:border-primary resize-none"
            />
            <button
              type="submit"
              disabled={sending || !subject.trim() || !draft.trim()}
              className="py-2.75 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50"
            >
              {sending ? "در حال ارسال..." : "ثبت درخواست پشتیبانی"}
            </button>
          </form>
        ) : (
          <>
            <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3.5">
              {messages.map((m) => {
                if (m.senderType === "SYSTEM") {
                  return (
                    <div
                      key={m.id}
                      className="self-center text-[11px] text-muted bg-slate-100 px-3 py-1.5 rounded-lg"
                    >
                      {m.body}
                    </div>
                  );
                }
                const isUser = m.senderType === "TENANT_USER";
                return (
                  <div key={m.id} className={clsx("max-w-[80%]", isUser ? "self-end" : "self-start")}>
                    <div
                      className={clsx(
                        "px-3.5 py-2.5 text-[13px] leading-relaxed",
                        isUser
                          ? "bg-primary text-white rounded-2xl rounded-es-md"
                          : "bg-slate-100 text-ink rounded-2xl rounded-ee-md",
                      )}
                    >
                      {m.body}
                    </div>
                    <div className={clsx("text-[10.5px] text-muted mt-1", isUser ? "text-end" : "text-start")}>
                      {formatJalaliDate(m.createdAt)}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleSendMessage} className="shrink-0 p-3.5 border-t border-border flex items-center gap-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="پیام خود را بنویسید..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-100 text-[13px] outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="w-9.5 h-9.5 rounded-xl bg-primary flex items-center justify-center shrink-0 disabled:opacity-50"
                aria-label="ارسال پیام"
              >
                <SendIcon className="w-[17px] h-[17px] text-white" />
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
