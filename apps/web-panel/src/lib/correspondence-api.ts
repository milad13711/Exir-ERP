import { API_URL, ApiError, apiFetch, getToken } from "./api";

export type LetterType = "INCOMING" | "OUTGOING" | "INTERNAL";
export const TYPE_LABELS: Record<LetterType, string> = { INCOMING: "وارده", OUTGOING: "صادره", INTERNAL: "داخلی" };

export type LetterStatus =
  | "DRAFT" | "PENDING_REVIEW" | "PENDING_SIGNATURE" | "RETURNED_FOR_EDIT" | "REJECTED" | "ISSUED" | "SENT" | "DELIVERED"
  | "REGISTERED" | "REFERRED" | "IN_PROGRESS" | "ANSWERED" | "CLOSED" | "VOID";
export const STATUS_LABELS: Record<LetterStatus, string> = {
  DRAFT: "پیش‌نویس", PENDING_REVIEW: "در انتظار بازبینی", PENDING_SIGNATURE: "در انتظار امضا", RETURNED_FOR_EDIT: "برگشت برای اصلاح",
  REJECTED: "ردشده", ISSUED: "صادرشده", SENT: "ارسال‌شده", DELIVERED: "تحویل‌شده", REGISTERED: "ثبت‌شده", REFERRED: "ارجاع‌شده",
  IN_PROGRESS: "در دست اقدام", ANSWERED: "پاسخ داده شد", CLOSED: "مختومه", VOID: "باطل",
};
export type Tone = "primary" | "success" | "warning" | "neutral" | "danger" | "accent";
export const STATUS_TONES: Record<LetterStatus, Tone> = {
  DRAFT: "neutral", PENDING_REVIEW: "warning", PENDING_SIGNATURE: "warning", RETURNED_FOR_EDIT: "danger", REJECTED: "danger", ISSUED: "success",
  SENT: "primary", DELIVERED: "success", REGISTERED: "primary", REFERRED: "accent", IN_PROGRESS: "accent", ANSWERED: "success", CLOSED: "neutral", VOID: "danger",
};
export type Priority = "NORMAL" | "URGENT" | "IMMEDIATE";
export const PRIORITY_LABELS: Record<Priority, string> = { NORMAL: "عادی", URGENT: "فوری", IMMEDIATE: "آنی" };
export type Confidentiality = "NORMAL" | "CONFIDENTIAL" | "VERY_CONFIDENTIAL" | "SECRET";
export const CONF_LABELS: Record<Confidentiality, string> = { NORMAL: "عادی", CONFIDENTIAL: "محرمانه", VERY_CONFIDENTIAL: "خیلی محرمانه", SECRET: "سری" };
export const DELIVERY_LABELS: Record<string, string> = { POST: "پست", COURIER: "پیک", EMAIL: "ایمیل", HAND: "دستی", SYSTEM: "سامانه" };
export const EVENT_LABELS: Record<string, string> = {
  CREATED: "ایجاد نامه", EDITED: "ویرایش", SUBMITTED: "ارجاع برای امضا", REVIEWED: "بازبینی", RETURNED: "برگشت برای اصلاح", REJECTED: "رد شد",
  SIGNED: "امضا شد", ISSUED: "شماره خورد و صادر شد", SENT: "ارسال شد", DELIVERED: "تحویل شد", RECEIPT_RECEIVED: "رسید تحویل دریافت شد",
  REGISTERED: "ثبت در دبیرخانه", REFERRED: "ارجاع", REFERRAL_SEEN: "ارجاع دیده شد", REFERRAL_DONE: "ارجاع انجام شد",
  REFERRAL_RETURNED: "ارجاع برگشت خورد", REFERRAL_FORWARDED: "ارجاع به فرد دیگر", REFERRAL_CANCELLED: "ارجاع لغو شد", PARAPHED: "پاراف",
  REPLIED: "ایجاد پاسخ", ANSWERED: "پاسخ داده شد", CLOSED: "مختومه شد", VOIDED: "باطل شد", ARCHIVED: "بایگانی شد", UNARCHIVED: "از بایگانی خارج شد",
  REOPENED: "بازگشایی شد", EXTERNAL_FOLLOWUP: "پیگیری بیرونی", CORRECTION_CREATED: "ایجاد اصلاحیه", REMINDER: "یادآوری", EVIDENCE_PENDING: "مدرک امضا ثبت نشد", VOID_REQUESTED: "درخواست ابطال", ATTACHMENT_ADDED: "افزودن پیوست", ATTACHMENT_REMOVED: "حذف پیوست",
};

