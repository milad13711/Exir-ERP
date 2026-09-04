import { Injectable, OnModuleInit } from '@nestjs/common';
import { VoipProviderRegistryService } from '../voip-provider-registry.service.js';
import type { IncomingCallEvent } from '../types.js';

/**
 * The provider for any PBX that can POST a custom webhook with a body it
 * controls — most self-hosted (Asterisk/FreePBX via a dialplan AGI/AMI
 * bridge) and many cloud panels support this even without a documented
 * public API. The tenant configures their PBX to POST here on an incoming
 * call, in this exact shape:
 *   { "event": "call.incoming", "from": "09121234567", "extension": "101", "callId": "..." }
 * A "call.ended" (or any other) event value returns null — this endpoint
 * is meant to be reusable for a PBX's other webhook events later without
 * erroring on ones we don't act on yet.
 */
@Injectable()
export class GenericWebhookVoipProvider implements OnModuleInit {
  constructor(private readonly registry: VoipProviderRegistryService) {}

  onModuleInit(): void {
    this.registry.register({
      code: 'generic-webhook',
      name: 'وب‌هوک عمومی (هر PBX با وب‌هوک قابل‌تنظیم)',
      configFields: [],
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
    });
  }
}
