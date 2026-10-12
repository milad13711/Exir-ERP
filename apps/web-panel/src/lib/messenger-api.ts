import { API_URL, ApiError, apiFetch, getToken } from "./api";
import { io, type Socket } from "socket.io-client";

export type MessengerSettings = {
  policy: "OPEN" | "MANAGERS_AND_SHARED_ROLE" | "MANAGERS_INITIATE";
  groupCreation: "EVERYONE" | "MANAGERS";
  hidePreview: boolean;
  retentionDays: number | null;
  showPresence: boolean;
};

export type MessengerMedia = { id: string; kind: "IMAGE" | "FILE" | "VIDEO"; mime: string; fileName: string; size: number; expiresAt: string; expired: boolean; hoursLeft: number };

export type MessengerMessage = {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  senderName: string;
  kind: "TEXT" | "MEDIA" | "SYSTEM";
  text: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: { id: string; senderName: string; text: string; hasMedia: boolean; deleted: boolean } | null;
  forwardedFrom: string | null;
  media: MessengerMedia | null;
  reactions: { emoji: string; userIds: string[] }[];
  mentionIds: string[];
  clientId?: string | null;
};

/** پیام در وضعیت محلی (هنوز تأیید سرور نشده / ناموفق). */
export type LocalMessageState = "pending" | "failed";
export type ChatMessage = MessengerMessage & { local?: LocalMessageState; localError?: string };

export type ConversationSummary = {
  id: string;
  type: "DIRECT" | "GROUP" | "SAVED";
  title: string;
  peerId: string | null;
  peerOnline: boolean;
  muted: boolean;
  unread: number;
  memberCount: number;
  lastMessage: MessengerMessage | null;
  lastMessageAt: string;
  lastMessageStatus?: "sent" | "delivered" | "seen" | null;
  lastSeq?: number;
  pinnedAt?: string | null;
  archived?: boolean;
};

export type ConversationMember = { userId: string; name: string; role: "OWNER" | "ADMIN" | "MEMBER"; lastReadSeq: number; lastDeliveredSeq: number; online: boolean; lastSeenAt: string | null };

export type ConversationDetail = {
  id: string;
  type: "DIRECT" | "GROUP" | "SAVED";
  title: string;
  peerId: string | null;
  myRole: "OWNER" | "ADMIN" | "MEMBER";
  muted: boolean;
  lastReadSeq: number;
  lastSeq: number;
  members: ConversationMember[];
  pinned: MessengerMessage[];
};

export type MessengerContact = { id: string; name: string; roleTitle: string | null; isManager: boolean; canMessage: boolean; online: boolean; lastSeenAt: string | null };

export type SendBody = { text?: string; replyToId?: string; mediaId?: string; mentionIds?: string[]; clientId?: string };

/** خطای شبکه (نه پاسخ HTTP) — پیام در صف آفلاین می‌ماند و بعداً دوباره ارسال می‌شود. */
export class MessengerNetworkError extends Error {}

/**
 * ارسال پیام بدون صف آفلاین عمومی برنامه (apiFetch در حالت آفلاین درخواست را ساعت‌ها بعد بازپخش می‌کند)؛
 * صف اختصاصی پیام‌رسان با clientId ارسال idempotent دارد.
 */
