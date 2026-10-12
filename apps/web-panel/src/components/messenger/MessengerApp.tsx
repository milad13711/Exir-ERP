"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SearchIcon, PlusIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import {
  getMessengerSocket,
  messengerApi,
  refreshMessengerUnread,
  type ConversationDetail,
  type ConversationSummary,
  type MessengerMessage,
} from "@/lib/messenger-api";
import { MessageBubble, type BubbleActions } from "./MessageBubble";
import { Composer, type SendPayload } from "./Composer";
import { ForwardDialog, GroupInfoDialog, NewChatDialog, NewGroupDialog, SettingsDialog } from "./Dialogs";
import { Avatar, clockFa, dayKey, dayLabel, lastSeenLabel, previewOf, ticksFor } from "./utils";

type Me = { userId: string; isManager: boolean };

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "خطایی رخ داد";
}

export function MessengerApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [replyTo, setReplyTo] = useState<MessengerMessage | null>(null);
  const [editing, setEditing] = useState<MessengerMessage | null>(null);
  const [forwarding, setForwarding] = useState<MessengerMessage | null>(null);
  const [dialog, setDialog] = useState<"chat" | "group" | "settings" | "info" | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<(MessengerMessage & { conversationTitle: string })[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [chatResults, setChatResults] = useState<(MessengerMessage & { conversationTitle: string })[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);

  const activeRef = useRef<string | null>(null);
  const meRef = useRef<Me | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prependRef = useRef<number | null>(null);
  const pendingJump = useRef<string | null>(null);
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadList = useCallback(() => {
    messengerApi.conversations().then(setConvs).catch((e) => setError(errMsg(e)));
  }, []);
  const scheduleList = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(loadList, 250);
  }, [loadList]);

  const markRead = useCallback(
    (convId: string, seq: number) => {
      if (document.visibilityState !== "visible" || seq <= 0) return;
      messengerApi.read(convId, seq).then(() => {
        refreshMessengerUnread();
        setConvs((cs) => cs?.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)) ?? cs);
      }).catch(() => undefined);
    },
    [],
  );

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      activeRef.current = id;
      setDetail(null);
      setMessages([]);
      setReplyTo(null);
      setEditing(null);
      setSearchOpen(false);
      setChatResults([]);
      setLoadingChat(true);
      stickRef.current = true;
      try {
        window.history.replaceState(null, "", `/messenger?c=${id}`);
      } catch {
        /* بی‌اهمیت */
      }
      try {
        const [d, page] = await Promise.all([messengerApi.conversation(id), messengerApi.messages(id)]);
        if (activeRef.current !== id) return;
        setDetail(d);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        markRead(id, d.lastSeq);
      } catch (e) {
        setError(errMsg(e));
        setActiveId(null);
      } finally {
        setLoadingChat(false);
      }
    },
    [markRead],
  );

  const closeConversation = useCallback(() => {
    setActiveId(null);
    activeRef.current = null;
    setDetail(null);
    setMessages([]);
    try {
      window.history.replaceState(null, "", "/messenger");
    } catch {
      /* بی‌اهمیت */
    }
  }, []);

  // بارگذاری اولیه + باز کردن ?c=
  useEffect(() => {
    (async () => {
      try {
        const [m] = await Promise.all([messengerApi.me(), messengerApi.conversations().then(setConvs)]);
        setMe(m);
        const c = new URLSearchParams(window.location.search).get("c");
        if (c) void openConversation(c);
      } catch (e) {
        setError(errMsg(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // رویدادهای زنده
  useEffect(() => {
    const s = getMessengerSocket();
    if (!s) return;
    const onNew = ({ message }: { message: MessengerMessage }) => {
      if (message.conversationId === activeRef.current) {
        setMessages((ms) => (ms.some((x) => x.id === message.id) ? ms : [...ms, message]));
        if (message.senderId !== meRef.current?.userId) markRead(message.conversationId, message.seq);
        setDetail((d) => (d && d.id === message.conversationId ? { ...d, lastSeq: Math.max(d.lastSeq, message.seq) } : d));
      }
      scheduleList();
    };
    const onUpdated = ({ message }: { message: MessengerMessage }) => {
      setMessages((ms) => ms.map((x) => (x.id === message.id ? message : x)));
      scheduleList();
    };
    const onHidden = ({ messageId }: { messageId: string }) => setMessages((ms) => ms.filter((x) => x.id !== messageId));
    const onReaction = ({ messageId, reactions }: { messageId: string; reactions: MessengerMessage["reactions"] }) =>
      setMessages((ms) => ms.map((x) => (x.id === messageId ? { ...x, reactions } : x)));
    const onConv = ({ conversationId }: { conversationId: string }) => {
      scheduleList();
      if (conversationId === activeRef.current) {
        messengerApi.conversation(conversationId).then(setDetail).catch(() => closeConversation());
      }
    };
    const onReceipt = (r: { conversationId: string; userId: string; lastReadSeq?: number; lastDeliveredSeq?: number }) => {
      setDetail((d) =>
        d && d.id === r.conversationId
          ? { ...d, members: d.members.map((m) => (m.userId === r.userId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, r.lastReadSeq ?? 0), lastDeliveredSeq: Math.max(m.lastDeliveredSeq, r.lastDeliveredSeq ?? 0) } : m)) }
          : d,
      );
    };
    const onTyping = ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      const now = Date.now();
      setClock(now);
      setTyping((t) => ({ ...t, [conversationId]: { ...(t[conversationId] ?? {}), [userId]: now + 4000 } }));
      setTimeout(() => setClock(Date.now()), 4200);
    };
    const onPresence = (p: { userId: string; online: boolean; lastSeenAt?: string | null }) => {
      setDetail((d) => (d ? { ...d, members: d.members.map((m) => (m.userId === p.userId ? { ...m, online: p.online, lastSeenAt: p.lastSeenAt ?? m.lastSeenAt } : m)) } : d));
      setConvs((cs) => cs?.map((c) => (c.peerId === p.userId ? { ...c, peerOnline: p.online } : c)) ?? cs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && activeRef.current) {
        setDetail((d) => {
          if (d) markRead(d.id, d.lastSeq);
          return d;
        });
      }
    };
    s.on("message:new", onNew);
    s.on("message:updated", onUpdated);
    s.on("message:hidden", onHidden);
    s.on("reaction:updated", onReaction);
    s.on("conversation:updated", onConv);
    s.on("receipt", onReceipt);
    s.on("typing", onTyping);
    s.on("presence", onPresence);
    s.on("connect", loadList);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      s.off("message:new", onNew);
      s.off("message:updated", onUpdated);
      s.off("message:hidden", onHidden);
      s.off("reaction:updated", onReaction);
      s.off("conversation:updated", onConv);
      s.off("receipt", onReceipt);
      s.off("typing", onTyping);
      s.off("presence", onPresence);
      s.off("connect", loadList);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [markRead, scheduleList, loadList, closeConversation]);

  // اسکرول: ته لیست برای پیام جدید/باز شدن، حفظ موقعیت هنگام بارگذاری قدیمی‌ترها
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependRef.current;
      prependRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    if (pendingJump.current) {
      const id = pendingJump.current;
      const target = document.getElementById(`msg-${id}`);
      if (target) {
        pendingJump.current = null;
        target.scrollIntoView({ block: "center" });
        setHighlightId(id);
        setTimeout(() => setHighlightId(null), 2200);
      }
    }
  }, [messages, detail]);

  async function loadOlder(): Promise<boolean> {
    if (!activeRef.current || messages.length === 0) return false;
    const el = scrollRef.current;
    if (el) prependRef.current = el.scrollHeight - el.scrollTop;
    stickRef.current = false;
    const page = await messengerApi.messages(activeRef.current, messages[0].seq);
    setMessages((ms) => [...page.messages.filter((p) => !ms.some((x) => x.id === p.id)), ...ms]);
    setHasMore(page.hasMore);
    return page.hasMore;
  }

  async function jumpTo(messageId: string) {
    for (let i = 0; i < 12; i++) {
      const target = document.getElementById(`msg-${messageId}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 2200);
        return;
      }
      if (!hasMore && i > 0) break;
      pendingJump.current = messageId;
      try {
        const more = await loadOlder();
        await new Promise((r) => setTimeout(r, 120));
        if (!more) {
          const t2 = document.getElementById(`msg-${messageId}`);
          if (t2) continue;
          break;
        }
      } catch {
        break;
      }
    }
  }

  // جست‌وجوی سراسری (فهرست) و درون‌گفتگو
  useEffect(() => {
    const q = listQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => messengerApi.search(q).then(setGlobalResults).catch(() => setGlobalResults([])), 400);
    return () => clearTimeout(t);
  }, [listQuery]);

  useEffect(() => {
    const q = chatQuery.trim();
    if (!searchOpen || q.length < 2 || !activeId) return;
    const t = setTimeout(() => messengerApi.search(q, activeId).then(setChatResults).catch(() => setChatResults([])), 400);
    return () => clearTimeout(t);
  }, [chatQuery, searchOpen, activeId]);

  // ── اقدام‌ها ──
  async function send(p: SendPayload) {
    if (!activeId) return;
    stickRef.current = true;
    const msg = await messengerApi.send(activeId, p);
    setMessages((ms) => (ms.some((x) => x.id === msg.id) ? ms : [...ms, msg]));
    setReplyTo(null);
    scheduleList();
  }

  async function submitEdit(m: MessengerMessage, text: string) {
    const updated = await messengerApi.edit(m.id, text);
    setMessages((ms) => ms.map((x) => (x.id === updated.id ? updated : x)));
    setEditing(null);
  }

  const pinnedIds = useMemo(() => new Set(detail?.pinned.map((p) => p.id) ?? []), [detail]);

  const actions: BubbleActions = {
    onReply: (m) => { setEditing(null); setReplyTo(m); },
    onForward: (m) => setForwarding(m),
    onSave: async (m) => {
      try {
        await messengerApi.save(m.id);
        flash("در «ذخیره‌شده‌ها» ذخیره شد");
        scheduleList();
      } catch (e) { flash(errMsg(e)); }
    },
    onReact: async (m, emoji) => {
      try {
        const r = await messengerApi.react(m.id, emoji);
        setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, reactions: r.reactions } : x)));
      } catch (e) { flash(errMsg(e)); }
    },
    onCopy: (m) => { void navigator.clipboard?.writeText(m.text ?? "").then(() => flash("کپی شد")); },
    onEdit: (m) => { setReplyTo(null); setEditing(m); },
    onPin: async (m, pin) => {
      if (!activeId) return;
      try { setDetail(await messengerApi.pin(activeId, m.id, pin)); } catch (e) { flash(errMsg(e)); }
    },
    onDelete: async (m, scope) => {
      if (scope === "all" && !window.confirm("این پیام برای همه حذف شود؟")) return;
      try {
        await messengerApi.remove(m.id, scope);
        if (scope === "me") setMessages((ms) => ms.filter((x) => x.id !== m.id));
        scheduleList();
      } catch (e) { flash(errMsg(e)); }
    },
    onJump: (id) => void jumpTo(id),
  };

  async function toggleMute() {
    if (!detail) return;
    try {
      const r = await messengerApi.mute(detail.id, !detail.muted);
      setDetail({ ...detail, muted: r.muted });
      scheduleList();
    } catch (e) { flash(errMsg(e)); }
  }

  const shownGlobal = listQuery.trim().length >= 2 ? globalResults : [];
  const shownChat = searchOpen && chatQuery.trim().length >= 2 ? chatResults : [];
  const filteredConvs = (convs ?? []).filter((c) => !listQuery.trim() || c.title.includes(listQuery.trim()));
  const typingNow = detail ? Object.entries(typing[detail.id] ?? {}).filter(([, until]) => until > clock).map(([uid]) => detail.members.find((m) => m.userId === uid)?.name ?? "") : [];
  const peer = detail?.type === "DIRECT" ? detail.members.find((m) => m.userId === detail.peerId) : null;
  const subtitle = typingNow.length
    ? `${typingNow.join("، ")} در حال نوشتن…`
    : detail?.type === "GROUP"
      ? `${toPersianDigits(detail.members.length)} عضو`
      : detail?.type === "SAVED"
        ? "پیام‌های ذخیره‌شده‌ی شما"
        : peer ? lastSeenLabel(peer.online, peer.lastSeenAt) : "";
  const canPin = !!detail && (detail.type !== "GROUP" || detail.myRole !== "MEMBER");
  const latestPin = detail?.pinned[0] ?? null;

  return (
    <div className="h-full min-h-[480px] flex bg-surface md:border md:border-border md:rounded-2xl md:m-4 md:h-[calc(100%-2rem)] overflow-hidden relative">
      {/* ── فهرست گفتگوها ── */}
      <aside className={clsx("flex-col w-full md:w-[340px] md:border-e border-border shrink-0", activeId ? "hidden md:flex" : "flex")}>
        <div className="px-3.5 pt-3.5 pb-2 border-b border-border">
          <div className="flex items-center justify-between mb-2.5">
            <h1 className="text-[16px] font-extrabold">پیام‌رسان داخلی</h1>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setDialog("settings")} className="w-8 h-8 rounded-lg hover:bg-slate-50 text-muted cursor-pointer" aria-label="تنظیمات" title="تنظیمات">⚙</button>
              <button type="button" onClick={() => setDialog("group")} className="w-8 h-8 rounded-lg hover:bg-slate-50 cursor-pointer text-muted" aria-label="گروه جدید" title="گروه جدید">👥</button>
              <button type="button" onClick={() => setDialog("chat")} className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center cursor-pointer" aria-label="گفتگوی جدید" title="گفتگوی جدید"><PlusIcon className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="relative">
            <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 start-3" />
            <input value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder="جست‌وجوی گفتگو و پیام…" className="w-full rounded-xl bg-background border border-border ps-9 pe-3 py-2 text-[13px] outline-none focus:border-primary" />
          </div>
          <div className="text-[10.5px] text-muted mt-2 leading-relaxed">🔒 گفتگوهای خصوصی فقط برای اعضای خودشان قابل مشاهده است؛ مدیران هم دسترسی ندارند.</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convs === null ? <div className="p-5 text-sm text-muted">در حال بارگذاری…</div> : null}
          {filteredConvs.map((c) => (
            <button key={c.id} type="button" onClick={() => void openConversation(c.id)} className={clsx("w-full flex items-center gap-3 px-3.5 py-3 text-start border-b border-border/60 cursor-pointer hover:bg-slate-50", activeId === c.id && "bg-primary-soft")}>
              <div className="relative">
                <Avatar name={c.title} tone={c.type === "SAVED" ? "saved" : "primary"} />
                {c.peerOnline ? <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[14px] font-bold truncate">{c.type === "GROUP" ? "👥 " : ""}{c.title}</div>
                  <div className="text-[10.5px] text-muted shrink-0">{c.lastMessage ? clockFa(c.lastMessage.createdAt) : ""}</div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <div className="text-[12.5px] text-muted truncate" dir="auto">
                    {c.lastMessage && c.type === "GROUP" && c.lastMessage.kind !== "SYSTEM" ? `${c.lastMessage.senderName}: ` : ""}
                    {previewOf(c.lastMessage) || (c.type === "SAVED" ? "پیام‌ها را اینجا ذخیره کنید" : "")}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.muted ? <span className="text-[11px]" title="بی‌صدا">🔕</span> : null}
                    {c.unread > 0 ? <span className={clsx("min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center", c.muted ? "bg-muted" : "bg-primary")}>{toPersianDigits(c.unread)}</span> : null}
                  </div>
                </div>
              </div>
            </button>
          ))}
          {shownGlobal.length > 0 ? (
            <div>
              <div className="px-3.5 py-2 text-[11.5px] font-bold text-muted bg-slate-50">پیام‌ها</div>
              {shownGlobal.map((r) => (
                <button key={r.id} type="button" onClick={async () => { pendingJump.current = r.id; await openConversation(r.conversationId); setListQuery(""); setTimeout(() => void jumpTo(r.id), 300); }} className="w-full text-start px-3.5 py-2.5 border-b border-border/60 hover:bg-slate-50 cursor-pointer">
                  <div className="text-[12px] font-bold text-primary">{r.conversationTitle}</div>
                  <div className="text-[12.5px] truncate" dir="auto"><b>{r.senderName}:</b> {r.text}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      {/* ── گفتگوی فعال ── */}
      <section className={clsx("flex-1 min-w-0 flex-col bg-background", activeId ? "flex" : "hidden md:flex")}>
        {!activeId || !me ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted p-8">
            <div className="text-5xl mb-3" aria-hidden>💬</div>
            <div className="text-[15px] font-bold text-ink mb-1">یک گفتگو را انتخاب کنید</div>
            <div className="text-[12.5px]">یا با «＋» گفتگوی تازه شروع کنید.</div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2.5 px-3 py-2.5 bg-surface border-b border-border">
              <button type="button" onClick={closeConversation} className="md:hidden w-9 h-9 rounded-lg text-lg cursor-pointer" aria-label="بازگشت">→</button>
              <Avatar name={detail?.title ?? "…"} size={38} tone={detail?.type === "SAVED" ? "saved" : "primary"} />
              <button type="button" className="min-w-0 flex-1 text-start cursor-pointer" onClick={() => detail?.type === "GROUP" && setDialog("info")}>
                <div className="text-[14.5px] font-extrabold truncate">{detail?.title ?? "…"}</div>
                <div className={clsx("text-[11.5px] truncate", typingNow.length ? "text-primary font-bold" : "text-muted")}>{subtitle}</div>
              </button>
              <button type="button" onClick={() => setSearchOpen((v) => !v)} className="w-9 h-9 rounded-lg hover:bg-slate-50 flex items-center justify-center text-muted cursor-pointer" aria-label="جست‌وجو در گفتگو"><SearchIcon className="w-[18px] h-[18px]" /></button>
              {detail?.type !== "SAVED" ? <button type="button" onClick={() => void toggleMute()} className="w-9 h-9 rounded-lg hover:bg-slate-50 cursor-pointer" aria-label="بی‌صدا" title={detail?.muted ? "فعال‌سازی اعلان" : "بی‌صدا کردن"}>{detail?.muted ? "🔕" : "🔔"}</button> : null}
              {detail?.type === "GROUP" ? <button type="button" onClick={() => setDialog("info")} className="w-9 h-9 rounded-lg hover:bg-slate-50 cursor-pointer" aria-label="اطلاعات گروه">ⓘ</button> : null}
            </header>

            {searchOpen ? (
              <div className="bg-surface border-b border-border px-3 py-2">
                <input autoFocus value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} placeholder="جست‌وجو در این گفتگو…" className="w-full rounded-xl bg-background border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" />
                {shownChat.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto mt-2">
                    {shownChat.map((r) => (
                      <button key={r.id} type="button" onClick={() => void jumpTo(r.id)} className="w-full text-start px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <div className="text-[11px] text-muted">{r.senderName} · {clockFa(r.createdAt)}</div>
                        <div className="text-[12.5px] truncate" dir="auto">{r.text}</div>
                      </button>
                    ))}
                  </div>
                ) : chatQuery.trim().length >= 2 ? <div className="text-[12px] text-muted mt-2">نتیجه‌ای یافت نشد.</div> : null}
              </div>
            ) : null}

            {latestPin ? (
              <button type="button" onClick={() => void jumpTo(latestPin.id)} className="flex items-center gap-2 px-3.5 py-1.5 bg-surface border-b border-border text-[12.5px] text-start cursor-pointer">
                <span>📌</span>
                <span className="font-bold text-primary shrink-0">پیام سنجاق‌شده{detail && detail.pinned.length > 1 ? ` (${toPersianDigits(detail.pinned.length)})` : ""}</span>
                <span className="truncate text-ink-soft" dir="auto">{previewOf(latestPin)}</span>
              </button>
            ) : null}

            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
              }}
              className="flex-1 overflow-y-auto px-3 py-3"
            >
              {hasMore ? (
                <div className="text-center mb-3">
                  <button type="button" onClick={() => void loadOlder()} className="text-[12px] font-bold text-primary bg-primary-soft rounded-full px-4 py-1.5 cursor-pointer">پیام‌های قدیمی‌تر</button>
                </div>
              ) : null}
              {loadingChat ? <div className="text-center text-sm text-muted py-8">در حال بارگذاری…</div> : null}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                const mine = m.senderId === me.userId;
                return (
                  <div key={m.id}>
                    {newDay ? <div className="flex justify-center my-3"><span className="text-[11.5px] text-muted bg-surface border border-border rounded-full px-3 py-0.5">{dayLabel(m.createdAt)}</span></div> : null}
                    <MessageBubble
                      m={m}
                      mine={mine}
                      myId={me.userId}
                      showSender={detail?.type === "GROUP" && (!prev || prev.senderId !== m.senderId || newDay)}
                      ticks={ticksFor(m, detail, me.userId)}
                      pinned={pinnedIds.has(m.id)}
                      canPin={canPin}
                      canDeleteForAll={mine || (detail?.type === "GROUP" && detail.myRole !== "MEMBER")}
                      highlight={highlightId === m.id}
                      actions={actions}
                    />
                  </div>
                );
              })}
              {!loadingChat && messages.length === 0 ? <div className="text-center text-sm text-muted py-10">هنوز پیامی نیست؛ اولین پیام را بفرستید.</div> : null}
            </div>

            <Composer
              key={`${activeId}-${editing?.id ?? ""}`}
              conversationId={activeId}
              replyTo={replyTo}
              editing={editing}
              onCancelContext={() => { setReplyTo(null); setEditing(null); }}
              onSend={send}
              onEditSubmit={submitEdit}
              onTyping={() => getMessengerSocket()?.emit("typing", { conversationId: activeId })}
            />
          </>
        )}
      </section>

      {notice ? <div className="absolute bottom-20 start-1/2 -translate-x-1/2 bg-ink text-white text-[12.5px] font-semibold rounded-full px-4 py-2 shadow-lg z-40">{notice}</div> : null}
      {error ? (
        <div className="absolute top-3 start-1/2 -translate-x-1/2 bg-danger-soft text-danger text-[12.5px] font-semibold rounded-xl px-4 py-2 shadow z-40 flex items-center gap-3">
          {error}
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">✕</button>
        </div>
      ) : null}

      {dialog === "chat" ? <NewChatDialog onClose={() => setDialog(null)} onOpen={(id) => { setDialog(null); loadList(); void openConversation(id); }} /> : null}
      {dialog === "group" ? <NewGroupDialog onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); loadList(); void openConversation(id); }} /> : null}
      {dialog === "settings" ? <SettingsDialog isManager={!!me?.isManager} onClose={() => setDialog(null)} /> : null}
      {dialog === "info" && detail && me ? (
        <GroupInfoDialog
          detail={detail}
          myId={me.userId}
          onClose={() => setDialog(null)}
          onChanged={(d) => { setDetail(d); scheduleList(); }}
          onLeft={() => { setDialog(null); closeConversation(); loadList(); }}
        />
      ) : null}
      {forwarding ? (
        <ForwardDialog
          conversations={convs ?? []}
          onClose={() => setForwarding(null)}
          onForward={async (ids) => {
            await messengerApi.forward(forwarding.id, ids);
            setForwarding(null);
            flash("فوروارد شد");
            scheduleList();
          }}
        />
      ) : null}
    </div>
  );
}
