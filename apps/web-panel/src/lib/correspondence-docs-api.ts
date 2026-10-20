import { API_URL, ApiError, apiFetch, getToken } from "./api";

/** واحد همه‌ی مختصات: میلی‌متر، مبدأ = گوشه‌ی بالا-چپ برگه (مطابق backend: letterhead-layout.ts). */
export type LetterBoxKey = "number" | "date" | "attachments" | "subject" | "recipient" | "body" | "signature" | "paraphs" | "qr" | "confidentiality";
export type LetterBoxLayout = {
  visible: boolean;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontFamily: string;
  fontSizePt: number;
  bold: boolean;
  color: string;
  align: "right" | "center" | "left" | "justify";
  lineHeight: number;
};
export type LetterheadLayout = {
  pageSize: "A4" | "A5";
  orientation: "portrait" | "landscape";
  letterheadOnAllPages: boolean;
  boxes: Record<LetterBoxKey, LetterBoxLayout>;
  continuationMarginsMm: { top: number; bottom: number; left: number; right: number };
};

export const BOX_LABELS: Record<LetterBoxKey, string> = {
  number: "شماره‌ی نامه",
  date: "تاریخ",
  attachments: "پیوست",
  subject: "موضوع",
  recipient: "گیرنده",
  body: "متن نامه",
  signature: "امضا و مهر",
  paraphs: "پاراف‌ها",
  qr: "کد QR صحت‌سنجی",
  confidentiality: "محرمانگی / فوریت",
};
export const BOX_KEYS = Object.keys(BOX_LABELS) as LetterBoxKey[];
export const PAGE_MM = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } } as const;

export type Letterhead = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  pageSize: "A4" | "A5";
  orientation: "portrait" | "landscape";
  layout: LetterheadLayout;
  departmentId: string | null;
  hasImage: boolean;
  backgroundImage?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type LetterheadMeta = {
  fonts: string[];
  boxKeys: LetterBoxKey[];
  defaults: Record<"A4" | "A5", Record<"portrait" | "landscape", LetterheadLayout>>;
};
export type LetterheadInput = {
  name?: string;
  pageSize?: "A4" | "A5";
  orientation?: "portrait" | "landscape";
  layout?: LetterheadLayout;
  backgroundImage?: string | null;
  departmentId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};

const post = (path: string, body?: unknown) => ({ method: "POST", body: JSON.stringify(body ?? {}) }) as RequestInit;

export const fetchLetterheads = () => apiFetch<Letterhead[]>("/correspondence/letterheads");
export const fetchLetterheadMeta = () => apiFetch<LetterheadMeta>("/correspondence/letterheads/meta");
export const fetchLetterhead = (id: string) => apiFetch<Letterhead>(`/correspondence/letterheads/${id}`);
export const createLetterhead = (data: LetterheadInput & { name: string }) => apiFetch<Letterhead>("/correspondence/letterheads", post("", data));
export const updateLetterhead = (id: string, data: LetterheadInput) =>
  apiFetch<Letterhead>(`/correspondence/letterheads/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const setDefaultLetterhead = (id: string) => apiFetch<{ success: boolean }>(`/correspondence/letterheads/${id}/set-default`, post(""));
export const duplicateLetterhead = (id: string) => apiFetch<Letterhead>(`/correspondence/letterheads/${id}/duplicate`, post(""));
export const deleteLetterhead = (id: string) => apiFetch<{ success: boolean }>(`/correspondence/letterheads/${id}`, { method: "DELETE" });

/** PDF با توکن (Authorization) گرفته و به Object URL تبدیل می‌شود. */
async function pdfObjectUrl(path: string, body: unknown): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let msg = "ساخت PDF ناموفق بود";
    try {
      const j = (await res.json()) as { message?: string | string[] };
      if (j.message) msg = Array.isArray(j.message) ? j.message.join("، ") : j.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return URL.createObjectURL(await res.blob());
}
export const letterheadSamplePdfUrl = (id: string, body: { long?: boolean; persianDigits?: boolean; pageSize?: "A4" | "A5"; orientation?: "portrait" | "landscape"; layout?: LetterheadLayout; backgroundImage?: string | null } = {}) =>
  pdfObjectUrl(`/correspondence/letterheads/${id}/sample-pdf`, body);

export type PreviewPdfInput = {
  letterheadId?: string;
  templateId?: string;
  departmentId?: string;
  number?: string;
  dateText?: string;
  subject?: string;
  bodyHtml?: string;
  attachmentsText?: string;
  recipientName?: string;
  recipientTitle?: string;
  senderName?: string;
  senderTitle?: string;
  confidentialityLabel?: string;
  priorityLabel?: string;
  watermark?: "DRAFT" | "VOID";
  withSignature?: boolean;
  withQr?: boolean;
  persianDigits?: boolean;
};
export const previewLetterPdfUrl = (body: PreviewPdfInput) => pdfObjectUrl("/correspondence/pdf/preview", body);
export const templatePdfUrl = (id: string) => pdfObjectUrl(`/correspondence/templates/${id}/preview-pdf`, {});

// ───── قالب‌ها ─────
export type CorrLetterType = "INCOMING" | "OUTGOING" | "INTERNAL" | "ANY";
export const LETTER_TYPE_LABELS: Record<CorrLetterType, string> = { INCOMING: "وارده", OUTGOING: "صادره", INTERNAL: "داخلی", ANY: "همه‌ی انواع" };
export type CorrTemplate = {
  id: string;
  name: string;
  letterType: CorrLetterType;
  categoryId: string | null;
  subject: string;
  bodyHtml: string;
  defaultLetterheadId: string | null;
  isActive: boolean;
  sortOrder: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CorrTemplateInput = Partial<Pick<CorrTemplate, "name" | "letterType" | "categoryId" | "subject" | "bodyHtml" | "defaultLetterheadId" | "isActive" | "sortOrder">>;
export type TemplatePlaceholder = { key: string; token: string; label: string };

export function fetchCorrTemplates(opts: { letterType?: string; activeOnly?: boolean } = {}) {
  const p = new URLSearchParams();
  if (opts.letterType) p.set("letterType", opts.letterType);
  if (opts.activeOnly) p.set("activeOnly", "1");
  const qs = p.toString();
  return apiFetch<CorrTemplate[]>(`/correspondence/templates${qs ? `?${qs}` : ""}`);
}
export const fetchTemplatePlaceholders = () => apiFetch<TemplatePlaceholder[]>("/correspondence/templates/placeholders");
export const createCorrTemplate = (data: CorrTemplateInput & { name: string; bodyHtml: string }) => apiFetch<CorrTemplate>("/correspondence/templates", post("", data));
export const updateCorrTemplate = (id: string, data: CorrTemplateInput) =>
  apiFetch<CorrTemplate>(`/correspondence/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteCorrTemplate = (id: string) => apiFetch<{ success: boolean }>(`/correspondence/templates/${id}`, { method: "DELETE" });
export const renderCorrTemplate = (id: string, context: Record<string, string | null> = {}, sample = false) =>
  apiFetch<{ subject: string; bodyHtml: string; letterType: CorrLetterType; defaultLetterheadId: string | null }>(
    `/correspondence/templates/${id}/render${sample ? "?sample=1" : ""}`,
    post("", { context }),
  );
