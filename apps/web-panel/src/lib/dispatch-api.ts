import { apiFetch, API_URL, getToken, ApiError } from "@/lib/api";
import type { ShipmentStatus } from "@/lib/api";

export type DispatchStatusLabels = Record<string, string>;

export const DISPATCH_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "ثبت‌شده",
  AWAITING_DRIVER: "در انتظار راننده",
  OFFERED: "در حال پیشنهاد به راننده",
  ACCEPTED: "راننده تعیین شد",
  VEHICLE_ARRIVED: "ماشین رسیده",
  CLEANLINESS_APPROVED: "نظافت تأیید شد",
  TARE_RECORDED: "وزن خالی ثبت شد",
  LOADED: "بارگیری شده",
  WEIGHED: "وزن‌کشی شد",
  AWAITING_DOCS: "در انتظار اسناد",
  FINAL_CHECK: "کنترل نهایی",
  READY_TO_DEPART: "آماده حرکت",
  IN_TRANSIT: "در مسیر",
  DELIVERED: "تحویل شد",
  SUSPENDED: "متوقف",
  CANCELLED: "لغو",
};

export type DispatchTone = "primary" | "success" | "warning" | "neutral" | "danger" | "accent";
export const DISPATCH_STATUS_TONES: Record<ShipmentStatus, DispatchTone> = {
  DRAFT: "neutral",
  AWAITING_DRIVER: "warning",
  OFFERED: "warning",
  ACCEPTED: "primary",
  VEHICLE_ARRIVED: "primary",
  CLEANLINESS_APPROVED: "primary",
  TARE_RECORDED: "primary",
  LOADED: "primary",
  WEIGHED: "accent",
  AWAITING_DOCS: "warning",
  FINAL_CHECK: "accent",
  READY_TO_DEPART: "success",
  IN_TRANSIT: "success",
  DELIVERED: "success",
  SUSPENDED: "danger",
  CANCELLED: "danger",
};

export type ShippingProfile = { uniqueId: string | null; nationalId: string | null; postalCode: string | null; postalAddress: string | null };

export type DispatchSourceType = "MANUAL" | "SALES_INVOICE" | "PRODUCTION_ORDER" | "STOCK_MOVEMENT";

export type SourceStatus = {
  sourceType: Exclude<DispatchSourceType, "MANUAL">;
  sourceId: string;
  suggested: boolean;
  existing: { id: string; status: ShipmentStatus; shipmentNo?: number } | null;
  dismissed: boolean;
  production: { stagesBeforeEnd: number; override: number | null; tenantDefault: number; totalStages: number; doneStages: number; enabled: boolean } | null;
};

export type DispatchPrefill = {
  sourceType: Exclude<DispatchSourceType, "MANUAL">;
  sourceId: string;
  contactId: string | null;
  contactName: string | null;
  cargoType: string;
  quantity: number;
  unit: string;
  deliveryAddress: string;
  region: string;
  pickupAt: string;
  expectedWeightKg: number | null;
  profile: ShippingProfile;
  missingProfile: Array<keyof ShippingProfile>;
  invoice: { id: string; invoiceNo: number; status: string; lines: Array<{ id: string; description: string; quantity: number }> } | null;
  reference: string | null;
  existing: { id: string; status: ShipmentStatus; shipmentNo?: number } | null;
};

export type DeclareBody = {
  sourceType?: DispatchSourceType;
  sourceId?: string;
  contactId?: string;
  cargoType: string;
  quantity: number;
  unit?: string;
  deliveryAddress: string;
  region?: string;
  pickupAt: string;
  needsWeighing?: boolean;
  weighLineIds?: string[];
  kgPerUnit?: number;
  expectedWeightKg?: number;
  driverId?: string;
  profile?: { uniqueId?: string; nationalId?: string; postalCode?: string; postalAddress?: string };
  saveToProfile?: boolean;
};

export type DispatchRow = {
  id: string;
  shipmentNo: number;
  status: ShipmentStatus;
  statusLabel: string;
  customerName: string | null;
  cargoType: string;
  region: string | null;
  driverName: string | null;
  plateNumber: string | null;
  tareKg: number | null;
  grossKg: number | null;
  netKg: number | null;
  createdAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
  docsRequired: number;
  needsWeighing: boolean;
};

