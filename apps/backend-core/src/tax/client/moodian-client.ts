import type { KeyObject } from 'node:crypto';
import type { TaxEnvironment, TaxInvoiceStatus } from './types.js';

/** همه‌ی ارتباط شبکه‌ای با سامانه مودیان فقط از طریق پیاده‌سازی‌های این رابط انجام می‌شود. */

export type MoodianServerInfo = {
  serverTime: number;
  publicKeys: Array<{ id: string; key: string; algorithm: string; purpose: number }>;
};

export type MoodianFiscalInfo = { nameTrade?: string; fiscalStatus?: string; saleThreshold?: number; economicCode?: string };

export type MoodianInquiryItem = {
  uid: string | null;
  referenceNumber: string | null;
  /** SUCCESS | FAILED | PENDING | ... (متن خام سرور) */
  status: string;
  data?: { confirmationReferenceId?: string | null; taxResult?: unknown } | null;
  packetType?: string | null;
  fiscalId?: string | null;
};

export type MoodianSendResult = {
  uid: string;
  referenceNumber: string | null;
  errorCode: string | null;
  errorDetail: string | null;
};

/** مجوز ارسال: خلاصه‌ی وضعیت ذخیره‌شده‌ی TaxInvoice؛ کلاینت واقعی بدون آن هرگز ارسال نمی‌کند. */
export type SendPermit = {
  taxInvoiceId: string;
  status: TaxInvoiceStatus;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  uid: string;
  retry: boolean;
  /** JSON منجمدشده در لحظه‌ی تأیید */
  invoice: unknown;
  /** هش رشته‌ی نرمال‌شده‌ی منجمد؛ باید با نرمال‌سازی همین لحظه‌ی invoice برابر باشد (دست‌کاری پس از تأیید = رد). */
  expectedHash: string | null;
};

export type ClientSettingsView = {
  fiscalId: string | null;
  environment: TaxEnvironment;
  sendingEnabled: boolean;
  verifiedAgainstSandboxAt: Date | null;
};

export type ClientLogEntry = {
  kind: string;
  ok: boolean;
  requestTraceId?: string;
  httpStatus?: number;
  errorCode?: string;
  summary?: Record<string, unknown>;
};

export type MoodianClientConfig = {
  settings: ClientSettingsView;
  baseUrl: string;
  privateKey: KeyObject | null;
  serverPublicKey: KeyObject | null;
  serverPublicKeyId: string | null;
  signatureKeyId?: string | null;
  onLog?: (entry: ClientLogEntry) => void;
  timeoutMs?: number;
};

export interface MoodianClient {
  getServerInformation(): Promise<MoodianServerInfo>;
  getFiscalInformation(): Promise<MoodianFiscalInfo>;
  sendInvoice(permit: SendPermit): Promise<MoodianSendResult>;
  inquiryByUid(uids: string[]): Promise<MoodianInquiryItem[]>;
  inquiryByReferenceNumber(refs: string[]): Promise<MoodianInquiryItem[]>;
}

export interface MoodianClientFactory {
  create(config: MoodianClientConfig): MoodianClient;
}

export const MOODIAN_CLIENT_FACTORY = Symbol('MOODIAN_CLIENT_FACTORY');
