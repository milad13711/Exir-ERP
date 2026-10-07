import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { PublicFormsService } from './public-forms.service.js';
import { PublicFormsController } from './public-forms.controller.js';

const FORM = {
  id: 'internal-form-id',
  slug: 'lead',
  status: 'PUBLISHED',
  type: 'QUESTIONNAIRE',
  title: 'ثبت درخواست',
  description: 'd',
  coverImage: null,
  collectPhone: true,
  requirePhone: false,
  createContact: false,
  closesAt: null,
  passScorePercent: null,
  thankYouMessage: 'ممنون',
  createdByUserId: 'creator-1',
  allowedOrigins: [] as string[],
  fields: [
    { id: 'f1', type: 'SHORT_TEXT', label: 'نام', helpText: null, required: true, sortOrder: 0, options: [], correctOption: 'SECRET', points: 5 },
    { id: 'f2', type: 'SINGLE_CHOICE', label: 'نوع', helpText: null, required: false, sortOrder: 1, options: ['a', 'b'], correctOption: 'a', points: 3 },
  ],
};

function build(formOverrides: Partial<typeof FORM> = {}) {
  const form = { ...FORM, ...formOverrides };
  const created: Array<Record<string, unknown>> = [];
  const tenantDb = {
    form: { findUnique: vi.fn().mockResolvedValue(form) },
    formSubmission: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'sub-1', submittedAt: new Date('2026-01-01') };
      }),
    },
    crmContact: { findFirst: vi.fn(), create: vi.fn() },
  };
  const controlDb = {
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 't1', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'd' }) },
    tenantModule: { findFirst: vi.fn().mockResolvedValue({ id: 'm' }) },
  };
  const tenantPrisma = { forTenant: vi.fn().mockReturnValue(tenantDb) };
  const automation = { emit: vi.fn().mockResolvedValue(undefined) };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const webhooks = { dispatch: vi.fn().mockResolvedValue(undefined) };
  const service = new PublicFormsService(controlDb as never, tenantPrisma as never, automation as never, notifications as never, webhooks as never);
  const controller = new PublicFormsController(service);
  return { service, controller, tenantDb, created, notifications, webhooks, automation };
}
const res = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => (headers[k] = v),
    removeHeader: (k: string) => delete headers[k],
    vary: vi.fn(),
  };
};
const req = (origin?: string, ip = '1.2.3.4') => ({ headers: { origin, 'x-real-ip': ip }, ip }) as never;

describe('public forms: schema', () => {
  it('has a stable v1 shape and exposes no internal ids/secrets', async () => {
    const { service } = build();
    const schema = await service.getSchema('acme', 'lead');
    expect(schema.version).toBe(1);
    expect(schema.form).toEqual({ slug: 'lead', type: 'QUESTIONNAIRE', title: 'ثبت درخواست', description: 'd', isClosed: false, closesAt: null });
    expect(schema.fields[1]).toMatchObject({ name: 'f2', type: 'SINGLE_CHOICE', options: ['a', 'b'] });
    expect(schema.fields[0].options).toBeUndefined();
    expect(schema.submit.path).toBe('/api/public/forms/acme/lead/submit'); // کش publicKey در تست خالی است → همان slug
    const json = JSON.stringify(schema);
    for (const leak of ['internal-form-id', 'creator-1', 'SECRET', 'correctOption', 'points', 'allowedOrigins', 'internalNote']) expect(json).not.toContain(leak);
  });
});

describe('public forms: submit', () => {
  it('stores a valid submission with masked IP + source meta, then notifies creator and fires webhook', async () => {
    const { service, created, notifications, webhooks } = build();
    const r = await service.submit('acme', 'lead', { answers: { f1: 'علی' }, source: { url: 'https://site.test/page', utm: { utm_source: 'insta' } } }, { ip: '185.1.2.3', origin: 'https://site.test' });
    expect(r.submissionId).toBe('sub-1');
    expect(created[0]).toMatchObject({ sourceUrl: 'https://site.test/page', ipMasked: '185.1.2.x' });
    expect((created[0].sourceMeta as { utm: unknown }).utm).toEqual({ utm_source: 'insta' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'creator-1', link: '/forms?formId=internal-form-id&submissionId=sub-1' }));
    expect(webhooks.dispatch).toHaveBeenCalledWith('t1', 'forms.submission.created', expect.objectContaining({ submissionId: 'sub-1' }));
  });

  it('honeypot: fake success, nothing stored or sent', async () => {
    const { service, created, notifications } = build();
    const r = await service.submit('acme', 'lead', { answers: { f1: 'x' }, _hp: 'bot' });
    expect(r.submissionId).toBeNull();
    expect(created).toHaveLength(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('a failing notification never breaks the submission', async () => {
    const { service, notifications } = build();
    notifications.notify.mockRejectedValue(new Error('smtp down'));
    await expect(service.submit('acme', 'lead', { answers: { f1: 'x' } })).resolves.toMatchObject({ submissionId: 'sub-1' });
  });

  it('rejects invalid payloads before touching the DB', async () => {
    const { service, created } = build();
    await expect(service.submit('acme', 'lead', { answers: { f2: 'zzz' } })).rejects.toThrow();
    expect(created).toHaveLength(0);
  });

  it('unpublished forms are 404', async () => {
    const { service } = build({ status: 'DRAFT' });
    await expect(service.submit('acme', 'lead', { answers: { f1: 'x' } })).rejects.toThrow(/یافت نشد/);
  });
});

describe('public forms controller: CORS + rate limit', () => {
  it('unrestricted form: wildcard origin, no Vary', async () => {
    const { controller } = build();
    const r = res();
    await controller.schema('acme', 'lead', req('https://any.test'), r as never);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(r.headers['X-Exir-Forms-Api']).toBe('1');
  });

  it('restricted form: allowed origin is echoed with Vary; other origins get 403 and no ACAO', async () => {
    const { controller } = build({ allowedOrigins: ['https://shop.test'] });
    const ok = res();
    await controller.submit('acme', 'lead', { answers: { f1: 'x' } }, req('https://shop.test'), ok as never);
    expect(ok.headers['Access-Control-Allow-Origin']).toBe('https://shop.test');
    expect(ok.vary).toHaveBeenCalledWith('Origin');
    const bad = res();
    bad.headers['Access-Control-Allow-Origin'] = '*';
    await expect(controller.submit('acme', 'lead', { answers: { f1: 'x' } }, req('https://evil.test', '9.9.9.9'), bad as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(bad.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('per-IP rate limit returns 429 after 10 submits', async () => {
    const { controller } = build();
    for (let i = 0; i < 10; i++) await controller.submit('acme', 'lead', { answers: { f1: 'x' } }, req(undefined, '7.7.7.7'), res() as never);
    const err = await controller.submit('acme', 'lead', { answers: { f1: 'x' } }, req(undefined, '7.7.7.7'), res() as never).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    // IP دیگر تحت‌تأثیر نیست
    await expect(controller.submit('acme', 'lead', { answers: { f1: 'x' } }, req(undefined, '8.8.8.8'), res() as never)).resolves.toBeTruthy();
  });
});