export type DispatchReport = {
  rows: DispatchRow[];
  summary: { count: number; totalNetKg: number; withWeight: number; byStatus: Record<string, number> };
};

export type DispatchFilters = {
  status?: string;
  driverId?: string;
  region?: string;
  cargoType?: string;
  minNetKg?: string;
  maxNetKg?: string;
  from?: string;
  to?: string;
  q?: string;
};

export type DispatchLoading = {
  needsWeighing: boolean;
  expectedWeightKg: number | null;
  kgPerUnit: number;
  customerName: string | null;
  uniqueId: string | null;
  nationalId: string | null;
  postalCode: string | null;
  postalAddress: string | null;
  arrivedAt: string | null;
  arrivedByName: string | null;
  cleanlinessResult: "PASS" | "FAIL" | null;
  cleanlinessNote: string | null;
  cleanlinessAt: string | null;
  cleanlinessByName: string | null;
  tareKg: number | null;
  tareAt: string | null;
  tareByName: string | null;
  loadedAt: string | null;
  loaderName: string | null;
  loaderUserId: string | null;
  grossKg: number | null;
  grossAt: string | null;
  grossByName: string | null;
  netKg: number | null;
  netEdited: boolean;
  netEditReason: string | null;
  weightConfirmedAt: string | null;
  weightConfirmedByName: string | null;
  requiredDocTypes: string[];
  docsTaskId: string | null;
  docsOverrideReason: string | null;
  docsOverrideByName: string | null;
  docsOverrideAt: string | null;
  finalCheckResult: "PASS" | "FAIL" | null;
  finalCheckNote: string | null;
  loadingCorrect: boolean | null;
  tarpInstalled: boolean | null;
  finalCheckAt: string | null;
  finalCheckByName: string | null;
  readyGrantedAt: string | null;
  readyGrantedByName: string | null;
  departedAt: string | null;
  departedByName: string | null;
  receiptOverrideReason: string | null;
};

export type DispatchEvent = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  note: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type DispatchDocType = { id: string; code: string; name: string; isSystem: boolean; isActive: boolean; sortOrder: number };

export type DispatchAdjustment = {
  id: string;
  invoiceId: string;
  status: "PROPOSED" | "APPLIED" | "REJECTED" | "NO_CHANGE";
  netWeightKg: number;
  lineChanges: Array<{ lineId: string; description: string; oldQty: number; newQty: number; unitPrice: number; oldTotal: number; newTotal: number }>;
  oldTotal: number;
  newTotal: number;
  oldSubtotal: number;
  newSubtotal: number;
  oldDiscount: number;
  newDiscount: number;
  oldTaxAmount: number;
  newTaxAmount: number;
  decisionNote: string | null;
  decidedByName: string | null;
  appliedAt: string | null;
  finalizedAt: string | null;
  finalizeError: string | null;
};

export type DispatchCan = Partial<Record<
  | "edit" | "assignDriver" | "arrival" | "cleanliness" | "tare" | "loading" | "gross" | "finalCheck" | "ready" | "depart" | "deliver" | "docs"
  | "confirmWeight" | "editNet" | "override" | "suspend" | "resume" | "cancel" | "manualStatus" | "receipt" | "decideAdjustment",
  boolean
>>;