export type Recipient = { name: string; title?: string; org?: string; contactId?: string; userId?: string };

export type LetterListItem = {
  id: string; type: LetterType; status: LetterStatus; subject: string; letterNumber: string | null; letterDate: string | null;
  externalNumber: string | null; externalDate: string | null; receivedAt: string | null; senderName: string | null; senderOrgName: string | null;
  recipientsText: string; priority: Priority; confidentiality: Confidentiality; responseDueAt: string | null; answeredAt: string | null;
  createdByName: string | null; createdAt: string; updatedAt: string; archivedAt: string | null; pageCount: number | null; voidedAt: string | null;
  category: { id: string; name: string } | null;
  referral?: { id: string; dueAt: string | null; instruction: string; fromName: string | null; status: string; kind?: string };
};

export type LetterFlags = {
  canEdit: boolean; canSubmit: boolean; canSign: boolean; canReturn: boolean; canReject: boolean; canReview: boolean; canRefer: boolean; canParaph: boolean;
  canSend: boolean; canDeliver: boolean; canReply: boolean; canCorrect: boolean; canVoid: boolean; canClose: boolean; canReopen: boolean;
  canArchive: boolean; canUnarchive: boolean; canFollowup: boolean; canViewEvidence: boolean;
};
export type Referral = {
  id: string; letterId: string; fromUserId: string; fromName: string | null; toUserId: string; toName: string | null; kind: "ACTION" | "INFO";
  instruction: string; dueAt: string | null; status: "PENDING" | "SEEN" | "DONE" | "RETURNED" | "CANCELLED"; seenAt: string | null; completedAt: string | null;
  response: string | null; parentReferralId: string | null; seq: number; createdAt: string;
};
export type Paraph = { id: string; authorName: string; authorTitle: string | null; text: string; order: number; createdAt: string };
export type LetterEvent = { id: string; type: string; actorName: string | null; note: string | null; meta: Record<string, unknown> | null; createdAt: string };
export type LetterBrief = { id: string; type?: LetterType; subject: string; letterNumber: string | null; status: LetterStatus };

export type LetterDetail = {
  id: string; type: LetterType; status: LetterStatus; subject: string; bodyHtml: string; letterNumber: string | null; letterDate: string | null; issuedAt: string | null;
  externalNumber: string | null; externalDate: string | null; receivedAt: string | null; deliveryMethod: string | null; senderOrgName: string | null; senderName: string | null;
  senderContactId: string | null; pageCount: number | null; attachmentsText: string | null; registeredAt: string | null; registeredByName: string | null;
  recipients: Recipient[]; ccNames: string[]; categoryId: string | null; category: { id: string; name: string; code: string } | null;
  priority: Priority; confidentiality: Confidentiality; responseDueAt: string | null; answeredAt: string | null; replyToLetterId: string | null;
  relatedContactId: string | null; letterheadId: string | null; templateId: string | null; tags: string[]; createdByUserId: string | null; createdByName: string | null;
  ownerUserId: string | null; signerUserId: string | null; signedAt: string | null; signerName: string | null; signerTitle: string | null; lastReturnNote: string | null;
  signatureBlock: (SignatureBlockFields & { titleLine?: string; nameLine?: string }) | null;
  voidedAt: string | null; voidReason: string | null; archivedAt: string | null; archiveFolderId: string | null; retentionUntil: string | null;
  pdfSnapshotAttachmentId: string | null; pdfSnapshotSha256: string | null; contentHash: string | null; revisionNo: number; createdAt: string; updatedAt: string;
  referrals: Referral[]; paraphs: Paraph[]; events: LetterEvent[]; participants: { id: string; userId: string; role: string; name: string | null }[];
  deliveries: { id: string; method: string; recipientName: string | null; sentAt: string | null; trackingCode: string | null; deliveredAt: string | null; receiptReceivedAt: string | null; note: string | null }[];
  reviews: { id: string; reviewerUserId: string; reviewerName: string | null; status: string; note: string | null; decidedAt: string | null }[];
  replyTo: LetterBrief | null; replies: LetterBrief[]; correctionOf: LetterBrief | null; corrections: LetterBrief[]; attachmentCount: number; hasSnapshot: boolean;
  flags: LetterFlags;
};

