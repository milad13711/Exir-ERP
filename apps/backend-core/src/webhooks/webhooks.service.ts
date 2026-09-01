import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/control-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { WebhookEvent } from './webhook-events.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('WebhooksService');

  constructor(private readonly controlDb: ControlPrismaService) {}

  /**
   * Delivers `event` to every active subscription this tenant has for it.
   * Runs synchronously (awaited by the caller) rather than through a queue —
   * simple and correct for a first version; a slow/unreachable receiver
   * adds up to ~8s to the triggering request per subscription, which is an
   * acceptable trade-off until delivery volume justifies a real queue.
   */
  async dispatch(tenantId: string, event: WebhookEvent, payload: Prisma.InputJsonValue): Promise<void> {
    const subscriptions = await this.controlDb.webhookSubscription.findMany({
      where: { tenantId, isActive: true, events: { has: event } },
    });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

    await Promise.all(subscriptions.map((sub) => this.deliver(sub.id, sub.url, sub.secret, event, body, payload)));
  }

  private async deliver(
    webhookId: string,
    url: string,
    secret: string,
    event: string,
    body: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Exir-Signature': `sha256=${signature}` },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      await this.controlDb.webhookDelivery.create({
        data: {
          webhookId,
          event,
          payload,
          status: res.ok ? 'SUCCESS' : 'FAILED',
          responseStatus: res.status,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطای ناشناخته';
      this.logger.warn(`webhook delivery failed (${event} -> ${url}): ${message}`);
      await this.controlDb.webhookDelivery.create({
        data: { webhookId, event, payload, status: 'FAILED', error: message },
      });
    }
  }
}
