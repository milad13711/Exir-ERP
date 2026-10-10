import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';

const moduleEnabled = vi.hoisted(() => ({ fn: vi.fn(async (_c: unknown, _t: string, _code: string) => true) }));
vi.mock('../common/module-enabled.util.js', () => ({ isModuleEnabled: moduleEnabled.fn }));

import {
  COMMENT_NOTIFY_THROTTLE_MS,
  MAX_CUSTOMER_COMMENTS_PER_WINDOW,
  MAX_CUSTOMER_COMMENTS_TOTAL,
  PublicProjectsService,
  publicStageStatus,
  sanitizeCustomerText,
} from './public-projects.service.js';
import { makeDelegate } from './testing/fake-db.js';

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PDF = 'data:application/pdf;base64,JVBERi0xLjQ=';
const HTML = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';

type Row = Record<string, unknown>;

function setup(opts: { enabled?: boolean } = {}) {
  const tables = {
    project: [{ id: 'PROJECT-ID-SENTINEL', projectNo: 7, name: 'پروژه‌ی تست', publicToken: TOKEN, publicEnabled: opts.enabled ?? true, contactId: 'c1', managerUserId: 'mgr', createdByUserId: 'cr', budget: 987654321, description: 'PRIVATE_PROJECT_DESCRIPTION', status: 'ACTIVE', startDate: null, endDate: null, lastCustomerCommentNotifiedAt: null as Date | null }] as Row[],
    projectStage: [
      {
        id: 'STAGE-ID-SENTINEL-1', projectId: 'PROJECT-ID-SENTINEL', order: 0, title: 'طراحی', status: 'DONE', completedAt: new Date('2026-01-01'),
        description: 'PUBLIC_STAGE_DESC', descriptionVisibleToCustomer: true, completionReport: 'PRIVATE_COMPLETION_REPORT', responsibleUserId: 'RESPONSIBLE-USER-SENTINEL', rejectionReason: 'PRIVATE_REJECTION', requiresManagerApproval: true,
        links: [
          { id: 'l-pub', stageId: 'STAGE-ID-SENTINEL-1', title: 'PUBLIC_LINK_TITLE', url: 'https://ok.example/x', visibleToCustomer: true },
          { id: 'l-priv', stageId: 'STAGE-ID-SENTINEL-1', title: 'PRIVATE_LINK_TITLE', url: 'https://secret.example/PRIVATE_LINK_URL', visibleToCustomer: false },
        ],
      },
      {
        id: 'STAGE-ID-SENTINEL-2', projectId: 'PROJECT-ID-SENTINEL', order: 1, title: 'اجرا', status: 'AWAITING_APPROVAL', completedAt: null,
        description: 'PRIVATE_STAGE_DESC', descriptionVisibleToCustomer: false, completionReport: null, responsibleUserId: 'RESPONSIBLE-USER-SENTINEL', rejectionReason: null, requiresManagerApproval: true,
        links: [],
      },
    ] as Row[],
    projectNote: [
      { id: 'n-staff-priv', projectId: 'PROJECT-ID-SENTINEL', stageId: null, parentId: null, source: 'STAFF', body: 'PRIVATE_NOTE_PROJECT', visibleToCustomer: false, authorUserId: 'RESPONSIBLE-USER-SENTINEL' },
      { id: 'n-stage-priv', projectId: 'PROJECT-ID-SENTINEL', stageId: 'STAGE-ID-SENTINEL-1', parentId: null, source: 'STAFF', body: 'PRIVATE_NOTE_STAGE', visibleToCustomer: false },
      { id: 'n-stage-pub', projectId: 'PROJECT-ID-SENTINEL', stageId: 'STAGE-ID-SENTINEL-1', parentId: null, source: 'STAFF', body: 'PUBLIC_NOTE_STAGE', visibleToCustomer: true },
      { id: 'n-cust', projectId: 'PROJECT-ID-SENTINEL', stageId: null, parentId: null, source: 'CUSTOMER', authorName: 'علی', body: 'CUSTOMER_COMMENT', visibleToCustomer: true },
      { id: 'n-reply-pub', projectId: 'PROJECT-ID-SENTINEL', stageId: null, parentId: 'n-cust', source: 'STAFF', body: 'PUBLIC_REPLY', visibleToCustomer: true },
      { id: 'n-reply-priv', projectId: 'PROJECT-ID-SENTINEL', stageId: null, parentId: 'n-cust', source: 'STAFF', body: 'PRIVATE_REPLY', visibleToCustomer: false },
    ] as Row[],
    attachment: [
      { id: 'att-img-pub', entityType: 'ProjectStage', entityId: 'STAGE-ID-SENTINEL-1', title: 'PUBLIC_IMG', fileUrl: PNG, visibleToCustomer: true },
      { id: 'att-pdf-pub', entityType: 'ProjectStage', entityId: 'STAGE-ID-SENTINEL-1', title: 'PUBLIC_PDF', fileUrl: PDF, visibleToCustomer: true },
      { id: 'att-html-pub', entityType: 'ProjectStage', entityId: 'STAGE-ID-SENTINEL-1', title: 'PUBLIC_HTML', fileUrl: HTML, visibleToCustomer: true },
      { id: 'att-priv', entityType: 'ProjectStage', entityId: 'STAGE-ID-SENTINEL-1', title: 'PRIVATE_FILE', fileUrl: PDF, visibleToCustomer: false },
      { id: 'att-project-level', entityType: 'Project', entityId: 'PROJECT-ID-SENTINEL', title: 'PRIVATE_PROJECT_FILE', fileUrl: PDF, visibleToCustomer: true },
      { id: 'att-other-project', entityType: 'ProjectStage', entityId: 'OTHER-STAGE', title: 'OTHER_PROJECT_FILE', fileUrl: PDF, visibleToCustomer: true },
    ] as Row[],
    proposal: [
      { id: 'pr1', projectId: 'PROJECT-ID-SENTINEL', proposalNo: 11, title: 'PUBLIC_PROPOSAL', amount: 5000, status: 'SENT', issuedAt: new Date(), publicToken: 'TOKEN-PROPOSAL-PUBLIC', projectShowOnPublicLink: true },
      { id: 'pr2', projectId: 'PROJECT-ID-SENTINEL', proposalNo: 12, title: 'DRAFT_PROPOSAL', amount: 1, status: 'DRAFT', issuedAt: new Date(), publicToken: 'TOKEN-PROPOSAL-DRAFT', projectShowOnPublicLink: true },
      { id: 'pr3', projectId: 'PROJECT-ID-SENTINEL', proposalNo: 13, title: 'UNFLAGGED_PROPOSAL', amount: 1, status: 'SENT', issuedAt: new Date(), publicToken: 'TOKEN-PROPOSAL-UNFLAGGED', projectShowOnPublicLink: false },
      { id: 'pr4', projectId: 'OTHER', proposalNo: 14, title: 'OTHER_PROJECT_PROPOSAL', amount: 1, status: 'SENT', issuedAt: new Date(), publicToken: 'TOKEN-PROPOSAL-OTHER', projectShowOnPublicLink: true },
    ] as Row[],
    salesInvoice: [
      { id: 'i1', projectId: 'PROJECT-ID-SENTINEL', invoiceNo: 21, total: 9000, status: 'CONFIRMED', issuedAt: new Date(), publicToken: 'TOKEN-INVOICE-PUBLIC', projectShowOnPublicLink: true },
      { id: 'i2', projectId: 'PROJECT-ID-SENTINEL', invoiceNo: 22, total: 1, status: 'DRAFT', issuedAt: new Date(), publicToken: 'TOKEN-INVOICE-DRAFT', projectShowOnPublicLink: true },
      { id: 'i3', projectId: 'PROJECT-ID-SENTINEL', invoiceNo: 23, total: 1, status: 'PAID', issuedAt: new Date(), publicToken: 'TOKEN-INVOICE-UNFLAGGED', projectShowOnPublicLink: false },
    ] as Row[],
    crmContact: [{ id: 'c1', name: 'مشتری نمونه', company: 'شرکت نمونه', phone: 'PRIVATE_PHONE_09120000000' }] as Row[],
  };
  const tenantDb = {
    project: makeDelegate(tables.project),
    projectStage: makeDelegate(tables.projectStage),
    projectNote: makeDelegate(tables.projectNote, { idPrefix: 'note' }),
    attachment: makeDelegate(tables.attachment),
    proposal: makeDelegate(tables.proposal),
    salesInvoice: makeDelegate(tables.salesInvoice),
    crmContact: makeDelegate(tables.crmContact),
    moduleSetting: { findUnique: vi.fn(async () => null) },
  };
  const notifications = { notify: vi.fn(async (..._args: unknown[]) => undefined) };
  const activity = { logSystem: vi.fn() };
  const service = new PublicProjectsService({} as never, notifications as never, activity as never);
  const t = { tenantId: 'tid', tenantSlug: 'acme', tenantName: 'Acme', tenantDb } as never;
  return { service, t, tables, notifications, activity };
}

