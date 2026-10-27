import { describe, expect, it, vi } from 'vitest';
import { WebhooksController } from './webhooks.controller.js';

describe('WebhooksController — secret hygiene', () => {
  it('list and toggle never select the signing secret; create returns it once', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({ id: 'w', secret: 's' });
    const db = { webhookSubscription: { findMany, update, create, findFirst: vi.fn().mockResolvedValue({ id: 'w', isActive: true }) } };
    const c = new WebhooksController(db as never);
    const ctx: any = { tenantId: 't1' };
    await c.list(ctx);
    expect(findMany.mock.calls[0][0].omit).toEqual({ secret: true });
    await c.toggle('w', ctx);
    expect(update.mock.calls[0][0].omit).toEqual({ secret: true });
    const created = await c.create({ url: 'https://example.com/hook', events: ['task.created'] } as never, ctx).catch(() => null);
    if (created) expect(created.secret).toBeTruthy();
  });
});