export type DispatchDetail = {
  shipment: {
    id: string;
    shipmentNo: number;
    status: ShipmentStatus;
    sourceType: string;
    sourceInvoiceId: string | null;
    sourceStockMovementId: string | null;
    cargoType: string;
    quantity: number;
    unit: string | null;
    deliveryAddress: string;
    region: string | null;
    pickupAt: string;
    deliveredAt: string | null;
    createdAt: string;
    driverId: string | null;
    contact: { id: string; name: string; company: string | null; phone: string | null } | null;
    driver: { id: string; name: string; phone: string; plateNumber: string | null; vehicleType: string | null } | null;
    createdBy: { id: string; name: string } | null;
    loading: DispatchLoading | null;
  };
  events: DispatchEvent[];
  documents: Array<{ id: string; docTypeCode: string; step: string | null; attachmentId: string; title: string | null; fileUrl: string | null; createdByName: string | null; createdAt: string }>;
  docTypes: DispatchDocType[];
  requiredDocTypes: string[];
  missingDocTypes: string[];
  docsComplete: boolean;
  receipt: { status: "PENDING" | "SIGNED" | "PAPER"; sentAt: string | null; signedAt: string | null; signerName: string | null; paperByName: string | null; hasPdf: boolean; archived: boolean; link: string | null } | null;
  adjustment: DispatchAdjustment | null;
  task: { id: string; number: number; title: string; status: string; assignees: Array<{ id: string; name: string }> } | null;
  settings: { receiptRequiredBefore: "DEPARTURE" | "DELIVERY" | "NONE" };
  handlerOnly: boolean;
  can: DispatchCan;
};

export type StepAccess = { roleIds: string[]; userIds: string[] };
export type DispatchSettings = {
  productionTrigger: { enabled: boolean; stagesBeforeEnd: number };
  steps: Record<"arrival" | "cleanliness" | "weighing" | "loading" | "finalCheck" | "readyToDepart" | "weightConfirm", StepAccess>;
  receipt: { requiredBefore: "DEPARTURE" | "DELIVERY" | "NONE"; smsEnabled: boolean; smsTemplate: string; archiveEnabled: boolean };
};

export type DispatchRule = {
  id: string;
  name: string;
  isActive: boolean;
  minNetKg: number | null;
  cargoTypes: string[];
  regions: string[];
  docTypeCodes: string[];
  handlerRoleId: string | null;
  handlerUserId: string | null;
  sortOrder: number;
};

