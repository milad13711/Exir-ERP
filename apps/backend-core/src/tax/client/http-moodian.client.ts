import { randomUUID } from 'node:crypto';
import { encryptInvoice } from '../crypto/packet-crypto.js';
import { signAsyncRequest, signSyncRequest } from '../crypto/request-signing.js';
import { ALLOWED_HOST_SUFFIX, API_PATHS, MAX_PACKETS_PER_REQUEST, PACKET_TYPE_INVOICE } from '../mapping/moodian-field-map.js';
import type {
  ClientLogEntry,
  MoodianClient,
  MoodianClientConfig,
  MoodianClientFactory,
  MoodianFiscalInfo,
  MoodianInquiryItem,
  MoodianSendResult,
  MoodianServerInfo,
  SendPermit,
} from './moodian-client.js';
import { SendRefusedError, assertSendAllowed } from './send-guard.js';

export class MoodianTransportError extends Error {
  constructor(
    message: string,
    public readonly transient: boolean,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'MoodianTransportError';
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export type HttpClientDeps = { fetchImpl?: FetchLike; now?: () => number; uuid?: () => string };

/** آدرس پایه باید https و زیر دامنه‌ی tax.gov.ir باشد تا خطای تنظیمات هرگز داده را به مقصد دیگری نفرستد. */
export function assertAllowedBaseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SendRefusedError('NOT_CONFIGURED', 'آدرس پایه‌ی سامانه مودیان نامعتبر است');
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !(host === ALLOWED_HOST_SUFFIX || host.endsWith(`.${ALLOWED_HOST_SUFFIX}`))) {
    throw new SendRefusedError('NOT_CONFIGURED', 'آدرس سامانه مودیان باید https و در دامنه‌ی tax.gov.ir باشد');
  }
  return u;
}

/** دامنه‌ی خلاصه‌ی لاگ: هرگز توکن، کلید، داده‌ی رمزشده یا امضا نمی‌آید. */
export function safeSummary(obj: Record<string, unknown>): Record<string, unknown> {
  const banned = /token|authorization|key|signature|data|iv|secret|password/i;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !banned.test(k)));
}

const TOKEN_SKEW_MS = 30_000;

