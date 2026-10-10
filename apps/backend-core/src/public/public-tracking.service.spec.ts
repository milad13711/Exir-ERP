import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const moduleEnabled = vi.hoisted(() => ({ fn: vi.fn(async (_c: unknown, _t: string, _code: string) => true) }));
vi.mock('../common/module-enabled.util.js', () => ({ isModuleEnabled: moduleEnabled.fn }));

import { MY_PROJECTS_MAX, PublicTrackingService, phoneKey } from './public-tracking.service.js';
import { makeDelegate } from '../projects/testing/fake-db.js';

type Row = Record<string, unknown>;
const TOK_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const jwt = new JwtService({ secret: 'test-secret' });

function project(over: Row): Row {
  return {
    id: 'INTERNAL-ID-SENTINEL', projectNo: 99, name: 'پروژه', status: 'ACTIVE', contactId: 'c1', publicEnabled: true, publicToken: TOK_A,
    budget: 777777777, description: 'PRIVATE_DESC', managerUserId: 'MGR-SENTINEL', startDate: null, endDate: null, updatedAt: new Date('2026-01-01'), ...over,
  };
}

function setup(opts: { contacts?: Row[]; projects?: Row[]; stages?: Row[] } = {}) {
  const contacts = opts.contacts ?? [{ id: 'c1', phone: '09121234567' }];
  const projects = opts.projects ?? [project({})];
  const stages = opts.stages ?? [];
  // stages همراه پروژه (select.stages) — fake-db relation را نمی‌شناسد، پس قبل از تحویل متصل می‌کنیم
  const projectDelegate = makeDelegate(projects);
  const origFindMany = projectDelegate.findMany;
  projectDelegate.findMany = async (args) => (await origFindMany(args)).map((p) => ({ ...p, stages: stages.filter((s) => s.projectId === p.id) }));
  const db = { crmContact: makeDelegate(contacts), project: projectDelegate };
  const controlDb = {
    tenant: { findUnique: vi.fn(async () => ({ id: 't1', slug: 'acme', status: 'ACTIVE', dbHost: 'h', dbPort: 1, dbName: 'n' })) },
    tenantModule: { findFirst: vi.fn(async () => ({ id: 'm' })) },
  };
  const svc = new PublicTrackingService(controlDb as never, { forTenant: () => db } as never, {} as never, jwt);
  const token = (phone = '09121234567', slug = 'acme', type = 'tracking_ticket') => jwt.signAsync({ type, phone, tenantSlug: slug }, { expiresIn: 900 });
  return { svc, token, controlDb, db };
}

beforeEach(() => moduleEnabled.fn.mockImplementation(async () => true));

describe('phoneKey', () => {
  it('normalizes every common format to the same 10 digits', () => {
    for (const raw of ['09121234567', '+989121234567', '00989121234567', '9121234567', '۰۹۱۲۱۲۳۴۵۶۷', '٠٩١٢١٢٣٤٥٦٧', '0912 123 4567', '0912-123-4567', '+98 (912) 123-4567']) {
      expect(phoneKey(raw)).toBe('9121234567');
    }
    expect(phoneKey(null)).toBe('');
  });
});

