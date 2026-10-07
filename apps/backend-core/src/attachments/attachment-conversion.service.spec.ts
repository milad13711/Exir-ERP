import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttachmentConversionService, fileNameWithExtension } from './attachment-conversion.service.js';

const DATA = 'data:application/pdf;base64,AAAA';

function make(opts: { att?: any; moduleEnabled?: boolean; accessOk?: boolean; canCreateReports?: boolean; prior?: any[]; priorTargetExists?: boolean } = {}) {
  const att = opts.att === undefined ? { id: 'a1', entityType: 'DailyChecklistItem', entityId: 'item-1', title: 'رسید بانک', fileUrl: DATA, sourceAttachmentId: null, sourceNote: null } : opts.att;
  const db: any = {
    user: { findUnique: vi.fn(async ({ where }: any) => (where.globalUserId ? { id: 'me' } : { name: 'علی' })) },
    attachment: { findUnique: vi.fn(async () => att), create: vi.fn(async () => ({})) },
    dailyChecklistItem: { findUnique: vi.fn(async () => ({ title: 'ارسال نامه', date: new Date('2026-10-07') })) },
    report: { create: vi.fn(async () => ({ id: 'rep-new' })), findUnique: vi.fn(async () => (opts.priorTargetExists ? { id: 'x' } : null)) },
    confidentialDocument: { create: vi.fn(async () => ({ id: 'doc-new' })), findUnique: vi.fn(async () => (opts.priorTargetExists ? { id: 'x' } : null)) },
    attachmentConversion: { findMany: vi.fn(async () => opts.prior ?? []), create: vi.fn(async () => ({})) },
  };
  const access = { assertAccess: vi.fn(async () => { if (opts.accessOk === false) throw new ForbiddenException('scope'); }) } as any;
  const permissions = { assertCreate: vi.fn(async () => { if (opts.canCreateReports === false) throw new ForbiddenException('no create'); }) } as any;
  const controlDb = {
    moduleDefinition: { findMany: vi.fn(async () => [
      { id: 'm1', code: 'reports', dependsOn: [], isCore: false },
      { id: 'm2', code: 'confidential-archive', dependsOn: [], isCore: false },
    ]) },
    tenantModule: { findMany: vi.fn(async () => (opts.moduleEnabled === false ? [] : [{ moduleId: 'm1', status: 'INSTALLED' }, { moduleId: 'm2', status: 'INSTALLED' }])) },
  } as any;
  const ctx: any = { tenantId: 't1', auth: { type: 'tenant_user', sub: 'g1', role: 'MEMBER' }, tenantDb: db };
  return { svc: new AttachmentConversionService(access, permissions, controlDb), ctx, db, access, permissions };
}

describe('AttachmentConversionService', () => {
  it('KNOWLEDGE: creates an isKnowledge report with the file, keeps the original, records provenance', async () => {
    const { svc, ctx, db, permissions } = make();
    const res = await svc.convert(ctx, 'a1', 'KNOWLEDGE');
    expect(permissions.assertCreate).toHaveBeenCalledWith(ctx, 'reports');
    expect(db.report.create.mock.calls[0][0].data).toMatchObject({ title: 'رسید بانک', isKnowledge: true, createdByUserId: 'me' });
    expect(db.report.create.mock.calls[0][0].data.body).toContain('ارسال نامه');
    expect(db.attachment.create.mock.calls[0][0].data).toMatchObject({ entityType: 'Report', entityId: 'rep-new', fileUrl: DATA });
    expect(db.attachmentConversion.create.mock.calls[0][0].data).toMatchObject({ attachmentId: 'a1', target: 'KNOWLEDGE', targetId: 'rep-new', convertedByUserId: 'me' });
    expect(res.targetId).toBe('rep-new');
  });

  it('CONFIDENTIAL: creates an ownerOnly document with the file name incl. extension', async () => {
    const { svc, ctx, db } = make();
    await svc.convert(ctx, 'a1', 'CONFIDENTIAL', { category: 'FORMULATION' });
    expect(db.confidentialDocument.create.mock.calls[0][0].data).toMatchObject({
      ownerOnly: true, category: 'FORMULATION', fileData: DATA, fileName: 'رسید بانک.pdf', createdByUserId: 'me',
    });
  });

  it('refuses when the target module is not enabled — server-side, regardless of UI', async () => {
    const { svc, ctx, db } = make({ moduleEnabled: false });
    await expect(svc.convert(ctx, 'a1', 'KNOWLEDGE')).rejects.toThrow(/فعال نیست/);
    await expect(svc.convert(ctx, 'a1', 'CONFIDENTIAL')).rejects.toThrow(/فعال نیست/);
    expect(db.report.create).not.toHaveBeenCalled();
    expect(db.confidentialDocument.create).not.toHaveBeenCalled();
  });

  it('refuses knowledge conversion without create permission on the reports module', async () => {
    const { svc, ctx, db } = make({ canCreateReports: false });
    await expect(svc.convert(ctx, 'a1', 'KNOWLEDGE')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it('enforces scope on the source attachment (cannot convert files of someone else’s checklist)', async () => {
    const { svc, ctx, db } = make({ accessOk: false });
    await expect(svc.convert(ctx, 'a1', 'CONFIDENTIAL')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.confidentialDocument.create).not.toHaveBeenCalled();
  });

  it('only checklist files / archived report copies are convertible', async () => {
    const { svc, ctx } = make({ att: { id: 'a9', entityType: 'Report', entityId: 'r', title: 'x', fileUrl: DATA, sourceAttachmentId: null } });
    await expect(svc.convert(ctx, 'a9', 'KNOWLEDGE')).rejects.toBeInstanceOf(BadRequestException);
    const { svc: s2, ctx: c2 } = make({ att: { id: 'a8', entityType: 'CrmContact', entityId: 'c', title: 'x', fileUrl: DATA, sourceAttachmentId: null } });
    await expect(s2.convert(c2, 'a8', 'KNOWLEDGE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('archived report copy resolves to its source for duplicate detection; a live prior conversion blocks a second one', async () => {
    const { svc, ctx, db } = make({
      att: { id: 'copy1', entityType: 'Report', entityId: 'rep-1', title: 'رسید', fileUrl: DATA, sourceAttachmentId: 'a1', sourceNote: 'ارسال نامه' },
      prior: [{ targetId: 'rep-old' }],
      priorTargetExists: true,
    });
    await expect(svc.convert(ctx, 'copy1', 'KNOWLEDGE')).rejects.toThrow(/قبلاً/);
    expect(db.attachmentConversion.findMany).toHaveBeenCalledWith({ where: { attachmentId: 'a1', target: 'KNOWLEDGE' } });
  });

  it('rejects API-key sessions', async () => {
    const { svc, ctx } = make();
    ctx.auth.type = 'api_key';
    await expect(svc.convert(ctx, 'a1', 'KNOWLEDGE')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('fileNameWithExtension', () => {
  it('appends an extension from the mime type only once', () => {
    expect(fileNameWithExtension('رسید', DATA)).toBe('رسید.pdf');
    expect(fileNameWithExtension('رسید.pdf', DATA)).toBe('رسید.pdf');
    expect(fileNameWithExtension('x', 'data:application/x-unknown;base64,AA')).toBe('x');
  });
});