export class HttpMoodianClient implements MoodianClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly base: string;

  constructor(
    private readonly cfg: MoodianClientConfig,
    deps: HttpClientDeps = {},
  ) {
    this.base = assertAllowedBaseUrl(cfg.baseUrl).toString().replace(/\/?$/, '/');
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? randomUUID;
  }

  private log(entry: ClientLogEntry): void {
    try {
      this.cfg.onLog?.(entry);
    } catch {
      // ثبت لاگ نباید جریان را بشکند
    }
  }

  private async post(kind: string, path: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs ?? 20_000);
    try {
      const res = await this.fetchImpl(this.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
      const text = await res.text();
      let json: Record<string, any> = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        this.log({ kind, ok: false, requestTraceId: headers.requestTraceId, httpStatus: res.status, summary: { note: 'non-json response' } });
        throw new MoodianTransportError(`پاسخ سامانه مودیان قابل خواندن نبود (HTTP ${res.status})`, res.status >= 500, res.status);
      }
      return { status: res.status, json };
    } catch (e) {
      if (e instanceof MoodianTransportError) throw e;
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.log({ kind, ok: false, requestTraceId: headers.requestTraceId, summary: { note: aborted ? 'timeout' : 'network error' } });
      throw new MoodianTransportError(aborted ? 'مهلت اتصال به سامانه مودیان تمام شد' : 'اتصال به سامانه مودیان برقرار نشد', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private baseHeaders(): { requestTraceId: string; timestamp: number } {
    return { requestTraceId: this.uuid(), timestamp: this.now() };
  }

  private requirePrivateKey() {
    if (!this.cfg.privateKey) throw new SendRefusedError('NOT_CONFIGURED', 'کلید خصوصی مودی بارگذاری نشده است');
    if (!this.cfg.settings.fiscalId) throw new SendRefusedError('NOT_CONFIGURED', 'شناسه یکتای حافظه مالیاتی تنظیم نشده است');
    return this.cfg.privateKey;
  }

  private syncPacket(packetType: string, data: unknown, fiscalId = '') {
    return { uid: null, packetType, retry: false, data, encryptionKeyId: '', symmetricKey: '', iv: '', fiscalId, dataSignature: '' };
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs - TOKEN_SKEW_MS > this.now()) return this.token.value;
    const key = this.requirePrivateKey();
    const h = this.baseHeaders();
    const body = { time: 1, packet: this.syncPacket('GET_TOKEN', { username: this.cfg.settings.fiscalId }) };
    const signature = signSyncRequest(body, h, key);
    const { status, json } = await this.post('GET_TOKEN', API_PATHS.GET_TOKEN, { requestTraceId: h.requestTraceId, timestamp: String(h.timestamp) }, { ...body, signature });
    const data = json.result?.data;
    this.log({ kind: 'GET_TOKEN', ok: !!data?.token, requestTraceId: h.requestTraceId, httpStatus: status, errorCode: json.errors?.[0]?.errorCode });
    if (!data?.token) throw new MoodianTransportError('دریافت توکن از سامانه مودیان ناموفق بود', false, status);
    // expiresIn: در سند «ثانیه»، در نمونه «میلی‌ثانیه‌ی مطلق» — هر دو را می‌پذیریم. NEEDS-SANDBOX-VERIFICATION
    const exp = Number(data.expiresIn);
    const expiresAtMs = !Number.isFinite(exp) ? this.now() + 10 * 60_000 : exp > 1e11 ? exp : this.now() + exp * 1000;
    this.token = { value: String(data.token), expiresAtMs };
    return this.token.value;
  }

  /** فراخوانی همگام امضادار با توکن؛ فقط خواندنی‌ها و استعلام‌ها تا ۲ بار با traceId تازه تکرار می‌شوند. */
  private async syncCall(kind: string, path: string, packet: unknown, opts: { auth: boolean; sign: boolean }): Promise<Record<string, any>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const h = this.baseHeaders();
        const headers: Record<string, string> = { requestTraceId: h.requestTraceId, timestamp: String(h.timestamp) };
        if (opts.auth) headers.Authorization = `Bearer ${await this.getToken()}`;
        const body: Record<string, unknown> = { time: 1, packet };
        if (opts.sign) body.signature = signSyncRequest({ time: 1, packet }, h, this.requirePrivateKey());
        const { status, json } = await this.post(kind, path, headers, body);
        const errCode = json.errors?.[0]?.errorCode;
        this.log({ kind, ok: !json.errors, requestTraceId: h.requestTraceId, httpStatus: status, errorCode: errCode ? String(errCode) : undefined });
        if (json.errors) {
          // توکن منقضی → یک‌بار توکن تازه
          if (String(errCode) === '5015' && attempt === 0) {
            this.token = null;
            continue;
          }
          throw new MoodianTransportError(`${json.errors[0]?.errorDetail ?? 'خطا'} (${errCode})`, ['5000', '5010', '5011'].includes(String(errCode)), status);
        }
        return json;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof MoodianTransportError) || !e.transient) throw e;
      }
    }
    throw lastErr;
  }

  async getServerInformation(): Promise<MoodianServerInfo> {
    const json = await this.syncCall('GET_SERVER_INFORMATION', API_PATHS.GET_SERVER_INFORMATION, this.syncPacket('GET_SERVER_INFORMATION', null), { auth: false, sign: false });
    return json.result?.data as MoodianServerInfo;
  }

  async getFiscalInformation(): Promise<MoodianFiscalInfo> {
    const json = await this.syncCall('GET_FISCAL_INFORMATION', API_PATHS.GET_FISCAL_INFORMATION, this.syncPacket('GET_FISCAL_INFORMATION', null, this.cfg.settings.fiscalId ?? ''), { auth: true, sign: true });
    return (json.result?.data ?? {}) as MoodianFiscalInfo;
  }

  async inquiryByUid(uids: string[]): Promise<MoodianInquiryItem[]> {
    const fiscalId = this.cfg.settings.fiscalId ?? '';
    const packet = this.syncPacket('INQUIRY_BY_UID', uids.map((uid) => ({ uid, fiscalId })));
    const json = await this.syncCall('INQUIRY_BY_UID', API_PATHS.INQUIRY_BY_UID, packet, { auth: true, sign: true });
    return (json.result?.data ?? []) as MoodianInquiryItem[];
  }

  async inquiryByReferenceNumber(refs: string[]): Promise<MoodianInquiryItem[]> {
    const packet = this.syncPacket('INQUIRY_BY_REFERENCE_NUMBER', { referenceNumber: refs }, this.cfg.settings.fiscalId ?? '');
    const json = await this.syncCall('INQUIRY_BY_REFERENCE_NUMBER', API_PATHS.INQUIRY_BY_REFERENCE_NUMBER, packet, { auth: true, sign: true });
    return (json.result?.data ?? []) as MoodianInquiryItem[];
  }

  async sendInvoice(permit: SendPermit): Promise<MoodianSendResult> {
    // ۱) گارد سخت پیش از هر کار دیگر (حتی ساخت توکن)
    assertSendAllowed(this.cfg.settings, permit);
    const privateKey = this.requirePrivateKey();
    if (!this.cfg.serverPublicKey || !this.cfg.serverPublicKeyId) throw new SendRefusedError('NOT_CONFIGURED', 'کلید عمومی سازمان دریافت نشده است؛ ابتدا «دریافت کلید سرور» را بزنید');
    if (MAX_PACKETS_PER_REQUEST < 1) throw new SendRefusedError('NOT_CONFIGURED', 'پیکربندی نادرست');

    const enc = encryptInvoice(permit.invoice, { privateKey, serverPublicKey: this.cfg.serverPublicKey });
    const packet = {
      uid: permit.uid,
      packetType: PACKET_TYPE_INVOICE,
      retry: permit.retry,
      data: enc.data,
      encryptionKeyId: this.cfg.serverPublicKeyId,
      symmetricKey: enc.symmetricKey,
      iv: enc.iv,
      fiscalId: this.cfg.settings.fiscalId!,
      dataSignature: enc.dataSignature,
    };
    const h = this.baseHeaders();
    const token = await this.getToken();
    const signature = signAsyncRequest([packet], h, privateKey);
    const { status, json } = await this.post(
      'SEND',
      API_PATHS.SEND_NORMAL,
      { requestTraceId: h.requestTraceId, timestamp: String(h.timestamp), Authorization: `Bearer ${token}` },
      { packets: [packet], signature, signatureKeyId: this.cfg.signatureKeyId ?? null },
    );
    if (json.errors?.length) {
      const e = json.errors[0];
      this.log({ kind: 'SEND', ok: false, requestTraceId: h.requestTraceId, httpStatus: status, errorCode: String(e.errorCode ?? ''), summary: { uid: permit.uid, retry: permit.retry } });
      return { uid: permit.uid, referenceNumber: null, errorCode: String(e.errorCode ?? ''), errorDetail: e.errorDetail ?? null };
    }
    const r = (json.result?.[0] ?? {}) as Partial<MoodianSendResult>;
    this.log({ kind: 'SEND', ok: !r.errorCode, requestTraceId: h.requestTraceId, httpStatus: status, errorCode: r.errorCode ?? undefined, summary: { uid: permit.uid, retry: permit.retry, hasReference: !!r.referenceNumber } });
    return { uid: r.uid ?? permit.uid, referenceNumber: r.referenceNumber ?? null, errorCode: r.errorCode ? String(r.errorCode) : null, errorDetail: r.errorDetail ?? null };
  }
}

export class HttpMoodianClientFactory implements MoodianClientFactory {
  create(config: MoodianClientConfig): MoodianClient {
    return new HttpMoodianClient(config);
  }
}