export type Person = { id: string; name: string; title: string | null; hasAccess: boolean };
export type Category = { id: string; parentId: string | null; code: string; name: string; isActive: boolean; sortOrder: number };
export type NumberingScheme = { id: string; name: string; type: LetterType; pattern: string; resetPolicy: "YEARLY" | "MONTHLY" | "NEVER"; startAt: number; isDefault: boolean; isActive: boolean };
export type ArchiveFolder = { id: string; parentId: string | null; name: string; retentionDays: number | null };
export type Counters = { pendingSignature: number; pendingReview: number; referralsToMe: number; overdueReferrals: number; drafts: number; awaitingIncoming: number; overdueResponses: number };
export type CorrMe = { userId: string | null; name: string; title: string | null; isManager: boolean; isOwner: boolean; matrix: { canViewAll: boolean; canViewOwn: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean } };

export type LetterFilters = {
  q?: string; number?: string; type?: string; status?: string; categoryId?: string; priority?: string; confidentiality?: string; dateField?: string;
  dateFrom?: string; dateTo?: string; sender?: string; recipient?: string; mine?: boolean; archived?: "only" | "exclude" | "all"; awaitingReply?: boolean;
  responseOverdue?: boolean; tag?: string;
};

function qs(o: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
const body = (method: string, data?: unknown): RequestInit => ({ method, body: JSON.stringify(data ?? {}) });
const B = "/correspondence";

export const fetchCorrMe = () => apiFetch<CorrMe>(`${B}/me`);
export const fetchCounters = () => apiFetch<Counters>(`${B}/counters`);
export const fetchPeople = () => apiFetch<Person[]>(`${B}/people`);
export const fetchInbox = (tab: string) => apiFetch<{ items: LetterListItem[] }>(`${B}/inbox${qs({ tab })}`);
export const fetchLetters = (f: LetterFilters, cursor?: string | null, limit = 30) =>
  apiFetch<{ items: LetterListItem[]; nextCursor: string | null }>(`${B}/letters${qs({ ...f, cursor: cursor ?? undefined, limit })}`);
export const fetchLetter = (id: string) => apiFetch<LetterDetail>(`${B}/letters/${id}`);
export const fetchOverdueReport = () =>
  apiFetch<{ letters: LetterListItem[]; referrals: { id: string; toName: string | null; dueAt: string | null; instruction: string; letter: { id: string; subject: string; letterNumber: string | null; confidentiality: Confidentiality } }[] }>(`${B}/reports/overdue`);

export type SignatureBlockFields = { signerTitle?: string; orgName?: string; signerName?: string; honorific?: string; showDate?: boolean };
export type Honorific = { value: string; label: string };
export type ResolvedSignature = {
  fields: { signerTitle: string; orgName: string; signerName: string; honorific: string; showDate: boolean };
  titleLine: string;
  nameLine: string;
  showDate: boolean;
  honorifics: Honorific[];
};
export type SignerOverride = { titleTemplate?: string; nameTemplate?: string; signerTitle?: string; honorific?: string; showDate?: boolean };
export type SignatureDefaults = { titleTemplate: string; nameTemplate: string; honorific: string; showDate: boolean; perSigner: Record<string, SignerOverride> };
export const fetchSignatureBlock = (signerUserId?: string) => apiFetch<ResolvedSignature>(`${B}/signature-block${qs({ signerUserId })}`);
export const fetchSignatureDefaults = () => apiFetch<{ defaults: SignatureDefaults; honorifics: Honorific[] }>(`${B}/signature-defaults`);
export const saveSignatureDefaults = (d: SignatureDefaults) => apiFetch<SignatureDefaults>(`${B}/signature-defaults`, body("PUT", d));

export type LetterInput = {
  /** null = خودکار (از پیش‌فرض‌ها/پروفایل) */
  signatureBlock?: SignatureBlockFields | null;
  subject?: string; bodyHtml?: string; recipients?: Recipient[]; ccNames?: string[]; categoryId?: string | null; priority?: Priority; confidentiality?: Confidentiality;
  letterDate?: string; responseDueAt?: string | null; attachmentsText?: string; letterheadId?: string | null; templateId?: string | null; tags?: string[];
  relatedContactId?: string | null;
};
export const createLetter = (type: "OUTGOING" | "INTERNAL", data: LetterInput & { replyToLetterId?: string }) => apiFetch<LetterDetail>(`${B}/letters`, body("POST", { type, ...data }));
export const updateLetter = (id: string, data: LetterInput & { autosave?: boolean; reason?: string; baseUpdatedAt?: string }) => apiFetch<LetterDetail>(`${B}/letters/${id}`, body("PATCH", data));
export const deleteDraft = (id: string) => apiFetch<{ success: boolean }>(`${B}/letters/${id}`, { method: "DELETE" });
export const fetchRevisions = (id: string) =>
  apiFetch<{ id: string; revisionNo: number; reason: string | null; changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown>; actorName: string | null; createdAt: string }[]>(`${B}/letters/${id}/revisions`);

export type IncomingInput = {
  subject: string; externalNumber?: string; externalDate?: string; receivedAt?: string; deliveryMethod?: string; senderOrgName?: string; senderName?: string; senderContactId?: string;
  bodyHtml?: string; categoryId?: string; priority?: Priority; confidentiality?: Confidentiality; pageCount?: number; attachmentsText?: string; responseDueAt?: string; allowDuplicate?: boolean;
  referral?: { toUserIds: string[]; instruction?: string; dueAt?: string; kind?: "ACTION" | "INFO" };
};
export type DuplicateInfo = { hasDuplicate: boolean; duplicates: { id: string; letterNumber: string | null; subject: string }[] };
export const registerIncoming = (data: IncomingInput) => apiFetch<LetterDetail & { referralError?: string }>(`${B}/letters/incoming`, body("POST", data));
export const checkDuplicate = (d: Pick<IncomingInput, "senderContactId" | "senderOrgName" | "senderName" | "externalNumber" | "externalDate">) =>
  apiFetch<DuplicateInfo>(`${B}/letters/incoming/check-duplicate`, body("POST", d));

const act = <T = LetterDetail>(id: string, path: string, data?: unknown) => apiFetch<T>(`${B}/letters/${id}/${path}`, body("POST", data));
export const submitForSignature = (id: string, d: { signerUserId: string; reviewerUserIds?: string[]; note?: string }) => act(id, "submit", d);
export const reviewLetter = (id: string, d: { decision: "APPROVE" | "CHANGES"; note?: string }) => act(id, "review", d);
export const signLetter = (id: string, d: { confirm: true; useStamp?: boolean; evidence?: unknown }) => act(id, "sign", d);
export const returnLetter = (id: string, note: string) => act(id, "return", { note });
export const rejectLetter = (id: string, note: string) => act(id, "reject", { note });
export const voidLetter = (id: string, reason: string) => act(id, "void", { reason });
export const reopenLetter = (id: string, note?: string) => act(id, "reopen", { note });
export const closeLetter = (id: string, note?: string) => act(id, "close", { note });
export const markSent = (id: string, d: { method: string; recipientName?: string; sentAt?: string; trackingCode?: string; note?: string }) => act(id, "sent", d);
export const markDelivered = (id: string, d: { deliveredAt?: string; note?: string; receiptAttachmentId?: string }) => act(id, "delivered", d);
export const replyToLetter = (id: string, type?: "OUTGOING" | "INTERNAL") => act(id, "reply", { type });
export const createCorrection = (id: string) => act(id, "correction");
export const addFollowup = (id: string, d: { text: string; kind?: "NOTE" | "CALL" | "RESPONSE"; at?: string }) => act<{ success: boolean }>(id, "followups", d);
export const archiveLetter = (id: string, d: { folderId?: string; retentionUntil?: string }) => act(id, "archive", d);
export const unarchiveLetter = (id: string) => act(id, "unarchive");
export const bulkArchive = (ids: string[], d: { folderId?: string; retentionUntil?: string }) =>
  apiFetch<{ archived: number; results: { id: string; ok: boolean; error?: string }[] }>(`${B}/letters/bulk-archive`, body("POST", { ids, ...d }));
export const referLetter = (id: string, d: { toUserIds: string[]; instruction?: string; dueAt?: string; kind?: "ACTION" | "INFO" }) => act<Referral[]>(id, "refer", d);
export const addParaph = (id: string, text: string) => act<Paraph>(id, "paraphs", { text });
const ref = <T = Referral>(id: string, path: string, data?: unknown) => apiFetch<T>(`${B}/referrals/${id}/${path}`, body("POST", data));
export const referralSeen = (id: string) => ref(id, "seen");
export const referralDone = (id: string, response?: string) => ref(id, "done", { response });
export const referralReturn = (id: string, response: string) => ref(id, "return", { response });
export const referralForward = (id: string, d: { toUserIds: string[]; instruction?: string; dueAt?: string; response?: string }) => ref<Referral[]>(id, "forward", d);
export const referralCancel = (id: string) => ref<{ success: boolean }>(id, "cancel");

export const fetchCategories = () => apiFetch<Category[]>(`${B}/categories`);
export const saveCategory = (id: string | null, d: Partial<Category>) => apiFetch<Category>(id ? `${B}/categories/${id}` : `${B}/categories`, body(id ? "PATCH" : "POST", d));
export const deleteCategory = (id: string) => apiFetch<{ success: boolean }>(`${B}/categories/${id}`, { method: "DELETE" });
export const fetchSchemes = () => apiFetch<NumberingScheme[]>(`${B}/numbering-schemes`);
export const saveScheme = (id: string | null, d: Partial<NumberingScheme>) => apiFetch<NumberingScheme>(id ? `${B}/numbering-schemes/${id}` : `${B}/numbering-schemes`, body(id ? "PATCH" : "POST", d));
export const deleteScheme = (id: string) => apiFetch<{ success: boolean }>(`${B}/numbering-schemes/${id}`, { method: "DELETE" });
export const previewNumber = (type: LetterType, categoryId?: string) => apiFetch<{ next: string | null; pattern: string | null }>(`${B}/numbering-schemes/preview${qs({ type, categoryId })}`);
export const fetchFolders = () => apiFetch<ArchiveFolder[]>(`${B}/archive-folders`);
export const saveFolder = (id: string | null, d: Partial<ArchiveFolder>) => apiFetch<ArchiveFolder>(id ? `${B}/archive-folders/${id}` : `${B}/archive-folders`, body(id ? "PATCH" : "POST", d));
export const deleteFolder = (id: string) => apiFetch<{ success: boolean }>(`${B}/archive-folders/${id}`, { method: "DELETE" });

async function authBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = "دریافت فایل ناموفق بود";
    try {
      const j = (await res.json()) as { message?: string | string[] };
      if (j.message) msg = Array.isArray(j.message) ? j.message.join("، ") : j.message;
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  return res.blob();
}
/**
 * باز کردن PDF بدون مسدود شدن توسط popup-blocker: تب هم‌زمان با کلیک باز می‌شود (پیش از await) و بعد آدرس blob را می‌گیرد؛
 * URL پس از مدتی revoke می‌شود.
 */
export async function openPdfInTab(make: () => Promise<string>): Promise<void> {
  const w = window.open("about:blank", "_blank");
  if (w) w.opener = null;
  try {
    const url = await make();
    // آدرس blob داخلی است، نه مسیر صفحه‌ی Next
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (w) w.location.href = url;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

export async function letterPdfUrl(id: string, paraphs = false): Promise<string> {
  return URL.createObjectURL(await authBlob(`${B}/letters/${id}/pdf${paraphs ? "?paraphs=1" : ""}`));
}
export async function slipPdfUrl(id: string, variant: "slip" | "label"): Promise<string> {
  return URL.createObjectURL(await authBlob(`${B}/letters/${id}/slip?variant=${variant}`));
}
export async function downloadRegisterCsv(f: LetterFilters): Promise<void> {
  const blob = await authBlob(`${B}/letters/register.csv${qs({ ...f })}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "letter-register.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type PublicVerify = { valid: boolean; letterNumber: string | null; date: string | null; signerName: string | null; issuerOrg: string | null; status: "ACTIVE" | "VOID" | null };
export async function verifyLetterPublic(ref: string, token: string): Promise<PublicVerify> {
  const res = await fetch(`${API_URL}/public/correspondence/verify/${encodeURIComponent(ref)}/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (res.status === 429) throw new ApiError("تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید", 429);
  if (!res.ok) throw new ApiError("بررسی ناموفق بود", res.status);
  return (await res.json()) as PublicVerify;
}
