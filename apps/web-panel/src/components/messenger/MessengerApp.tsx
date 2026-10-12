"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { SearchIcon, PlusIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { ApiError } from "@/lib/api";
import {
  MessengerNetworkError,
  getMessengerSocket,
  messengerApi,
  type ChatMessage,
  type ConversationDetail,
  type ConversationSummary,
  type MessengerMessage,
} from "@/lib/messenger-api";
import { onMessengerResync, refreshMessengerUnread, registerChatOpener, setActiveConversation } from "@/lib/messenger-runtime";
import { MessageBubble, TicksMark, type BubbleActions } from "./MessageBubble";
import { Composer, type SendPayload } from "./Composer";
import { ForwardDialog, GroupInfoDialog, NewChatDialog, NewGroupDialog, SettingsDialog } from "./Dialogs";
import { Avatar, clockFa, dayKey, dayLabel, lastSeenLabel, loadAllDrafts, loadDraft, previewOf, saveDraft, sortConvs, ticksFor } from "./utils";

type Me = { userId: string; isManager: boolean };

type OutboxItem = {
  clientId: string;
  conversationId: string;
  text?: string;
  replyToId?: string;
  mediaId?: string;
  media?: SendPayload["media"];
  replyPreview?: ChatMessage["replyTo"];
  createdAt: string;
  status: "pending" | "failed";
  error?: string;
};

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "خطایی رخ داد";
}

function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const outboxKey = (userId: string) => `exir-messenger-outbox:${userId}`;

function loadOutbox(userId: string): OutboxItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(outboxKey(userId)) ?? "[]");
    return Array.isArray(raw) ? (raw as OutboxItem[]).filter((i) => i && typeof i.clientId === "string") : [];
  } catch {
    return [];
  }
}
function persistOutbox(userId: string, items: OutboxItem[]) {
  try {
    if (items.length) localStorage.setItem(outboxKey(userId), JSON.stringify(items));
    else localStorage.removeItem(outboxKey(userId));
  } catch {
    /* بی‌اهمیت */
  }
}