describe('PublicTrackingService.listMyProjects', () => {
  it('matches contacts in different phone formats, incl. several contacts with the same phone', async () => {
    const { svc, token } = setup({
      contacts: [
        { id: 'c1', phone: '09121234567' },
        { id: 'c2', phone: '+98 912 123 4567' },
        { id: 'c3', phone: '۰۹۱۲۱۲۳۴۵۶۷' },
        { id: 'c4', phone: '09129994567' }, // همان ۴ رقم آخر، شماره‌ی دیگر
      ],
      projects: [
        project({ id: 'p1', name: 'A', contactId: 'c1', publicToken: 'tok-1' }),
        project({ id: 'p2', name: 'B', contactId: 'c2', publicToken: 'tok-2' }),
        project({ id: 'p3', name: 'C', contactId: 'c3', publicToken: 'tok-3' }),
        project({ id: 'p4', name: 'OTHER_CUSTOMER_PROJECT', contactId: 'c4', publicToken: 'tok-4' }),
      ],
    });
    const out = await svc.listMyProjects('acme', await token());
    expect(out.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
  });

  it('works when the verified phone uses a different format than the stored one', async () => {
    const { svc, token } = setup({ contacts: [{ id: 'c1', phone: '+989121234567' }] });
    expect(await svc.listMyProjects('acme', await token('09121234567'))).toHaveLength(1);
  });

  it('returns only publicEnabled projects', async () => {
    const { svc, token } = setup({ projects: [project({ id: 'p1', name: 'ON' }), project({ id: 'p2', name: 'OFF', publicEnabled: false, publicToken: 'tok-off' })] });
    expect((await svc.listMyProjects('acme', await token())).map((p) => p.name)).toEqual(['ON']);
  });

  it('never leaks other customers, internal ids or private fields (sentinel)', async () => {
    const { svc, token } = setup({
      contacts: [{ id: 'c1', phone: '09121234567' }, { id: 'c9', phone: '09351112222' }],
      projects: [
        project({ id: 'p1', name: 'MINE' }),
        project({ id: 'p9', name: 'OTHER_SENTINEL_NAME', contactId: 'c9', publicToken: 'OTHER_TOKEN_SENTINEL' }),
      ],
    });
    const out = await svc.listMyProjects('acme', await token());
    const json = JSON.stringify(out);
    for (const s of ['OTHER_SENTINEL_NAME', 'OTHER_TOKEN_SENTINEL', 'INTERNAL-ID-SENTINEL', 'MGR-SENTINEL', 'PRIVATE_DESC', '777777777', '09351112222']) expect(json).not.toContain(s);
    expect(Object.keys(out[0]).sort()).toEqual(['endDate', 'name', 'progress', 'publicKey', 'publicToken', 'startDate', 'status']);
    expect(Object.keys(out[0].progress).sort()).toEqual(['doneStages', 'percent', 'totalStages']);
  });

  it('computes progress and sorts active first, then by recent activity', async () => {
    const { svc, token } = setup({
      projects: [
        project({ id: 'p1', name: 'done-new', status: 'COMPLETED', publicToken: 't1', updatedAt: new Date('2026-05-01') }),
        project({ id: 'p2', name: 'active-old', status: 'ACTIVE', publicToken: 't2', updatedAt: new Date('2026-01-01') }),
        project({ id: 'p3', name: 'active-new', status: 'ACTIVE', publicToken: 't3', updatedAt: new Date('2026-03-01') }),
      ],
      stages: [
        { projectId: 'p3', status: 'DONE' },
        { projectId: 'p3', status: 'PENDING' },
        { projectId: 'p3', status: 'DONE' },
        { projectId: 'p3', status: 'CANCELLED' },
      ],
    });
    const out = await svc.listMyProjects('acme', await token());
    expect(out.map((p) => p.name)).toEqual(['active-new', 'active-old', 'done-new']);
    expect(out[0].progress).toEqual({ percent: 67, doneStages: 2, totalStages: 3 });
    expect(out[1].progress).toEqual({ percent: 0, doneStages: 0, totalStages: 0 });
    expect(out[0].publicToken).toBe('t3');
  });

  it('caps the list', async () => {
    const projects = Array.from({ length: MY_PROJECTS_MAX + 20 }, (_, i) => project({ id: `p${i}`, name: `P${i}`, publicToken: `t${i}` }));
    const { svc, token } = setup({ projects });
    expect(await svc.listMyProjects('acme', await token())).toHaveLength(MY_PROJECTS_MAX);
  });

  it('returns an empty list when nothing matches', async () => {
    const { svc, token } = setup();
    expect(await svc.listMyProjects('acme', await token('09350000000'))).toEqual([]);
  });

  it('is 404 when the projects module is disabled', async () => {
    const { svc, token } = setup();
    moduleEnabled.fn.mockImplementation(async () => false);
    await expect(svc.listMyProjects('acme', await token())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is 404 when the tenant has no installed projects module row', async () => {
    const { svc, token, controlDb } = setup();
    controlDb.tenantModule.findFirst.mockResolvedValue(null as never);
    await expect(svc.listMyProjects('acme', await token())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects garbage, expired, wrong-type and other-tenant sessions', async () => {
    const { svc, token } = setup();
    await expect(svc.listMyProjects('acme', 'not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    const expired = await jwt.signAsync({ type: 'tracking_ticket', phone: '09121234567', tenantSlug: 'acme' }, { expiresIn: -10 });
    await expect(svc.listMyProjects('acme', expired)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.listMyProjects('acme', await token('09121234567', 'acme', 'ration_result_ticket'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.listMyProjects('acme', await token('09121234567', 'other-tenant'))).rejects.toBeInstanceOf(UnauthorizedException);
    const forged = await new JwtService({ secret: 'other' }).signAsync({ type: 'tracking_ticket', phone: '09121234567', tenantSlug: 'acme' });
    await expect(svc.listMyProjects('acme', forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