const qs = (f: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

const post = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const fetchDispatchReport = (f: DispatchFilters = {}) => apiFetch<DispatchReport>(`/dispatch/shipments${qs(f as Record<string, string | undefined>)}`);
export const fetchDispatchDetail = (id: string) => apiFetch<DispatchDetail>(`/dispatch/shipments/${id}`);
export const declareDispatch = (body: DeclareBody) => post<{ shipment: { id: string; shipmentNo: number }; alreadyExisted: boolean }>("/dispatch/shipments", body);
export const enrollDispatch = (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/enroll`);
export const fetchSourceStatus = (type: string, id: string) => apiFetch<SourceStatus>(`/dispatch/source-status?type=${type}&id=${encodeURIComponent(id)}`);
export const fetchDispatchPrefill = (type: string, id: string) => apiFetch<DispatchPrefill>(`/dispatch/prefill?type=${type}&id=${encodeURIComponent(id)}`);
export const dismissDispatchSource = (type: string, id: string) => post<{ success: boolean }>("/dispatch/source-dismiss", { type, id });
export const setProductionTrigger = (orderId: string, stagesBeforeEnd: number | null) =>
  apiFetch<SourceStatus>(`/dispatch/production/${orderId}/trigger`, { method: "PUT", body: JSON.stringify({ stagesBeforeEnd }) });

export const dispatchAction = {
  assignDriver: (id: string, driverId: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/driver`, { driverId }),
  arrival: (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/arrival`),
  cleanliness: (id: string, result: "PASS" | "FAIL", note?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/cleanliness`, { result, note }),
  tare: (id: string, kg: number) => post<DispatchDetail>(`/dispatch/shipments/${id}/tare`, { kg }),
  loaded: (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/loaded`),
  gross: (id: string, kg: number) => post<DispatchDetail>(`/dispatch/shipments/${id}/gross`, { kg }),
  net: (id: string, netKg: number, reason: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/net`, { netKg, reason }),
  finalCheck: (id: string, body: { result: "PASS" | "FAIL"; note?: string; loadingCorrect?: boolean; tarpInstalled?: boolean }) => post<DispatchDetail>(`/dispatch/shipments/${id}/final-check`, body),
  confirmWeight: (id: string, note?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/confirm-weight`, { note }),
  ready: (id: string, note?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/ready`, { note }),
  depart: (id: string, overrideReason?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/depart`, { overrideReason }),
  deliver: (id: string, overrideReason?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/deliver`, { overrideReason }),
  status: (id: string, status: ShipmentStatus, reason: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/status`, { status, reason }),
  resume: (id: string, reason: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/resume`, { reason }),
  addDoc: (id: string, body: { docTypeCode: string; title: string; fileUrl: string; step?: "TARE" | "GROSS" }) => post<DispatchDetail>(`/dispatch/shipments/${id}/docs`, body),
  removeDoc: (id: string, docId: string) => apiFetch<DispatchDetail>(`/dispatch/shipments/${id}/docs/${docId}`, { method: "DELETE" }),
  overrideDocs: (id: string, reason: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/docs-override`, { reason }),
  sendReceipt: (id: string) => post<{ link: string; sent: boolean; detail: DispatchDetail }>(`/dispatch/shipments/${id}/receipt/send`),
  paperReceipt: (id: string, title: string, fileUrl: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/receipt/paper`, { title, fileUrl }),
  receiptPdf: (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/receipt/pdf`),
  proposeAdjustment: (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/adjustment/propose`),
  decideAdjustment: (id: string, approve: boolean, note?: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/adjustment/decision`, { approve, note }),
  finalizeInvoice: (id: string) => post<DispatchDetail>(`/dispatch/shipments/${id}/adjustment/finalize`),
};

export const fetchDispatchSettings = () => apiFetch<DispatchSettings>("/dispatch/settings");
export const saveDispatchSettings = (s: DispatchSettings) => apiFetch<DispatchSettings>("/dispatch/settings", { method: "PUT", body: JSON.stringify(s) });
export const fetchDispatchLookups = () => apiFetch<{ roles: Array<{ id: string; name: string }>; users: Array<{ id: string; name: string }> }>("/dispatch/lookups");
export type DispatchDriver = { id: string; name: string; phone: string; plateNumber: string | null; vehicleType: string | null; capacityKg: number | null; serviceAreas: string[] };
export const fetchDispatchDrivers = () => apiFetch<DispatchDriver[]>("/dispatch/drivers");
export const fetchDocTypes = () => apiFetch<DispatchDocType[]>("/dispatch/doc-types");
export const createDocType = (name: string) => post<DispatchDocType>("/dispatch/doc-types", { name });
export const updateDocType = (id: string, body: { name?: string; isActive?: boolean }) => apiFetch<DispatchDocType>(`/dispatch/doc-types/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const fetchDocRules = () => apiFetch<DispatchRule[]>("/dispatch/rules");
export type DocRuleBody = Omit<DispatchRule, "id">;
export const createDocRule = (b: DocRuleBody) => post<DispatchRule>("/dispatch/rules", b);
export const updateDocRule = (id: string, b: DocRuleBody) => apiFetch<DispatchRule>(`/dispatch/rules/${id}`, { method: "PUT", body: JSON.stringify(b) });
export const deleteDocRule = (id: string) => apiFetch<{ success: boolean }>(`/dispatch/rules/${id}`, { method: "DELETE" });

/** خروجی CSV گزارش با همان فیلترها (دانلود با توکن). */
export async function downloadDispatchCsv(f: DispatchFilters): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/dispatch/shipments/export${qs(f as Record<string, string | undefined>)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError("دریافت خروجی ناموفق بود", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dispatch-report.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── رسید راننده (عمومی) ─────────────────────────────────────────────
export type PublicReceiptView =
  | { status: "not_ready"; shipmentNo: number; orgName: string }
  | {
      status: "pending" | "signed";
      orgName: string;
      shipmentNo: number;
      cargoType: string;
      quantityText: string;
      customerName: string | null;
      postalAddress: string | null;
      driverName: string | null;
      plateNumber: string | null;
      tareKg: number | null;
      grossKg: number | null;
      netKg: number | null;
      signedAt: string | null;
      statement: string;
    };

export const viewPublicReceipt = (slug: string, token: string) => apiFetch<PublicReceiptView>(`/public/dispatch/receipt/${slug}/${token}`);
export const signPublicReceipt = (slug: string, token: string, body: { signatureData: string; confirmed: boolean; evidence?: unknown }) =>
  post<{ status: "signed"; signedAt: string }>(`/public/dispatch/receipt/${slug}/${token}/sign`, body);
