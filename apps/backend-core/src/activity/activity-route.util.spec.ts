import { describe, expect, it } from 'vitest';
import { describeRoute } from './activity-route.util.js';

describe('describeRoute', () => {
  it('maps verbs and labels', () => {
    expect(describeRoute('POST', '/api/sales/invoices', '/api/sales/invoices')).toMatchObject({ moduleCode: 'sales', actionType: 'create', summary: 'ایجاد فاکتور فروش' });
    expect(describeRoute('PATCH', '/api/tasks/:id', '/api/tasks/42')).toMatchObject({ moduleCode: 'tasks', actionType: 'update', entityId: '42', summary: 'ویرایش وظیفه' });
    expect(describeRoute('POST', '/api/purchasing/orders/:id/approve', '/api/purchasing/orders/7/approve')).toMatchObject({ actionType: 'approve', action: 'purchasing.orders.approved', summary: 'تأیید سفارش خرید' });
  });
  it('falls back sensibly for unknown routes', () => {
    const d = describeRoute('POST', '/api/new-thing/stuff', '/api/new-thing/stuff')!;
    expect(d.moduleCode).toBe('new-thing');
    expect(d.summary).toContain('stuff');
  });
  it('excludes reads and noise', () => {
    expect(describeRoute('GET', '/api/sales/invoices', '/api/sales/invoices')).toBeNull();
    expect(describeRoute('POST', '/api/auth/otp/verify', '/api/auth/otp/verify')).toBeNull();
    expect(describeRoute('POST', '/api/logs/x', '/api/logs/x')).toBeNull();
  });
});
