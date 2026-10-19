import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LicenseAdminService, csvCell, parseExpiry } from './license-admin.service.js';
import { LicenseAuditService } from './license-audit.service.js';

describe('admin helpers', () => {
  it('date-only expiry means end of that day in Tehran (UTC+03:30)', () => {
    expect(parseExpiry('2027-03-21').toISOString()).toBe('2027-03-21T20:29:59.000Z');
    expect(parseExpiry('2027-03-21T10:00:00Z').toISOString()).toBe('2027-03-21T10:00:00.000Z');
    expect(() => parseExpiry('2027-13-45')).toThrow(BadRequestException);
  });

  it('CSV cells are quoted and neutralise formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('@a')).toBe(`"'@a"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});

function build(initial: Record<string, any> = {}) {
  const events: any[] = [];
  const licenses = new Map<string, any>();
  let bumped = 0;
  const db: any = {
    moduleDefinition: { findMany: async () => [{ code: 'crm', dependsOn: [] }, { code: 'sales', dependsOn: ['accounting'] }, { code: 'accounting', dependsOn: [] }] },
    license: {
      findUnique: async () => null,
      findFirst: async ({ where }: any) => { const l = licenses.get(where.id); return l && l.deletedAt == null ? l : null; },
      create: async ({ data }: any) => { const l = { id: `l${licenses.size + 1}`, status: 'ACTIVE', deletedAt: null, issuedAt: new Date(), ...data }; licenses.set(l.id, l); return l; },
      update: async ({ where, data }: any) => { Object.assign(licenses.get(where.id), data); return licenses.get(where.id); },
    },
    licenseEvent: { create: async ({ data }: any) => { events.push(data); } },
    tenant: { findUnique: async () => null },
    $transaction: async (cb: (tx: any) => Promise<unknown>) => cb(db),
  };
  const settings: any = { bumpCrl: async (_tx?: unknown) => ++bumped, get: async () => ({ crlVersion: 1 }) };
  const svc = new LicenseAdminService(db, new LicenseAuditService(db), settings, {} as never);
  return { svc, events, licenses, bumped: () => bumped, initial };
}
const actor = { id: 'admin-1', label: 'admin:admin-1', ip: '5.5.5.5' };

describe('LicenseAdminService', () => {
  it('create: immutable key, dependency expansion, perpetual default, audit trail', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['sales'], seats: 5 } as never, actor);
    expect(l.licenseKey).toMatch(/^LIC-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    expect(l.allowedModules).toEqual(['accounting', 'sales']);
    expect(l.expiresAt).toBeNull();
    expect(l.maxActivations).toBe(1);
    expect(t.events[0]).toMatchObject({ kind: 'ADMIN', action: 'create', actorId: 'admin-1', ip: '5.5.5.5' });
    expect(JSON.stringify(t.events[0])).not.toContain(l.licenseKey!); // only the 8-char hint
  });

  it('create rejects unknown modules', async () => {
    const t = build();
    await expect(t.svc.create({ orgName: 'Org', modules: ['nope'] } as never, actor)).rejects.toThrow(/ماژول ناشناخته/);
  });

  it('update never changes the key and audits changed fields', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['crm'] } as never, actor);
    const before = l.licenseKey;
    await t.svc.update(l.id, { orgName: 'New', licenseKey: 'LIC-HACKED' } as never, actor);
    expect(t.licenses.get(l.id).licenseKey).toBe(before);
    expect(t.events.at(-1)).toMatchObject({ action: 'update', detail: { fields: ['orgName'] } });
  });

  it('suspend / resume / revoke / delete transitions bump the CRL and are audited; revoked cannot be suspended', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['crm'] } as never, actor);
    await t.svc.suspend(l.id, 'non-payment', actor);
    expect(t.licenses.get(l.id).status).toBe('SUSPENDED');
    await expect(t.svc.resume('missing', actor)).rejects.toThrow();
    await t.svc.resume(l.id, actor);
    expect(t.licenses.get(l.id).status).toBe('ACTIVE');
    await t.svc.revoke(l.id, 'breach', actor);
    await expect(t.svc.suspend(l.id, 'x', actor)).rejects.toThrow(/لغو/);
    await expect(t.svc.resume(l.id, actor)).rejects.toThrow();
    await t.svc.softDelete(l.id, 'cleanup', actor);
    expect(t.licenses.get(l.id).deletedAt).toBeInstanceOf(Date);
    expect(t.bumped()).toBe(4);
    expect(t.events.map((e) => e.action)).toEqual(['create', 'suspend', 'resume', 'revoke', 'delete']);
  });

  it('renew: extend from max(now, current expiry), perpetual and updatesUntil', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['crm'], expiresAt: '2030-01-01' } as never, actor);
    await t.svc.renew(l.id, { extendDays: 30 }, actor);
    expect(t.licenses.get(l.id).expiresAt.getTime()).toBeGreaterThan(new Date('2030-01-30').getTime());
    await t.svc.renew(l.id, { perpetual: true, updatesUntil: '2031-01-01' }, actor);
    expect(t.licenses.get(l.id).expiresAt).toBeNull();
    expect(t.licenses.get(l.id).updatesUntil).toBeInstanceOf(Date);
    await expect(t.svc.renew(l.id, {}, actor)).rejects.toThrow(BadRequestException);
  });

  it('mutation and audit are one transaction: if the audit write fails the change is not applied', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['crm'] } as never, actor);
    const snapshot = { ...t.licenses.get(l.id) };
    // emulate rollback: transaction runner restores state when cb throws
    const dbAny = (t.svc as any).db;
    dbAny.$transaction = async (cb: any) => {
      const before = new Map([...t.licenses].map(([k, v]) => [k, { ...v }]));
      try {
        return await cb({ ...dbAny, licenseEvent: { create: async () => { throw new Error('audit down'); } } });
      } catch (e) {
        for (const [k, v] of before) Object.assign(t.licenses.get(k), v);
        throw e;
      }
    };
    await expect(t.svc.suspend(l.id, 'reason', actor)).rejects.toThrow('audit down');
    expect(t.licenses.get(l.id).status).toBe(snapshot.status);
  });

  it('new licences default to a short 7-day grace', async () => {
    const t = build();
    const l = await t.svc.create({ orgName: 'Org', modules: ['crm'] } as never, actor);
    expect(l.graceDays).toBe(7);
  });

  it('a failing audit write aborts admin mutations that depend on it (recordStrict) while public logging never throws', async () => {
    const t = build();
    const failing: any = { licenseEvent: { create: vi.fn(async () => { throw new Error('db down'); }) } };
    const audit = new LicenseAuditService(failing);
    await expect(audit.recordStrict({ kind: 'ADMIN', action: 'x' })).rejects.toThrow();
    await expect(audit.record({ kind: 'PUBLIC', action: 'x' })).resolves.toBeUndefined();
    expect(t.events).toHaveLength(0);
  });
});
