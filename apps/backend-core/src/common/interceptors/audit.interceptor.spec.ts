import { describe, expect, it, vi } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor.js';

async function run(method: string, path: string, withCtx = true) {
  const create = vi.fn().mockResolvedValue({});
  const ctx = withCtx ? { auth: { sub: 'g1' }, tenantDb: { user: { findFirst: vi.fn().mockResolvedValue({ id: 'u1' }) }, activityLog: { create } } } : undefined;
  const http = { getRequest: () => ({ method, path, ctx }) };
  const context = { switchToHttp: () => http } as never;
  await lastValueFrom(new AuditInterceptor().intercept(context, { handle: () => of(1) }));
  await new Promise((r) => setTimeout(r, 5));
  return create;
}

describe('AuditInterceptor', () => {
  it('logs deletes with module.entity.verb and the record id', async () => {
    const create = await run('DELETE', '/api/crm/contacts/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'crm.contacts.deleted', entityId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', userId: 'u1' }) });
  });

  it('labels action-style POSTs (void/cancel/approve) precisely', async () => {
    const create = await run('POST', '/api/accounting/entries/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/void');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'accounting.entries.voided' }) });
  });

  it('does not treat mentoring as the ignored "me" prefix, but skips auth and public', async () => {
    expect(await run('POST', '/api/mentoring/sessions')).toHaveBeenCalled();
    expect(await run('POST', '/api/auth/otp/request')).not.toHaveBeenCalled();
    expect(await run('POST', '/api/public/booking/x/appointments')).not.toHaveBeenCalled();
  });

  it('never logs reads or unauthenticated requests', async () => {
    expect(await run('GET', '/api/crm/contacts')).not.toHaveBeenCalled();
    expect(await run('DELETE', '/api/crm/contacts/1', false)).not.toHaveBeenCalled();
  });
});