beforeEach(() => {
  moduleEnabled.fn.mockReset();
  moduleEnabled.fn.mockResolvedValue(true);
});

describe('public project view — nothing private ever appears (leak test)', () => {
  it('contains no sentinel from any private field', async () => {
    const { service, t } = setup();
    const out = JSON.stringify(await service.view(t, TOKEN));
    for (const secret of [
      'PRIVATE_', 'PROJECT-ID-SENTINEL', 'STAGE-ID-SENTINEL', 'RESPONSIBLE-USER-SENTINEL', '987654321', 'secret.example',
      'TOKEN-PROPOSAL-DRAFT', 'TOKEN-PROPOSAL-UNFLAGGED', 'TOKEN-PROPOSAL-OTHER', 'TOKEN-INVOICE-DRAFT', 'TOKEN-INVOICE-UNFLAGGED',
      'att-priv', 'att-project-level', 'att-other-project', 'DRAFT_PROPOSAL', 'UNFLAGGED_PROPOSAL', 'OTHER_PROJECT_PROPOSAL',
      'budget', 'completionReport', 'rejectionReason', 'responsibleUserId', 'authorUserId', 'managerUserId', '09120000000',
    ]) {
      expect(out, `leaked: ${secret}`).not.toContain(secret);
    }
  });

  it('shows exactly the flagged items', async () => {
    const { service, t } = setup();
    const v = await service.view(t, TOKEN);
    expect(v.stages[0].description).toBe('PUBLIC_STAGE_DESC');
    expect(v.stages[0].links).toEqual([{ id: 'l-pub', title: 'PUBLIC_LINK_TITLE', url: 'https://ok.example/x' }]);
    expect(v.stages[0].images.map((i) => i.id)).toEqual(['att-img-pub']);
    expect(v.stages[0].files.map((f) => f.id).sort()).toEqual(['att-html-pub', 'att-pdf-pub']);
    expect(v.stages[0].notes.map((n) => n.body)).toEqual(['PUBLIC_NOTE_STAGE']);
    // مرحله‌ی در انتظار تأیید برای مشتری فقط «شروع‌نشده» است
    expect(v.stages[1].status).toBe('PENDING');
    expect(v.stages[1].description).toBeNull();
    expect(v.comments).toHaveLength(1);
    expect(v.comments[0].replies.map((r) => r.body)).toEqual(['PUBLIC_REPLY']);
    expect(v.documents.map((d) => d.path)).toEqual(['/proposal/acme/TOKEN-PROPOSAL-PUBLIC', '/invoice/acme/TOKEN-INVOICE-PUBLIC']);
    expect(v.progress).toEqual({ percent: 50, doneStages: 1, totalStages: 2, hasStages: true });
  });

  it('hides documents of modules that are disabled', async () => {
    const { service, t } = setup();
    moduleEnabled.fn.mockImplementation(async (_c, _t, code) => code === 'projects');
    expect((await service.view(t, TOKEN)).documents).toEqual([]);
  });

  it('a disabled link, a wrong token, a malformed token and a disabled projects module are all 404', async () => {
    const off = setup({ enabled: false });
    await expect(off.service.view(off.t, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    const on = setup();
    await expect(on.service.view(on.t, 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee')).rejects.toBeInstanceOf(NotFoundException);
    await expect(on.service.view(on.t, "x' OR 1=1")).rejects.toBeInstanceOf(NotFoundException);
    moduleEnabled.fn.mockResolvedValue(false);
    await expect(on.service.view(on.t, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps internal stage statuses to the public three', () => {
    expect(publicStageStatus('REJECTED')).toBe('PENDING');
    expect(publicStageStatus('AWAITING_APPROVAL')).toBe('PENDING');
    expect(publicStageStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(publicStageStatus('DONE')).toBe('DONE');
  });
});

describe('public file serving', () => {
  it('serves only flagged stage files of this project; safe images inline, everything else forced to octet-stream', async () => {
    const { service, t } = setup();
    const img = await service.getFile(t, TOKEN, 'att-img-pub');
    expect(img).toMatchObject({ inline: true, mimeType: 'image/png' });
    const pdf = await service.getFile(t, TOKEN, 'att-pdf-pub');
    expect(pdf).toMatchObject({ inline: false, mimeType: 'application/octet-stream' });
    const html = await service.getFile(t, TOKEN, 'att-html-pub');
    expect(html).toMatchObject({ inline: false, mimeType: 'application/octet-stream' });
    for (const id of ['att-priv', 'att-project-level', 'att-other-project', 'nope']) {
      await expect(service.getFile(t, TOKEN, id)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('customer comments', () => {
  it('stores a CUSTOMER note, strips HTML, defaults the name, notifies manager+creator and logs activity', async () => {
    const { service, t, tables, notifications, activity } = setup();
    const out = await service.comment(t, TOKEN, { body: 'سلام <script>alert(1)</script><b>خوب</b>', name: '<img src=x onerror=alert(2)>رضا' });
    expect(out.body).toBe('سلام alert(1)خوب');
    expect(out.authorName).toBe('رضا');
    const saved = tables.projectNote.at(-1)!;
    expect(saved).toMatchObject({ source: 'CUSTOMER', projectId: 'PROJECT-ID-SENTINEL', visibleToCustomer: true });
    expect(saved.stageId).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('<');
    expect(notifications.notify.mock.calls.map((c) => (c[1] as { userId: string }).userId).sort()).toEqual(['cr', 'mgr']);
    expect(activity.logSystem).toHaveBeenCalledTimes(1);
    const anon = await service.comment(t, TOKEN, { body: 'بدون نام' });
    expect(anon.authorName).toBe('مشتری');
  });

  it('rejects empty-after-sanitising text', async () => {
    const { service, t } = setup();
    await expect(service.comment(t, TOKEN, { body: '<b></b>  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rate limits: 5 per window, 429 afterwards', async () => {
    const { service, t } = setup();
    for (let i = 0; i < MAX_CUSTOMER_COMMENTS_PER_WINDOW; i += 1) await service.comment(t, TOKEN, { body: `c${i}` });
    const err = await service.comment(t, TOKEN, { body: 'one more' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('caps the total per project even when old comments are outside the window', async () => {
    const { service, t, tables } = setup();
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    for (let i = 0; i < MAX_CUSTOMER_COMMENTS_TOTAL; i += 1) tables.projectNote.push({ id: `old${i}`, projectId: 'PROJECT-ID-SENTINEL', source: 'CUSTOMER', body: 'x', createdAt: old });
    const err = await service.comment(t, TOKEN, { body: 'late' }).catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('throttles notifications (second comment within the window is stored but not notified) and re-notifies after it', async () => {
    const { service, t, tables, notifications } = setup();
    await service.comment(t, TOKEN, { body: 'a' });
    const first = notifications.notify.mock.calls.length;
    expect(first).toBe(2);
    await service.comment(t, TOKEN, { body: 'b' });
    expect(notifications.notify.mock.calls.length).toBe(first);
    expect(tables.projectNote.filter((n) => n.source === 'CUSTOMER' && n.id !== 'n-cust')).toHaveLength(2);
    tables.project[0].lastCustomerCommentNotifiedAt = new Date(Date.now() - COMMENT_NOTIFY_THROTTLE_MS - 1000);
    await service.comment(t, TOKEN, { body: 'c' });
    expect(notifications.notify.mock.calls.length).toBe(first * 2);
  });

  it('refuses comments when the link is off', async () => {
    const { service, t } = setup({ enabled: false });
    await expect(service.comment(t, TOKEN, { body: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('sanitizeCustomerText', () => {
  it('removes tags, unterminated tags and control chars', () => {
    expect(sanitizeCustomerText('a<b>c</b>')).toBe('ac');
    expect(sanitizeCustomerText('x <script')).toBe('x');
    expect(sanitizeCustomerText('a\u0000b')).toBe('ab');
  });
});
