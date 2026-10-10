import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PROJECT_SMS,
  MAX_TEMPLATE_LENGTH,
  mergeStoredSettings,
  parseSettingsInput,
  renderProjectSms,
  validateTemplate,
} from './project-sms.template.js';
import { ProjectSmsService, isMobilePhone, sanitizeManualMessage, selectProjectLink, DAY_MS } from './project-sms.service.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { makeDelegate } from './testing/fake-db.js';

type Row = Record<string, unknown>;

const FULL = { name: 'علی', project: 'پروژه‌ی من', stage: 'طراحی', percent: 40, done: 2, total: 5, link: 'https://x.ir/project/tabc/tok', company: 'اکسیر', phone: '021' };

describe('renderProjectSms', () => {
  it('fills whitelisted placeholders with Persian digits and keeps the link ASCII', () => {
    const out = renderProjectSms('{name} {project} {stage} {percent}٪ {done}/{total} {company} {phone} {link}', FULL);
    expect(out).toBe('علی پروژه‌ی من طراحی ۴۰٪ ۲/۵ اکسیر 021 https://x.ir/project/tabc/tok');
  });
  it('strips unknown placeholders and never evaluates anything', () => {
    const out = renderProjectSms('a {budget} b {constructor} c ${1+1} d', FULL);
    expect(out).not.toContain('budget');
    expect(out).not.toContain('constructor');
    expect(out).toBe('a b c ${1+1} d');
  });
  it('values cannot re-inject placeholders, brackets or html', () => {
    const out = renderProjectSms('{project} / {name}', { ...FULL, project: '{link}[[x]]<b>hi</b>', name: '<script>x</script>' });
    expect(out).not.toMatch(/[{}[\]<>]/);
  });
  it('[[optional]] block is kept with a link and dropped without one', () => {
    const t = 'پیشرفت {percent}٪.[[ مشاهده: {link}]]';
    expect(renderProjectSms(t, FULL)).toBe('پیشرفت ۴۰٪. مشاهده: https://x.ir/project/tabc/tok');
    expect(renderProjectSms(t, { ...FULL, link: '' })).toBe('پیشرفت ۴۰٪.');
  });
  it('cleans a dangling label when the template has no [[ ]] block', () => {
    expect(renderProjectSms('پروژه تکمیل شد. مشاهده: {link}', { ...FULL, link: '' })).toBe('پروژه تکمیل شد.');
    expect(renderProjectSms('پروژه تکمیل شد.\nجزئیات: {link}', { ...FULL, link: '' })).toBe('پروژه تکمیل شد.');
  });
  it('rejects non-http links and control chars', () => {
    expect(renderProjectSms('{link}', { ...FULL, link: 'javascript:alert(1)' })).toBe('');
    expect(renderProjectSms('a\u0000b‮{name}', FULL)).toBe('abعلی');
  });
  it('default templates render sensibly with and without link', () => {
    for (const e of Object.values(DEFAULT_PROJECT_SMS.events)) {
      expect(renderProjectSms(e.template, FULL)).toContain('https://');
      const bare = renderProjectSms(e.template, { ...FULL, link: '' });
      expect(bare).not.toMatch(/مشاهده|جزئیات|\{|\[\[/);
    }
  });
});

describe('settings validation', () => {
  it('limits length, rejects html/non-string/unknown placeholders/control chars', () => {
    expect(() => validateTemplate('x'.repeat(MAX_TEMPLATE_LENGTH + 1), 't')).toThrow(BadRequestException);
    expect(validateTemplate('x'.repeat(MAX_TEMPLATE_LENGTH), 't')).toHaveLength(MAX_TEMPLATE_LENGTH);
    expect(() => validateTemplate('<b>x</b>', 't')).toThrow(BadRequestException);
    expect(() => validateTemplate(5, 't')).toThrow(BadRequestException);
    expect(() => validateTemplate('hi {budget}', 't')).toThrow(BadRequestException);
    expect(() => validateTemplate('hi\u0001', 't')).toThrow(BadRequestException);
    expect(() => validateTemplate('   ', 't')).toThrow(BadRequestException);
  });
  it('parseSettingsInput merges onto the base and rejects bad shapes / unknown events / bad caps', () => {
    const out = parseSettingsInput({ enabled: true, events: { stageCompleted: { enabled: false } } });
    expect(out.enabled).toBe(true);
    expect(out.events.stageCompleted.enabled).toBe(false);
    expect(out.events.stageCompleted.template).toBe(DEFAULT_PROJECT_SMS.events.stageCompleted.template);
    expect(() => parseSettingsInput({ events: { hack: { enabled: true } } })).toThrow(BadRequestException);
    expect(() => parseSettingsInput({ maxPerProjectPerDay: 0 })).toThrow(BadRequestException);
    expect(() => parseSettingsInput({ maxPerTenantPerDay: '9' })).toThrow(BadRequestException);
    expect(() => parseSettingsInput({ enabled: 'yes' })).toThrow(BadRequestException);
    expect(() => parseSettingsInput([])).toThrow(BadRequestException);
  });
  it('defaults: master OFF; corrupt stored values fall back to defaults', () => {
    expect(DEFAULT_PROJECT_SMS.enabled).toBe(false);
    const m = mergeStoredSettings({ enabled: true, manualTemplate: '<b>', events: { stageStarted: { template: 'hi {nope}', enabled: false } } });
    expect(m.enabled).toBe(true);
    expect(m.manualTemplate).toBe(DEFAULT_PROJECT_SMS.manualTemplate);
    expect(m.events.stageStarted.template).toBe(DEFAULT_PROJECT_SMS.events.stageStarted.template);
    expect(m.events.stageStarted.enabled).toBe(false);
  });
});

describe('link selection', () => {
  it('enabled public link -> direct project url; disabled -> empty (never the token)', () => {
    const on = selectProjectLink({ publicEnabled: true, publicToken: 'TOK123' }, 'https://p.ir/', 'slug');
    expect(on).toMatch(/^https:\/\/p\.ir\/project\/[^/]+\/TOK123$/);
    expect(selectProjectLink({ publicEnabled: false, publicToken: 'TOK123' }, 'https://p.ir', 'slug')).toBe('');
    expect(selectProjectLink({ publicEnabled: true, publicToken: 'TOK123' }, '', 'slug')).toBe('');
  });
  it('isMobilePhone', () => {
    expect(isMobilePhone('09123456789')).toBe(true);
    expect(isMobilePhone('+98 912 345 6789')).toBe(true);
    expect(isMobilePhone('۰۹۱۲۳۴۵۶۷۸۹')).toBe(true);
    expect(isMobilePhone('02112345678')).toBe(false);
    expect(isMobilePhone(null)).toBe(false);
  });
});

function setup(opts: { settings?: Row; project?: Row; contact?: Row | null; sms?: { success: boolean; error?: string } | 'throw'; stages?: Row[] } = {}) {
  const projects: Row[] = [{ id: 'p1', name: 'پروژه', contactId: 'c1', status: 'ACTIVE', publicEnabled: true, publicToken: 'TOKEN-AAAA', notifyCustomerBySms: null, ...opts.project }];
  const contacts: Row[] = opts.contact === null ? [] : [{ id: 'c1', name: 'مشتری', phone: '09123456789', ...opts.contact }];
  const stages: Row[] = opts.stages ?? [
    { id: 's1', projectId: 'p1', title: 'مرحله ۱', status: 'DONE' },
    { id: 's2', projectId: 'p1', title: 'مرحله ۲', status: 'IN_PROGRESS' },
  ];
  const settings: Row = { enabled: true, ...opts.settings };
  const logs: Row[] = [];
  const logDelegate = makeDelegate(logs);
  const origCreate = logDelegate.create;
  logDelegate.create = async (args: { data: Row }) => {
    if (args.data.dedupeKey && logs.some((l) => l.dedupeKey === args.data.dedupeKey)) throw new Error('unique');
    return origCreate(args);
  };
  const notes: Row[] = [];
  const crm: Row[] = [];
  const tenantDb = {
    project: { ...makeDelegate(projects), updateMany: makeDelegate(projects).updateMany },
    crmContact: makeDelegate(contacts),
    projectStage: makeDelegate(stages),
    projectSmsLog: logDelegate,
    projectNote: makeDelegate(notes),
    crmActivity: makeDelegate(crm),
    moduleSetting: {
      findUnique: vi.fn(async ({ where }: { where: { moduleCode_key: { moduleCode: string; key: string } } }) => {
        const k = where.moduleCode_key;
        if (k.moduleCode === 'projects' && k.key === 'sms') return { value: settings };
        if (k.moduleCode === 'general' && k.key === 'phone') return { value: '02111111111' };
        return null;
      }),
      upsert: vi.fn(async ({ update }: { update: { value: Row } }) => {
        Object.assign(settings, update.value);
        return { value: settings };
      }),
    },
    user: { findUnique: vi.fn(async () => ({ id: 'me' })) },
  };
  const sendSms = vi.fn(async () => {
    if (opts.sms === 'throw') throw new Error('gateway down');
    return opts.sms ?? { success: true };
  });
  const controlDb = { tenant: { findUnique: vi.fn(async () => ({ name: 'شرکت' })) } };
  const svc = new ProjectSmsService({ sendSms } as never, controlDb as never);
  const ctx = { auth: { sub: 'g' }, tenantId: 't1', tenantSlug: 'slug', tenantDb } as never;
  return { svc, ctx, sendSms, logs, notes, crm, settings, projects };
}

describe('trigger matrix (notifyEvent)', () => {
  it('sends when master+event+project+phone are all OK; message has progress and link; logs + activity note', async () => {
    process.env.WEB_PANEL_PUBLIC_URL = 'https://panel.test';
    const { svc, ctx, sendSms, notes, logs } = setup();
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1')).toBe('SENT');
    expect(sendSms).toHaveBeenCalledTimes(1);
    const [, phone, msg] = sendSms.mock.calls[0] as unknown as [unknown, string, string];
    expect(phone).toBe('09123456789');
    expect(msg).toContain('مرحله ۱');
    expect(msg).toContain('۵۰٪');
    expect(msg).toContain('https://panel.test/project/');
    expect(msg).toContain('TOKEN-AAAA');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 'SENT', mode: 'AUTO', event: 'STAGE_COMPLETED' });
    expect(notes[0]).toMatchObject({ source: 'SMS', visibleToCustomer: false });
    expect(String(notes[0].body)).not.toContain('09123456789');
  });
  it('project with public link OFF: no link and no token in the sms', async () => {
    process.env.WEB_PANEL_PUBLIC_URL = 'https://panel.test';
    const { svc, ctx, sendSms } = setup({ project: { publicEnabled: false } });
    await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1');
    const msg = (sendSms.mock.calls[0] as unknown as [unknown, string, string])[2];
    expect(msg).not.toContain('TOKEN-AAAA');
    expect(msg).not.toContain('http');
    expect(msg).not.toContain('مشاهده');
  });
  it('master off -> nothing', async () => {
    const { svc, ctx, sendSms } = setup({ settings: { enabled: false } });
    expect(await svc.notifyEvent(ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_MASTER_OFF');
    expect(sendSms).not.toHaveBeenCalled();
  });
  it('default settings (nothing stored) = master off', async () => {
    const { svc, ctx, sendSms, settings } = setup();
    for (const k of Object.keys(settings)) delete settings[k];
    expect(await svc.notifyEvent(ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_MASTER_OFF');
    expect(sendSms).not.toHaveBeenCalled();
  });
  it('event off -> nothing (and status-change events are off by default)', async () => {
    const a = setup({ settings: { events: { stageStarted: { enabled: false } } } });
    expect(await a.svc.notifyEvent(a.ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_EVENT_OFF');
    const b = setup();
    expect(await b.svc.notifyEvent(b.ctx, 'p1', 'projectOnHold')).toBe('SKIP_EVENT_OFF');
    expect(a.sendSms).not.toHaveBeenCalled();
    expect(b.sendSms).not.toHaveBeenCalled();
  });
  it('per-project off -> nothing; per-project on / null follow master', async () => {
    const off = setup({ project: { notifyCustomerBySms: false } });
    expect(await off.svc.notifyEvent(off.ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_PROJECT_OFF');
    const on = setup({ project: { notifyCustomerBySms: true } });
    expect(await on.svc.notifyEvent(on.ctx, 'p1', 'stageStarted', 's2')).toBe('SENT');
  });
  it('no contact / no mobile phone -> nothing', async () => {
    const nc = setup({ contact: null });
    expect(await nc.svc.notifyEvent(nc.ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_NO_CONTACT');
    const np = setup({ contact: { phone: '02112345678' } });
    expect(await np.svc.notifyEvent(np.ctx, 'p1', 'stageStarted', 's2')).toBe('SKIP_NO_PHONE');
    expect(nc.sendSms).not.toHaveBeenCalled();
    expect(np.sendSms).not.toHaveBeenCalled();
  });
  it('duplicate (project, stage, event) within 10 min is skipped; different stage/event is not; sequential and concurrent', async () => {
    const { svc, ctx, sendSms } = setup();
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1')).toBe('SENT');
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1')).toBe('SKIP_DUPLICATE');
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's2')).toBe('SENT');
    expect(sendSms).toHaveBeenCalledTimes(2);
    const c = setup();
    const res = await Promise.all([c.svc.notifyEvent(c.ctx, 'p1', 'stageStarted', 's2'), c.svc.notifyEvent(c.ctx, 'p1', 'stageStarted', 's2')]);
    expect(res.filter((r) => r === 'SENT')).toHaveLength(1);
    expect(c.sendSms).toHaveBeenCalledTimes(1);
  });
  it('an old log (>10 min) does not block a resend', async () => {
    const { svc, ctx, logs, sendSms } = setup();
    logs.push({ id: 'old', projectId: 'p1', stageId: 's1', event: 'STAGE_COMPLETED', mode: 'AUTO', status: 'SENT', createdAt: new Date(Date.now() - 11 * 60_000) });
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1')).toBe('SENT');
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
  it('per-project daily cap and tenant-wide cap', async () => {
    const p = setup({ settings: { maxPerProjectPerDay: 2 } });
    for (let i = 0; i < 2; i++) p.logs.push({ id: `l${i}`, projectId: 'p1', stageId: `x${i}`, event: 'STAGE_STARTED', mode: 'AUTO', status: 'SENT', createdAt: new Date(Date.now() - 3600_000) });
    expect(await p.svc.notifyEvent(p.ctx, 'p1', 'stageCompleted', 's1')).toBe('SKIP_PROJECT_CAP');
    const t = setup({ settings: { maxPerTenantPerDay: 3 } });
    for (let i = 0; i < 3; i++) t.logs.push({ id: `l${i}`, projectId: `other${i}`, stageId: null, event: 'STAGE_STARTED', mode: 'AUTO', status: 'SENT', createdAt: new Date() });
    expect(await t.svc.notifyEvent(t.ctx, 'p1', 'stageCompleted', 's1')).toBe('SKIP_TENANT_CAP');
    expect(p.sendSms).not.toHaveBeenCalled();
    expect(t.sendSms).not.toHaveBeenCalled();
    // entries older than 24h do not count
    const o = setup({ settings: { maxPerProjectPerDay: 1 } });
    o.logs.push({ id: 'o', projectId: 'p1', stageId: 'x', event: 'STAGE_STARTED', mode: 'AUTO', status: 'SENT', createdAt: new Date(Date.now() - DAY_MS - 1000) });
    expect(await o.svc.notifyEvent(o.ctx, 'p1', 'stageCompleted', 's1')).toBe('SENT');
  });
  it('manual sends do not count toward the automatic cap', async () => {
    const { svc, ctx, logs } = setup({ settings: { maxPerProjectPerDay: 1 } });
    logs.push({ id: 'm', projectId: 'p1', stageId: null, event: 'MANUAL', mode: 'MANUAL', status: 'SENT', createdAt: new Date() });
    expect(await svc.notifyEvent(ctx, 'p1', 'stageCompleted', 's1')).toBe('SENT');
  });
  it('gateway failure / throw is swallowed and recorded; never rejects', async () => {
    const f = setup({ sms: { success: false, error: 'اعتبار تمام شد' } });
    expect(await f.svc.notifyEvent(f.ctx, 'p1', 'stageCompleted', 's1')).toBe('FAILED');
    expect(f.logs[0]).toMatchObject({ status: 'FAILED', error: 'اعتبار تمام شد' });
    expect(String(f.notes[0].body)).toContain('ناموفق');
    const t = setup({ sms: 'throw' });
    await expect(t.svc.notifyEvent(t.ctx, 'p1', 'stageCompleted', 's1')).resolves.toBe('FAILED');
    expect(t.notes.length).toBeGreaterThan(0);
  });
});

describe('failure isolation in ProjectsService', () => {
  function make(smsImpl: () => Promise<unknown>) {
    const stages: Row[] = [{ id: 's1', projectId: 'p1', title: 'م', order: 0, status: 'IN_PROGRESS', requiresManagerApproval: false, links: [] }];
    const projects: Row[] = [{ id: 'p1', name: 'پروژه', managerUserId: 'mgr', status: 'ACTIVE', stages }];
    const tenantDb = { projectStage: makeDelegate(stages), project: { ...makeDelegate(projects), findUnique: async () => projects[0], update: async (a: { data: Row }) => Object.assign(projects[0], a.data) }, attachment: makeDelegate([]), user: { findUnique: vi.fn(async () => ({ id: 'actor' })) } };
    const notifyEvent = vi.fn(smsImpl);
    const svc = new ProjectsService({ emit: vi.fn() } as never, { registerHandler: vi.fn(), closeForEntity: vi.fn(), request: vi.fn() } as never, { notify: vi.fn() } as never, { notifyEvent } as never);
    return { svc, notifyEvent, stages, ctx: { auth: { sub: 'g' }, tenantDb } as never };
  }
  it('stage completion succeeds and fires the event even if the SMS promise rejects', async () => {
    const { svc, notifyEvent, stages, ctx } = make(async () => {
      throw new Error('boom');
    });
    await expect(svc.completeStage(ctx, 'p1', 's1', undefined)).resolves.toBeTruthy();
    await Promise.all([...svc.pendingSms]);
    expect(stages[0].status).toBe('DONE');
    expect(notifyEvent).toHaveBeenCalledWith(ctx, 'p1', 'stageCompleted', 's1');
  });
  it('request-start (approval OFF) fires stageStarted; project hold/complete/cancel fire status events', async () => {
    const a = make(async () => 'SENT');
    a.stages[0].status = 'PENDING';
    await a.svc.requestStageStart(a.ctx, 'p1', 's1');
    expect(a.notifyEvent).toHaveBeenCalledWith(a.ctx, 'p1', 'stageStarted', 's1');
    const b = make(async () => 'SENT');
    await b.svc.hold(b.ctx, 'p1');
    expect(b.notifyEvent).toHaveBeenCalledWith(b.ctx, 'p1', 'projectOnHold', undefined);
  });
  it('approval-driven start fires stageStarted', async () => {
    const a = make(async () => 'SENT');
    a.stages[0].status = 'AWAITING_APPROVAL';
    a.stages[0].requiresManagerApproval = true;
    await a.svc.approveStage(a.ctx, 'p1', 's1', true);
    expect(a.notifyEvent).toHaveBeenCalledWith(a.ctx, 'p1', 'stageStarted', 's1');
  });
});

describe('manual send', () => {
  it('sends only to the project contact phone, with the edited text; records note + crm history + log', async () => {
    const { svc, ctx, sendSms, notes, crm, logs } = setup();
    const out = await svc.manualSend(ctx, 'p1', '  سلام <b>مشتری</b>\n\n\n\nپیشرفت ۵۰٪  ');
    expect(out.ok).toBe(true);
    const [, phone, msg] = sendSms.mock.calls[0] as unknown as [unknown, string, string];
    expect(phone).toBe('09123456789');
    expect(msg).toBe('سلام مشتری\n\nپیشرفت ۵۰٪');
    expect(notes[0]).toMatchObject({ source: 'SMS', authorUserId: 'me' });
    expect(crm).toHaveLength(1);
    expect(logs[0]).toMatchObject({ mode: 'MANUAL', status: 'SENT' });
  });
  it('validation: empty, too long, non-string, no contact, no mobile', async () => {
    const a = setup();
    await expect(a.svc.manualSend(a.ctx, 'p1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(a.svc.manualSend(a.ctx, 'p1', 'x'.repeat(501))).rejects.toBeInstanceOf(BadRequestException);
    await expect(a.svc.manualSend(a.ctx, 'p1', { to: '0912' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(a.svc.manualSend(a.ctx, 'nope', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    const nc = setup({ contact: null });
    await expect(nc.svc.manualSend(nc.ctx, 'p1', 'hi')).rejects.toBeInstanceOf(BadRequestException);
    const np = setup({ contact: { phone: '021' } });
    await expect(np.svc.manualSend(np.ctx, 'p1', 'hi')).rejects.toBeInstanceOf(BadRequestException);
    expect(a.sendSms).not.toHaveBeenCalled();
    expect(nc.sendSms).not.toHaveBeenCalled();
    expect(np.sendSms).not.toHaveBeenCalled();
  });
  it('rate limit: 10 per hour per user, then 429', async () => {
    const { svc, ctx, sendSms } = setup();
    for (let i = 0; i < 10; i++) await svc.manualSend(ctx, 'p1', `پیام ${i}`);
    await expect(svc.manualSend(ctx, 'p1', 'یازدهم')).rejects.toBeInstanceOf(HttpException);
    expect(sendSms).toHaveBeenCalledTimes(10);
  });
  it('gateway failure is reported to the user (400) and logged as FAILED', async () => {
    const { svc, ctx, logs } = setup({ sms: { success: false, error: 'اعتبار کافی نیست' } });
    await expect(svc.manualSend(ctx, 'p1', 'hi')).rejects.toBeInstanceOf(BadRequestException);
    expect(logs[0]).toMatchObject({ status: 'FAILED' });
  });
  it('preview uses real data, masks the phone, and never leaks the full number', async () => {
    process.env.WEB_PANEL_PUBLIC_URL = 'https://panel.test';
    const { svc, ctx } = setup();
    const p = await svc.manualPreview(ctx, 'p1');
    expect(p.canSend).toBe(true);
    expect(p.phoneMasked).toBe('0912***789');
    expect(p.message).toContain('۵۰٪');
    expect(JSON.stringify(p)).not.toContain('09123456789');
  });
  it('sanitizeManualMessage strips control chars', () => {
    expect(sanitizeManualMessage('a\u0000‮b')).toBe('ab');
  });
});

describe('ProjectsController — sms permissions and scope', () => {
  function make(inScope = true) {
    const permissions = {
      getEffective: vi.fn(async () => ({ canViewOwn: true })),
      assertEdit: vi.fn(async () => undefined),
      assertViewAll: vi.fn(async () => undefined),
    };
    const sms: Record<string, any> = {};
    for (const m of ['getSettings', 'setSettings', 'previewTemplate', 'setProjectNotify', 'manualPreview', 'manualSend']) sms[m] = vi.fn(async () => ({}));
    const ctx = { auth: { sub: 'g' }, tenantDb: { user: { findUnique: vi.fn(async () => ({ id: 'me' })) }, project: { findFirst: vi.fn(async () => (inScope ? { id: 'p1' } : null)) } } } as never;
    return { c: new ProjectsController({} as never, {} as never, permissions as never, {} as never, sms as never), permissions, sms, ctx };
  }
  it('settings require edit AND view-all; a denial stops before the service', async () => {
    const { c, permissions, sms, ctx } = make();
    await c.getSmsSettings(ctx);
    await c.setSmsSettings({ enabled: true }, ctx);
    await c.previewSmsTemplate({ template: 'x' }, ctx);
    expect(permissions.assertEdit).toHaveBeenCalledTimes(3);
    expect(permissions.assertViewAll).toHaveBeenCalledTimes(3);
    permissions.assertViewAll.mockRejectedValueOnce(new ForbiddenException('no'));
    sms.setSettings.mockClear();
    await expect(c.setSmsSettings({ enabled: true }, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.setSettings).not.toHaveBeenCalled();
    permissions.assertEdit.mockRejectedValueOnce(new ForbiddenException('no'));
    await expect(c.getSmsSettings(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('by-id sms routes require edit and 404 outside the scope without calling the service', async () => {
    const { c, sms, ctx, permissions } = make(false);
    await expect(c.setSmsNotify('p1', { enabled: true }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.smsPreview('p1', ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.sendSms('p1', { message: 'x' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
    expect(permissions.assertEdit).toHaveBeenCalledTimes(3);
    for (const fn of Object.values(sms)) expect(fn).not.toHaveBeenCalled();
    const ok = make(true);
    await ok.c.sendSms('p1', { message: 'x' }, ok.ctx);
    expect(ok.sms.manualSend).toHaveBeenCalledWith(ok.ctx, 'p1', 'x');
  });
});