function mergeServer(prev: ChatMessage[], incoming: MessengerMessage[]): ChatMessage[] {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

function toLocal(item: OutboxItem, me: Me): ChatMessage {
  return {
    id: `local-${item.clientId}`,
    conversationId: item.conversationId,
    seq: Number.MAX_SAFE_INTEGER,
    senderId: me.userId,
    senderName: "شما",
    kind: item.mediaId ? "MEDIA" : "TEXT",
    text: item.text ?? null,
    createdAt: item.createdAt,
    editedAt: null,
    deleted: false,
    replyTo: item.replyPreview ?? null,
    forwardedFrom: null,
    media: item.media
      ? { id: `local-${item.clientId}`, kind: item.media.kind, mime: item.media.mime, fileName: item.media.fileName, size: item.media.size, expiresAt: item.createdAt, expired: false, hoursLeft: 24 }
      : null,
    reactions: [],
    mentionIds: [],
    clientId: item.clientId,
    local: item.status,
    localError: item.error,
  };
}

export function MessengerApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [divider, setDivider] = useState<{ seq: number; count: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [below, setBelow] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);
  const [connected, setConnected] = useState(true);

  const activeRef = useRef<string | null>(null);
  const meRef = useRef<Me | null>(null);
  const convsRef = useRef<ConversationSummary[] | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const outboxRef = useRef<OutboxItem[]>([]);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const flushing = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prependRef = useRef<number | null>(null);
  const pendingJump = useRef<string | null>(null);
  const toDividerRef = useRef(false);
  const readSentRef = useRef<Record<string, number>>({});
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current = activeId;
    setActiveConversation(activeId);
    return () => setActiveConversation(null);
  }, [activeId]);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  useEffect(() => {
    convsRef.current = convs;
  }, [convs]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadList = useCallback(() => {
    messengerApi.conversations().then(setConvs).catch((e) => setError(errMsg(e)));
  }, []);
  const scheduleList = useCallback(
    (delay = 250) => {
      if (listTimer.current) clearTimeout(listTimer.current);
      listTimer.current = setTimeout(loadList, delay);
    },
    [loadList],
  );

  // ── صف ارسال (آفلاین‌پذیر) ──
  const commitOutbox = useCallback((next: OutboxItem[]) => {
    outboxRef.current = next;
    setOutbox(next);
    if (meRef.current) persistOutbox(meRef.current.userId, next);
  }, []);

  const acceptServerMessage = useCallback((msg: MessengerMessage) => {
    if (msg.conversationId === activeRef.current) setMessages((ms) => mergeServer(ms, [msg]));
    setConvs((cs) => (cs ? sortConvs(cs.map((c) => (c.id === msg.conversationId && msg.seq >= (c.lastMessage?.seq ?? 0) ? { ...c, lastMessage: msg, lastMessageAt: msg.createdAt, lastMessageStatus: "sent" as const } : c))) : cs));
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const item of outboxRef.current.filter((i) => i.status === "pending")) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        try {
          const msg = await messengerApi.send(item.conversationId, { text: item.text, replyToId: item.replyToId, mediaId: item.mediaId, clientId: item.clientId });
          commitOutbox(outboxRef.current.filter((i) => i.clientId !== item.clientId));
          acceptServerMessage(msg);
        } catch (e) {
          if (e instanceof MessengerNetworkError) break; // قطعی: در صف می‌ماند و بعداً دوباره
          if (e instanceof ApiError && e.status === 401) break;
          commitOutbox(outboxRef.current.map((i) => (i.clientId === item.clientId ? { ...i, status: "failed", error: errMsg(e) } : i)));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [acceptServerMessage, commitOutbox]);

  const markRead = useCallback((convId: string, seq: number) => {
    if (document.visibilityState !== "visible" || seq <= 0) return;
    if ((readSentRef.current[convId] ?? 0) >= seq) return;
    readSentRef.current[convId] = seq;
    messengerApi
      .read(convId, seq)
      .then(() => {
        refreshMessengerUnread();
        setConvs((cs) => cs?.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)) ?? cs);
      })
      .catch(() => {
        readSentRef.current[convId] = 0;
      });
  }, []);

  const readLatest = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    const server = messagesRef.current;
    const last = server[server.length - 1];
    if (last) markRead(id, last.seq);
  }, [markRead]);

  const openConversation = useCallback(
    async (id: string, opts?: { focus?: boolean }) => {
      setActiveId(id);
      activeRef.current = id;
      setDetail(null);
      setMessages([]);
      setReplyTo(null);
      setEditing(null);
      setSearchOpen(false);
      setChatResults([]);
      setDivider(null);
      setBelow(0);
      setAtBottom(true);
      setLoadingChat(true);
      stickRef.current = true;
      toDividerRef.current = false;
      try {
        window.history.replaceState(null, "", `/messenger?c=${id}`);
      } catch {
        /* بی‌اهمیت */
      }
      try {
        const [d, page] = await Promise.all([messengerApi.conversation(id), messengerApi.messages(id)]);
        if (activeRef.current !== id) return;
        const myId = meRef.current?.userId;
        const unread = page.messages.filter((m) => m.senderId !== myId && m.seq > d.lastReadSeq && m.kind !== "SYSTEM" && !m.deleted);
        if (unread.length > 0) {
          setDivider({ seq: unread[0].seq, count: unread.length });
          setBelow(unread.length);
          stickRef.current = false;
          toDividerRef.current = true;
          setAtBottom(false);
        }
        setDetail(d);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        hasMoreRef.current = page.hasMore;
        messagesRef.current = page.messages;
        markRead(id, d.lastSeq);
        if (opts?.focus) setFocusSignal((n) => n + 1);
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
    setDivider(null);
    try {
      window.history.replaceState(null, "", "/messenger");
    } catch {
      /* بی‌اهمیت */
    }
  }, []);

  // باز شدن گفتگو از بیرون (اعلان بالای صفحه / کلیک اعلان پوش)
  useEffect(() => {
    registerChatOpener((id, focus) => void openConversation(id, { focus }));
    return () => registerChatOpener(null);
  }, [openConversation]);

  // بارگذاری اولیه + باز کردن ?c=
  useEffect(() => {
    (async () => {
      try {
        const [m] = await Promise.all([messengerApi.me(), messengerApi.conversations().then(setConvs)]);
        meRef.current = m;
        setMe(m);
        setDrafts(loadAllDrafts(m.userId));
        const saved = loadOutbox(m.userId);
        if (saved.length) {
          commitOutbox(saved.map((i) => (i.status === "failed" ? i : { ...i, status: "pending" as const })));
          void flush();
        }
        const sp = new URLSearchParams(window.location.search);
        const c = sp.get("c");
        const peer = sp.get("with"); // لینک داشبورد عملیات: گفتگوی مستقیم با یک همکار
        if (c) void openConversation(c, { focus: sp.get("focus") === "1" });
        else if (peer && /^[0-9a-fA-F-]{36}$/.test(peer)) {
          const d = await messengerApi.openDirect(peer);
          void openConversation(d.id);
        }
      } catch (e) {
        setError(errMsg(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // همگام‌سازی گفتگوی باز پس از قطعی/بازگشت تب: پیام‌های ازدست‌رفته از آخرین seq معلوم
  const syncActive = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const known = messagesRef.current;
      const lastKnown = known.length ? known[known.length - 1].seq : 0;
      const [d, page] = await Promise.all([messengerApi.conversation(id), messengerApi.messages(id)]);
      if (activeRef.current !== id) return;
      setDetail(d);
      let incoming: MessengerMessage[] = page.messages;
      if (lastKnown > 0 && page.messages.length > 0 && page.messages[0].seq > lastKnown + 1) {
        const gap = await messengerApi.messagesAfter(id, lastKnown);
        if (activeRef.current !== id) return;
        if (gap.hasMore) {
          setMessages(page.messages);
          setHasMore(page.hasMore);
          incoming = [];
        } else incoming = [...gap.messages, ...page.messages];
      }
      if (incoming.length) setMessages((ms) => mergeServer(ms, incoming));
      const myId = meRef.current?.userId;
      const fresh = incoming.filter((m) => m.seq > lastKnown && m.senderId !== myId && m.kind !== "SYSTEM").length;
      if (stickRef.current) markRead(id, d.lastSeq);
      else if (fresh) setBelow((b) => b + fresh);
    } catch {
      /* تلاش بعدی با رویداد بعدی */
    }
  }, [markRead]);

  useEffect(() => {
    return onMessengerResync(() => {
      loadList();
      void syncActive();
      void flush();
    });
  }, [loadList, syncActive, flush]);

  // تلاش دوباره‌ی صف: بازگشت شبکه + تایمر ملایم
  useEffect(() => {
    const onOnline = () => {
      setConnected(true);
      void flush();
    };
    const onOffline = () => setConnected(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(() => {
      if (outboxRef.current.some((i) => i.status === "pending")) void flush();
    }, 12_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
  }, [flush]);

  // رویدادهای زنده
  useEffect(() => {
    const s = getMessengerSocket();
    if (!s) return;
    const onNew = ({ message }: { message: MessengerMessage }) => {
      const myId = meRef.current?.userId;
      const mine = message.senderId === myId;
      if (message.clientId && outboxRef.current.some((i) => i.clientId === message.clientId)) {
        commitOutbox(outboxRef.current.filter((i) => i.clientId !== message.clientId));
      }
      const isActive = message.conversationId === activeRef.current;
      if (isActive) {
        setMessages((ms) => mergeServer(ms, [message]));
        setDetail((d) => (d && d.id === message.conversationId ? { ...d, lastSeq: Math.max(d.lastSeq, message.seq) } : d));
        if (mine) stickRef.current = true;
        else if (message.kind !== "SYSTEM") {
          if (stickRef.current) markRead(message.conversationId, message.seq);
          else setBelow((b) => b + 1);
        }
      }
      // فهرست: به‌روزرسانی فوری (آخرین پیام/نخوانده/ترتیب) و سپس تأیید از سرور
      setConvs((cs) => {
        if (!cs) return cs;
        const c = cs.find((x) => x.id === message.conversationId);
        if (!c) return cs;
        const viewing = isActive && document.visibilityState === "visible";
        const updated: ConversationSummary = {
          ...c,
          lastMessage: message,
          lastMessageAt: message.createdAt,
          lastMessageStatus: mine ? "sent" : null,
          lastSeq: message.seq,
          unread: mine || viewing || message.kind === "SYSTEM" ? c.unread : c.unread + 1,
        };
        return sortConvs([updated, ...cs.filter((x) => x.id !== c.id)]);
      });
      scheduleList(500);
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
      const c = convsRef.current?.find((x) => x.id === r.conversationId);
      if (c && c.lastMessageStatus && c.lastMessageStatus !== "seen" && r.userId !== meRef.current?.userId) scheduleList(700);
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
      if (document.visibilityState === "visible" && activeRef.current && stickRef.current) readLatest();
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on("message:new", onNew);
    s.on("message:updated", onUpdated);
    s.on("message:hidden", onHidden);
    s.on("reaction:updated", onReaction);
    s.on("conversation:updated", onConv);
    s.on("receipt", onReceipt);
    s.on("typing", onTyping);
    s.on("presence", onPresence);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
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
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [markRead, readLatest, scheduleList, closeConversation, commitOutbox]);

  const list: ChatMessage[] = useMemo(() => {
    if (!me || !activeId) return messages;
    return [...messages, ...outbox.filter((o) => o.conversationId === activeId).map((o) => toLocal(o, me))];
  }, [messages, outbox, me, activeId]);

  // اسکرول: ته لیست برای پیام جدید/باز شدن، حفظ موقعیت هنگام بارگذاری قدیمی‌ترها، پرش به «خوانده‌نشده»
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependRef.current;
      prependRef.current = null;
    } else if (toDividerRef.current) {
      const dv = document.getElementById("unread-divider");
      if (dv) {
        toDividerRef.current = false;
        dv.scrollIntoView({ block: "start" });
      }
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
  }, [list, detail]);

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const id = activeRef.current;
    const first = messagesRef.current[0];
    if (!id || !first || loadingOlderRef.current) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = scrollRef.current;
    if (el) prependRef.current = el.scrollHeight - el.scrollTop;
    stickRef.current = false;
    try {
      const page = await messengerApi.messages(id, first.seq);
      if (activeRef.current !== id) return false;
      setMessages((ms) => mergeServer(ms, page.messages));
      setHasMore(page.hasMore);
      hasMoreRef.current = page.hasMore;
      return page.hasMore;
    } catch {
      prependRef.current = null;
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, []);

  async function jumpTo(messageId: string) {
    for (let i = 0; i < 12; i++) {
      const target = document.getElementById(`msg-${messageId}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 2200);
        return;
      }
      if (!hasMoreRef.current && i > 0) break;
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

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setBelow(0);
    readLatest();
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
    const item: OutboxItem = {
      clientId: newClientId(),
      conversationId: activeId,
      text: p.text,
      replyToId: p.replyToId,
      mediaId: p.mediaId,
      media: p.media,
      replyPreview: replyTo && p.replyToId === replyTo.id ? { id: replyTo.id, senderName: replyTo.senderName, text: (replyTo.text ?? "").slice(0, 80), hasMedia: !!replyTo.media, deleted: false } : null,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    commitOutbox([...outboxRef.current, item]);
    setReplyTo(null);
    void flush();
  }

  async function submitEdit(m: ChatMessage, text: string) {
    const updated = await messengerApi.edit(m.id, text);
    setMessages((ms) => ms.map((x) => (x.id === updated.id ? updated : x)));
    setEditing(null);
  }

  const handleDraft = useCallback(
    (text: string) => {
      const id = activeRef.current;
      const uid = meRef.current?.userId;
      if (!id || !uid) return;
      saveDraft(uid, id, text);
      setDrafts((d) => {
        if ((d[id] ?? "") === text) return d;
        const next = { ...d };
        if (text.trim()) next[id] = text;
        else delete next[id];
        return next;
      });
    },
    [],
  );

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
    onRetry: (m) => {
      commitOutbox(outboxRef.current.map((i) => (i.clientId === m.clientId ? { ...i, status: "pending", error: undefined } : i)));
      void flush();
    },
    onDiscard: (m) => commitOutbox(outboxRef.current.filter((i) => i.clientId !== m.clientId)),
  };

  async function toggleMute() {
    if (!detail) return;
    try {
      const r = await messengerApi.mute(detail.id, !detail.muted);
      setDetail({ ...detail, muted: r.muted });
      scheduleList();
    } catch (e) { flash(errMsg(e)); }
  }

  async function chatAction(c: ConversationSummary, what: "pin" | "mute" | "archive") {
    setRowMenu(null);
    try {
      if (what === "pin") await messengerApi.pinChat(c.id, !c.pinnedAt);
      else if (what === "archive") await messengerApi.archiveChat(c.id, !c.archived);
      else await messengerApi.mute(c.id, !c.muted);
      if (what === "mute" && c.id === activeId) setDetail((d) => (d ? { ...d, muted: !c.muted } : d));
      if (what === "archive" && !c.archived && c.id === activeId) closeConversation();
      loadList();
      refreshMessengerUnread();
    } catch (e) { flash(errMsg(e)); }
  }

  const shownGlobal = listQuery.trim().length >= 2 ? globalResults : [];
  const shownChat = searchOpen && chatQuery.trim().length >= 2 ? chatResults : [];
  const q = listQuery.trim();
  const archivedCount = (convs ?? []).filter((c) => c.archived).length;
  const filteredConvs = (convs ?? []).filter((c) => (q ? c.title.includes(q) : !!c.archived === showArchived));
  const typingIn = (convId: string) => Object.values(typing[convId] ?? {}).some((until) => until > clock);
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
  const queued = outbox.filter((o) => o.status === "pending").length;

  return (
    <div className="h-full min-h-[480px] flex bg-surface md:border md:border-border md:rounded-2xl md:m-4 md:h-[calc(100%-2rem)] overflow-hidden relative">
      {/* ── فهرست گفتگوها ── */}
      <aside className={clsx("flex-col w-full md:w-[340px] md:border-e border-border shrink-0", activeId ? "hidden md:flex" : "flex")}>
        <div className="px-3.5 pt-3.5 pb-2 border-b border-border">
          <div className="flex items-center justify-between mb-2.5">
            <h1 className="text-[16px] font-extrabold">{showArchived && !q ? "بایگانی" : "پیام‌رسان داخلی"}</h1>
            <div className="flex items-center gap-1">
              {showArchived && !q ? <button type="button" onClick={() => setShowArchived(false)} className="px-2.5 h-8 rounded-lg hover:bg-slate-50 text-[12px] font-bold text-primary cursor-pointer">بازگشت</button> : null}
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
          {!showArchived && !q && archivedCount > 0 ? (
            <button type="button" onClick={() => setShowArchived(true)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-start border-b border-border/60 hover:bg-slate-50 cursor-pointer text-[13px] font-bold text-muted">
              <span className="w-10 text-center text-lg" aria-hidden>🗂</span>
              بایگانی
              <span className="ms-auto text-[11.5px] font-normal">{toPersianDigits(archivedCount)}</span>
            </button>
          ) : null}
          {filteredConvs.map((c) => {
            const isTyping = typingIn(c.id) && c.id !== activeId;
            const draft = c.id !== activeId ? drafts[c.id] : undefined;
            const lastMine = !!c.lastMessage && c.lastMessage.senderId === me?.userId && c.lastMessage.kind !== "SYSTEM";
            return (
              <div key={c.id} className="relative" onContextMenu={(e) => { e.preventDefault(); setRowMenu(c.id); }}>
                <button type="button" onClick={() => void openConversation(c.id)} className={clsx("w-full flex items-center gap-3 px-3.5 py-3 text-start border-b border-border/60 cursor-pointer hover:bg-slate-50", activeId === c.id && "bg-primary-soft")}>
                  <div className="relative">
                    <Avatar name={c.title} tone={c.type === "SAVED" ? "saved" : "primary"} />
                    {c.peerOnline ? <span className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[14px] font-bold truncate">{c.type === "GROUP" ? "👥 " : ""}{c.title}</div>
                      <div className="flex items-center gap-1 text-[10.5px] text-muted shrink-0">
                        {lastMine && c.lastMessageStatus ? <TicksMark ticks={c.lastMessageStatus} onDark={false} /> : null}
                        {c.lastMessage ? clockFa(c.lastMessage.createdAt) : ""}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className={clsx("text-[12.5px] truncate", isTyping ? "text-primary font-bold" : "text-muted")} dir="auto">
                        {isTyping ? (
                          "در حال نوشتن…"
                        ) : draft ? (
                          <><span className="text-danger font-bold">پیش‌نویس: </span>{draft}</>
                        ) : (
                          <>
                            {c.lastMessage && c.lastMessage.kind !== "SYSTEM" && (c.type === "GROUP" || (lastMine && c.type !== "DIRECT")) ? `${lastMine ? "شما" : c.lastMessage.senderName}: ` : lastMine && c.type === "DIRECT" ? "شما: " : ""}
                            {previewOf(c.lastMessage) || (c.type === "SAVED" ? "پیام‌ها را اینجا ذخیره کنید" : "")}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.pinnedAt ? <span className="text-[11px]" title="سنجاق‌شده">📌</span> : null}
                        {c.muted ? <span className="text-[11px]" title="بی‌صدا">🔕</span> : null}
                        {c.unread > 0 ? <span className={clsx("min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center", c.muted ? "bg-muted" : "bg-primary")}>{toPersianDigits(c.unread)}</span> : null}
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === c.id ? null : c.id); }}
                  className="absolute top-1.5 start-1 w-6 h-6 rounded-full text-muted text-[13px] hover:bg-slate-100 cursor-pointer opacity-60 hover:opacity-100"
                  aria-label="گزینه‌های گفتگو"
                >
                  ⋯
                </button>
                {rowMenu === c.id ? (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setRowMenu(null)} />
                    <div className="absolute z-40 top-8 start-3 w-44 bg-surface border border-border rounded-xl shadow-xl p-1 text-[13px]">
                      {c.type !== "SAVED" ? <RowItem onClick={() => void chatAction(c, "pin")}>📌 {c.pinnedAt ? "برداشتن سنجاق" : "سنجاق گفتگو"}</RowItem> : null}
                      {c.type !== "SAVED" ? <RowItem onClick={() => void chatAction(c, "mute")}>{c.muted ? "🔔 فعال‌سازی اعلان" : "🔕 بی‌صدا کردن"}</RowItem> : null}
                      <RowItem onClick={() => void chatAction(c, "archive")}>🗂 {c.archived ? "خروج از بایگانی" : "بایگانی"}</RowItem>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
          {convs && filteredConvs.length === 0 && !shownGlobal.length ? <div className="p-6 text-center text-[12.5px] text-muted">{q ? "گفتگویی یافت نشد." : showArchived ? "بایگانی خالی است." : "هنوز گفتگویی ندارید؛ با «＋» شروع کنید."}</div> : null}
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

            {!connected || queued > 0 ? (
              <div className="bg-warning-soft text-warning text-[12px] font-semibold px-3.5 py-1.5 border-b border-border" role="status">
                {!connected ? "اتصال برقرار نیست؛ در حال تلاش برای اتصال دوباره…" : "در حال ارسال…"}
                {queued > 0 ? ` (${toPersianDigits(queued)} پیام در صف ارسال)` : ""}
              </div>
            ) : null}

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

            <div className="flex-1 min-h-0 relative">
              <div
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                  stickRef.current = near;
                  setAtBottom((v) => (v === near ? v : near));
                  if (near) {
                    setBelow((b) => (b ? 0 : b));
                    readLatest();
                  }
                  if (el.scrollTop < 240 && hasMoreRef.current && !loadingOlderRef.current && !prependRef.current) void loadOlder();
                }}
                className="h-full overflow-y-auto px-3 py-3"
              >
                {loadingOlder ? <div className="text-center text-[12px] text-muted mb-3">در حال بارگذاری پیام‌های قدیمی‌تر…</div> : null}
                {hasMore && !loadingOlder ? (
                  <div className="text-center mb-3">
                    <button type="button" onClick={() => void loadOlder()} className="text-[12px] font-bold text-primary bg-primary-soft rounded-full px-4 py-1.5 cursor-pointer">پیام‌های قدیمی‌تر</button>
                  </div>
                ) : null}
                {loadingChat ? <div className="text-center text-sm text-muted py-8">در حال بارگذاری…</div> : null}
                {list.map((m, i) => {
                  const prev = list[i - 1];
                  const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                  const mine = m.senderId === me.userId;
                  return (
                    <div key={m.id}>
                      {newDay ? <div className="flex justify-center my-3"><span className="text-[11.5px] text-muted bg-surface border border-border rounded-full px-3 py-0.5">{dayLabel(m.createdAt)}</span></div> : null}
                      {divider && divider.seq === m.seq && !m.local ? (
                        <div id="unread-divider" className="flex items-center gap-3 my-3 text-[12px] font-bold text-primary">
                          <span className="flex-1 h-px bg-primary/30" />
                          {divider.count >= 40 ? "پیام‌های خوانده‌نشده" : `${toPersianDigits(divider.count)} پیام خوانده‌نشده`}
                          <span className="flex-1 h-px bg-primary/30" />
                        </div>
                      ) : null}
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
                {!loadingChat && list.length === 0 ? <div className="text-center text-sm text-muted py-10">هنوز پیامی نیست؛ اولین پیام را بفرستید.</div> : null}
              </div>
              {!atBottom ? (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="absolute bottom-3 end-3 w-11 h-11 rounded-full bg-surface border border-border shadow-lg text-lg text-primary cursor-pointer flex items-center justify-center"
                  aria-label={below > 0 ? `${below} پیام جدید؛ رفتن به آخرین پیام` : "رفتن به آخرین پیام"}
                >
                  ↓
                  {below > 0 ? <span className="absolute -top-2 -start-1 min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">{toPersianDigits(below)}</span> : null}
                </button>
              ) : null}
            </div>

            <Composer
              key={`${activeId}-${editing?.id ?? ""}`}
              conversationId={activeId}
              replyTo={replyTo}
              editing={editing}
              initialDraft={editing ? undefined : loadDraft(me.userId, activeId)}
              onDraft={handleDraft}
              focusSignal={focusSignal}
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

function RowItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
      {children}
    </button>
  );
}