async function sendMessengerMessage(conversationId: string, data: SendBody): Promise<MessengerMessage> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${M}/conversations/${conversationId}/messages`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(data),
    });
  } catch {
    throw new MessengerNetworkError("اتصال برقرار نیست");
  }
  if (!res.ok) {
    let message = "ارسال ناموفق بود";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* بدون بدنه */
    }
    // خطاهای گذرای سرور/پراکسی هم مثل قطعی شبکه صف می‌شوند
    if (res.status >= 502 && res.status <= 504) throw new MessengerNetworkError(message);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

const j = (body: unknown) => JSON.stringify(body);
const M = "/messenger";

export const messengerApi = {
  me: () => apiFetch<{ userId: string; isManager: boolean }>(`${M}/me`),
  settings: () => apiFetch<MessengerSettings>(`${M}/settings`),
  updateSettings: (data: Partial<MessengerSettings>) => apiFetch<MessengerSettings>(`${M}/settings`, { method: "PUT", body: j(data) }),
  presence: () => apiFetch<{ hidden: boolean }>(`${M}/presence`),
  setPresenceHidden: (hidden: boolean) => apiFetch<{ hidden: boolean }>(`${M}/presence`, { method: "PUT", body: j({ hidden }) }),
  contacts: () => apiFetch<MessengerContact[]>(`${M}/contacts`),
  unread: () => apiFetch<{ total: number }>(`${M}/unread`),
  conversations: () => apiFetch<ConversationSummary[]>(`${M}/conversations`),
  conversation: (id: string) => apiFetch<ConversationDetail>(`${M}/conversations/${id}`),
  openDirect: (userId: string) => apiFetch<ConversationDetail>(`${M}/conversations/direct`, { method: "POST", body: j({ userId }) }),
  openSaved: () => apiFetch<ConversationDetail>(`${M}/conversations/saved`, { method: "POST" }),
  createGroup: (title: string, memberIds: string[]) => apiFetch<ConversationDetail>(`${M}/conversations/group`, { method: "POST", body: j({ title, memberIds }) }),
  renameGroup: (id: string, title: string) => apiFetch<ConversationDetail>(`${M}/conversations/${id}`, { method: "PATCH", body: j({ title }) }),
  mute: (id: string, muted: boolean) => apiFetch<{ muted: boolean }>(`${M}/conversations/${id}/mute`, { method: "PATCH", body: j({ muted }) }),
  addMembers: (id: string, userIds: string[]) => apiFetch<ConversationDetail>(`${M}/conversations/${id}/members`, { method: "POST", body: j({ userIds }) }),
  removeMember: (id: string, userId: string) => apiFetch<ConversationDetail>(`${M}/conversations/${id}/members/${userId}`, { method: "DELETE" }),
  setRole: (id: string, userId: string, role: "ADMIN" | "MEMBER") => apiFetch<ConversationDetail>(`${M}/conversations/${id}/members/${userId}/role`, { method: "PATCH", body: j({ role }) }),
  leave: (id: string) => apiFetch<{ left: boolean }>(`${M}/conversations/${id}/leave`, { method: "POST" }),
  read: (id: string, seq: number) => apiFetch<{ lastReadSeq: number }>(`${M}/conversations/${id}/read`, { method: "POST", body: j({ seq }) }),
  pin: (id: string, messageId: string, pinned: boolean) => apiFetch<ConversationDetail>(`${M}/conversations/${id}/pins/${messageId}`, { method: pinned ? "POST" : "DELETE" }),
  messagesAfter: (id: string, after: number) => apiFetch<{ messages: MessengerMessage[]; hasMore: boolean }>(`${M}/conversations/${id}/messages?limit=100&after=${after}`),
  pinChat: (id: string, pinned: boolean) => apiFetch<{ pinned: boolean }>(`${M}/conversations/${id}/pin`, { method: "PATCH", body: j({ pinned }) }),
  archiveChat: (id: string, archived: boolean) => apiFetch<{ archived: boolean }>(`${M}/conversations/${id}/archive`, { method: "PATCH", body: j({ archived }) }),
  messages: (id: string, before?: number) => apiFetch<{ messages: MessengerMessage[]; hasMore: boolean }>(`${M}/conversations/${id}/messages?limit=40${before ? `&before=${before}` : ""}`),
  send: (id: string, data: SendBody) => sendMessengerMessage(id, data),
  edit: (messageId: string, text: string) => apiFetch<MessengerMessage>(`${M}/messages/${messageId}`, { method: "PATCH", body: j({ text }) }),
  remove: (messageId: string, scope: "me" | "all") => apiFetch<{ deleted: string }>(`${M}/messages/${messageId}?scope=${scope}`, { method: "DELETE" }),
  react: (messageId: string, emoji: string) => apiFetch<{ reactions: { emoji: string; userIds: string[] }[] }>(`${M}/messages/${messageId}/reactions`, { method: "POST", body: j({ emoji }) }),
  forward: (messageId: string, conversationIds: string[]) => apiFetch<{ forwarded: number }>(`${M}/messages/${messageId}/forward`, { method: "POST", body: j({ conversationIds }) }),
  save: (messageId: string) => apiFetch<{ conversationId: string }>(`${M}/messages/${messageId}/save`, { method: "POST" }),
  search: (q: string, conversationId?: string) => apiFetch<(MessengerMessage & { conversationTitle: string })[]>(`${M}/search?q=${encodeURIComponent(q)}${conversationId ? `&conversationId=${conversationId}` : ""}`),
};

/** بارگذاری فایل با بدنه‌ی خام (بدون base64)؛ نام فایل در هدر URL-encoded. */
export async function uploadMessengerMedia(conversationId: string, file: File): Promise<{ id: string; kind: string; fileName: string; size: number; expiresAt: string; hoursLeft: number }> {
  const token = getToken();
  const res = await fetch(`${API_URL}${M}/conversations/${conversationId}/media`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  if (!res.ok) {
    let message = "ارسال فایل ناموفق بود";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* بدون بدنه */
    }
    throw new ApiError(message, res.status);
  }
  return res.json();
}

/** دریافت فایل با توکن (به‌صورت Blob) — برای پیش‌نمایش و دانلود. */
export async function fetchMessengerMediaBlob(mediaId: string, inline = false): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}${M}/media/${mediaId}/download${inline ? "?inline=1" : ""}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = "دریافت فایل ناموفق بود";
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* بدون بدنه */
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}

// ── Socket ──────────────────────────────────────────────────────────────
// یک سوکت `/messenger` برای هر تب؛ مالک چرخه‌ی عمر آن messenger-runtime است (AppShell).

const SOCKET_ORIGIN = API_URL.replace(/\/api\/?$/, "");
let socket: Socket | null = null;
let socketToken: string | null = null;

export function getMessengerSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = io(`${SOCKET_ORIGIN}/messenger`, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  });
  socketToken = token;
  socket.on("connect", () => socket?.emit("visibility", { visible: typeof document === "undefined" || document.visibilityState === "visible" }));
  return socket;
}

export function closeMessengerSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

export function emitMessengerVisibility() {
  if (socket?.connected) socket.emit("visibility", { visible: document.visibilityState === "visible" });
}
