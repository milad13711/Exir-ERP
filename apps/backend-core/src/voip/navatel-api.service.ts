import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { normalizeNavatelToken } from './providers/novatel.provider.js';

const BASE = 'https://navaphone.com';

export type NavatelCdrFilters = { from?: string; to?: string; caller?: string; destination?: string; callType?: string; offset?: number; limit?: number };

export type NavatelCdrItem = {
  id: string;
  caller: string;
  destination: string;
  callType: string;
  setupTime: string;
  durationSeconds: number;
  waitingSeconds: number;
  cause: string | null;
  recPath: string | null;
  didNumber: string | null;
};

/**
 * کلاینت APIهای گزارش نواتل (CCaaS API v4.1.2) — رکورد مکالمات، آمار اپراتورها، تماس‌های از دست رفته،
 * دانلود ضبط مکالمه و پیام‌های صوتی. ساختار پاسخ‌ها با تماس واقعی روی حساب تأیید شده است.
 */
@Injectable()
export class NavatelApiService {
  private async credentials(ctx: TenantRequestContext): Promise<{ token: string; tenantKey: string }> {
    const config = await ctx.tenantDb.voipProviderConfig.findFirst({ where: { providerCode: 'novatel', isActive: true } });
    const cfg = (config?.config ?? {}) as Record<string, unknown>;
    const token = normalizeNavatelToken(cfg.apiToken);
    if (!token) throw new BadRequestException('توکن API نواتل در تنظیمات VoIP وارد نشده است');
    const tenantKey = typeof cfg.sipDomain === 'string' && cfg.sipDomain.trim() ? cfg.sipDomain.trim() : 'navaphone.com';
    return { token, tenantKey };
  }

