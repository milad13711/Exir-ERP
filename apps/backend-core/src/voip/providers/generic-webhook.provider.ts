import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VoipProviderRegistryService } from '../voip-provider-registry.service.js';
import type { CallEndedEvent, IncomingCallEvent, OriginateResult } from '../types.js';

/**
 * The provider for any PBX that can POST a custom webhook with a body it
 * controls — most self-hosted (Asterisk/FreePBX via a dialplan AGI/AMI
 * bridge) and many cloud panels support this even without a documented
 * public API. The tenant configures their PBX to POST here on an incoming
 * call, in this exact shape:
 *   { "event": "call.incoming", "from": "09121234567", "extension": "101", "callId": "..." }
 * and, if it can, on call end:
 *   { "event": "call.ended", "callId": "...", "duration": 42, "recordingUrl": "https://...", "status": "ANSWERED" }
 * Any other event value returns null from both parsers — reusable for a
 * PBX's other webhook events later without erroring on ones we don't act on.
 *
 * originateCall works the same way in reverse: the tenant points
 * `originateUrl` at their own dialplan trigger (e.g. an Asterisk AMI/ARI
 * bridge script), and we POST `{ fromExtension, toNumber }` to it — this is
 * honest because the endpoint and its contract are entirely the tenant's
 * own, unlike a closed-source cloud PBX whose API isn't publicly documented.
 */
@Injectable()
export class GenericWebhookVoipProvider implements OnModuleInit {
  private readonly logger = new Logger('GenericWebhookVoipProvider');

  constructor(private readonly registry: VoipProviderRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'generic-webhook',
      name: 'وب‌هوک عمومی (هر PBX با وب‌هوک قابل‌تنظیم)',
      configFields: [
        { key: 'originateUrl', label: 'آدرس تریگر تماس خروجی (اختیاری — برای تماس مستقیم از ERP)' },
      ],
      parseWebhook: (rawBody: unknown): IncomingCallEvent | null => {
        if (!rawBody || typeof rawBody !== 'object') return null;
        const body = rawBody as Record<string, unknown>;
        if (body.event !== 'call.incoming') return null;
        const fromNumber = typeof body.from === 'string' ? body.from : '';
        const toExtension = typeof body.extension === 'string' ? body.extension : '';
        const callId = typeof body.callId === 'string' ? body.callId : '';
        if (!fromNumber || !toExtension) return null;
        return { fromNumber, toExtension, callId };
      },
      parseCallEndedWebhook: (rawBody: unknown): CallEndedEvent | null => {
        if (!rawBody || typeof rawBody !== 'object') return null;
        const body = rawBody as Record<string, unknown>;
        if (body.event !== 'call.ended') return null;
        const callId = typeof body.callId === 'string' ? body.callId : '';
        if (!callId) return null;
        const durationSeconds = typeof body.duration === 'number' ? body.duration : undefined;
        const recordingUrl = typeof body.recordingUrl === 'string' ? body.recordingUrl : undefined;
        const status =
          body.status === 'ANSWERED' || body.status === 'MISSED' || body.status === 'NO_ANSWER' || body.status === 'FAILED'
            ? body.status
            : undefined;
        return { callId, durationSeconds, recordingUrl, status };
      },
      originateCall: async (config: Record<string, unknown>, fromExtension: string, toNumber: string): Promise<OriginateResult> => {
        const originateUrl = typeof config.originateUrl === 'string' ? config.originateUrl.trim() : '';
        if (!originateUrl) {
          return { success: false, error: 'آدرس تریگر تماس خروجی برای این سرویس تنظیم نشده است' };
        }
        try {
          const res = await fetch(originateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromExtension, toNumber }),
          });
          if (!res.ok) return { success: false, error: `تریگر تماس خروجی خطا داد (HTTP ${res.status})` };
          const data = (await res.json().catch(() => null)) as { callId?: string } | null;
          return { success: true, callId: data?.callId };
        } catch (err) {
          this.logger.error(`originateCall failed: ${err instanceof Error ? err.message : err}`);
          return { success: false, error: 'ارتباط با تریگر تماس خروجی برقرار نشد' };
        }
      },
    });
  }
}
