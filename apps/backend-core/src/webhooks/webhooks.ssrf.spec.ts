import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

describe('webhooks — SSRF', () => {
  it('refuses to register webhook URLs that point at internal addresses', async () => {
    const create = vi.fn();
    const ctrl = new WebhooksController({ webhookSubscription: { create } } as never);
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:3001/api/admin/tenants', 'http://localhost/x', 'http://10.0.0.8/hook', 'http://[::1]/h']) {
      await expect(ctrl.create({ url, events: ['crm.deal.created'] } as never, { tenantId: 't1' } as never), url).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('delivery to an internal target (e.g. a subscription saved before this fix) is blocked and logged as FAILED without any request being made', async () => {
    const created: Array<Record<string, unknown>> = [];
    const controlDb = {
      webhookSubscription: { findMany: vi.fn().mockResolvedValue([{ id: 'w1', url: 'http://169.254.169.254/latest/meta-data/', secret: 's' }]) },
      webhookDelivery: { create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => created.push(data)) },
    };
    const svc = new WebhooksService(controlDb as never);
    await svc.dispatch('t1', 'crm.deal.created' as never, { id: 1 });
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('FAILED');
  });
});