  private async call(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: init.method ?? 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      throw new BadGatewayException(`اتصال به نواتل ناموفق بود: ${err instanceof Error ? err.message : 'خطای ناشناخته'}`);
    }
    const text = await res.text();
    if (!res.ok) throw new BadGatewayException(`نواتل خطا داد (HTTP ${res.status}): ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new BadGatewayException('پاسخ نواتل قابل خواندن نبود');
    }
  }

  private range(f: { from?: string; to?: string }) {
    const today = new Date().toISOString().slice(0, 10);
    return { from_date: f.from ?? `${today} 00:00:00`, to_date: f.to ?? `${today} 23:59:59` };
  }

  async cdr(ctx: TenantRequestContext, f: NavatelCdrFilters): Promise<{ total: number; items: NavatelCdrItem[] }> {
    const { token, tenantKey } = await this.credentials(ctx);
    const offset = Math.max(0, f.offset ?? 0);
    const data = (await this.call(token, `/cdr/api/v2/cdr/cdrFullLogs/${encodeURIComponent(tenantKey)}/${offset}`, {
      body: {
        ...this.range(f),
        destination: f.destination ?? '',
        caller: f.caller ?? '',
        call_type: f.callType ?? '',
        limit: Math.min(f.limit ?? 20, 100),
      },
    })) as { totalCnt?: number; cdrs?: Array<Record<string, unknown>> };
    const items = (data.cdrs ?? []).map((r) => ({
      id: String(r.x_cid ?? r.id ?? ''),
      caller: String(r.caller ?? ''),
      destination: String(r.destination ?? ''),
      callType: String(r.call_type ?? ''),
      setupTime: String(r.setup_time ?? ''),
      durationSeconds: Number(r.usge ?? 0) || 0,
      waitingSeconds: Number(r.waitingTime ?? 0) || 0,
      cause: typeof r.disconnectionCause === 'string' ? r.disconnectionCause : null,
      recPath: typeof r.rec_path === 'string' && r.rec_path ? r.rec_path : null,
      didNumber: typeof r.didNumber === 'string' && r.didNumber ? r.didNumber : null,
    }));
    return { total: data.totalCnt ?? items.length, items };
  }

  async operatorStats(ctx: TenantRequestContext, f: { from?: string; to?: string }) {
    const { token } = await this.credentials(ctx);
    const rows = (await this.call(token, '/cdr/api/v1/cdr/operator/stats', {
      body: { ...this.range(f), destination: '', queueID: '' },
    })) as Array<Record<string, unknown>>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      operator: String(r.operator ?? ''),
      internalCalls: Number(r.internalCallsCount ?? 0) || 0,
      internalSeconds: Number(r.internalCallsDuration ?? 0) || 0,
      externalCalls: Number(r.exteranlCallsCount ?? 0) || 0,
      externalSeconds: Number(r.externalCallsDuration ?? 0) || 0,
      respondPercent: Number(r.internalRespondPercent ?? 0) || 0,
    }));
  }

  async missedCalls(ctx: TenantRequestContext, f: { from?: string; to?: string; offset?: number; limit?: number }) {
    const { token } = await this.credentials(ctx);
    const data = (await this.call(token, `/cdr/api/v1/cdr/canceled/noanswer/cumulative/${Math.max(0, f.offset ?? 0)}`, {
      body: { call_type: 'in', ...this.range(f), limit: Math.min(f.limit ?? 20, 100) },
    })) as { TotalCount?: Array<{ Count?: number }>; Data?: Array<Record<string, unknown>> };
    const items = (data.Data ?? []).map((r) => ({
      id: String((r.id as { x_cid?: string } | undefined)?.x_cid ?? ''),
      caller: String(r.caller ?? ''),
      queueName: typeof r.queueName === 'string' ? r.queueName : null,
      causes: Array.isArray(r.disconnectionCause) ? (r.disconnectionCause as string[]) : [],
      attempts: Number(r.count ?? 1) || 1,
      setupTime: Number(r.setup_time ?? 0) || 0,
      status: typeof r.missedcall_status === 'string' ? r.missedcall_status : null,
    }));
    return { total: data.TotalCount?.[0]?.Count ?? items.length, items };
  }

  async voicemails(ctx: TenantRequestContext) {
    const { token } = await this.credentials(ctx);
    const rows = (await this.call(token, '/ipbx/api/v1/voice-mail', { method: 'GET' })) as Array<Record<string, unknown>>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      uuid: String(r.voicemail_uuid ?? ''),
      boxId: String(r.voicemail_id ?? ''),
      email: typeof r.voicemail_mail_to === 'string' ? r.voicemail_mail_to : null,
      enabled: String(r.voicemail_enabled) === 'true',
    }));
  }

  async voicemailMessages(ctx: TenantRequestContext, uuid: string) {
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) throw new BadRequestException('شناسه‌ی صندوق صوتی نامعتبر است');
    const { token } = await this.credentials(ctx);
    const rows = (await this.call(token, `/ipbx/api/v1/voice-mail/${uuid}/message`, { method: 'GET' })) as Array<Record<string, unknown>>;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      uuid: String(r.voicemail_message_uuid ?? ''),
      createdAt: new Date(Number(r.created_epoch ?? 0) * 1000).toISOString(),
      callerName: typeof r.caller_id_name === 'string' ? r.caller_id_name : null,
      callerNumber: String(r.caller_id_number ?? ''),
      lengthSeconds: Number(r.message_length ?? 0) || 0,
    }));
  }

  /** فایل صوتی (ضبط مکالمه یا پیام صوتی) با هدر Authorization — مرورگر مستقیم نمی‌تواند این هدر را بفرستد، پس از همین‌جا عبور می‌کند. */
  async download(ctx: TenantRequestContext, fileName: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!/^[\w.-]{1,120}\.(mp3|wav)$/i.test(fileName)) throw new BadRequestException('نام فایل نامعتبر است');
    const { token } = await this.credentials(ctx);
    let res: Response;
    try {
      res = await fetch(`${BASE}/ipbx/api/v1/download/${fileName}`, { headers: { Authorization: token }, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new BadGatewayException(`اتصال به نواتل ناموفق بود: ${err instanceof Error ? err.message : 'خطای ناشناخته'}`);
    }
    if (res.status === 404) throw new NotFoundException('فایل صوتی یافت نشد');
    if (!res.ok) throw new BadGatewayException(`نواتل خطا داد (HTTP ${res.status})`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? (fileName.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'),
    };
  }
}
