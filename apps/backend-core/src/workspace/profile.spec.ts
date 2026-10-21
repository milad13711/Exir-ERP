import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { normalizeDisplayName } from './profile-name.js';
import { ProfileSyncService } from './profile-sync.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { WorkspaceController } from './workspace.controller.js';

describe('normalizeDisplayName', () => {
  it('trims, collapses spaces and strips control/bidi characters', () => {
    expect(normalizeDisplayName('  علی   رضایی  ')).toBe('علی رضایی');
    expect(normalizeDisplayName('عل‮ی⁦ رضا\u0007یی')).toBe('علی رضایی');
    expect(normalizeDisplayName('می‌رزا')).toBe('می‌رزا'); // ZWNJ لازم است
  });
  it('2..80 characters, must contain a letter, with clear Persian errors', () => {
    expect(() => normalizeDisplayName(' ع ')).toThrow(/۲ نویسه/);
    expect(() => normalizeDisplayName('x'.repeat(81))).toThrow(/۸۰/);
    expect(() => normalizeDisplayName('12345')).toThrow(/حرف/);
    expect(() => normalizeDisplayName('‮⁦  ')).toThrow(BadRequestException);
    expect(normalizeDisplayName('x'.repeat(80))).toHaveLength(80);
  });
});

describe('UpdateProfileDto', () => {
  const check = async (o: object) => validate(plainToInstance(UpdateProfileDto, o), { whitelist: true, forbidNonWhitelisted: true });
  it('accepts a plain rename and an untouched legacy avatar (link or oversized) without blocking the name', async () => {
    expect(await check({ name: 'علی رضایی' })).toHaveLength(0);
    expect(await check({ name: 'علی رضایی', avatarUrl: 'https://example.com/a.jpg' })).toHaveLength(0);
    expect(await check({ name: 'علی', avatarUrl: null, email: null })).toHaveLength(0);
  });
  it('still rejects unknown fields and non-string names', async () => {
    expect((await check({ name: 123 })).length).toBeGreaterThan(0);
    expect((await check({ name: 'x', role: 'OWNER' })).length).toBeGreaterThan(0);
  });
});

function make(opts: { name?: string | null; avatar?: string | null } = {}) {
  const state = { name: opts.name ?? 'نام قدیم', avatarUrl: opts.avatar ?? null };
  const controlDb = {
    globalUser: {
      findUniqueOrThrow: vi.fn(async () => ({ ...state })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state, data)),
    },
  };
  const activity: unknown[] = [];
  const tenantDb = {
    user: { updateMany: vi.fn(async () => ({})), findUnique: async () => ({ id: 'tu1', email: null }) },
    activityLog: { create: vi.fn(async (a: unknown) => { activity.push(a); return {}; }) },
  };
  const sync = { syncName: vi.fn(async () => ({ tenants: 2, failed: 0 })) };
  const c = new WorkspaceController(controlDb as never, {} as never, {} as never, {} as never, sync as never);
  return { c, controlDb, tenantDb, sync, activity, state, ctx: { auth: { sub: 'g1' }, tenantDb } as never };
}

describe('PATCH /me/profile', () => {
  it('renames, syncs every tenant, and writes an audit row (old and new name)', async () => {
    const h = make();
    const r = await h.c.updateProfile({ name: '  علی   رضایی ' }, h.ctx);
    expect(r.name).toBe('علی رضایی');
    expect(h.controlDb.globalUser.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { name: 'علی رضایی' } });
    expect(h.sync.syncName).toHaveBeenCalledWith('g1', 'علی رضایی');
    expect(h.activity[0]).toMatchObject({ data: { action: 'profile.name_changed', metadata: { from: 'نام قدیم', to: 'علی رضایی', tenantsSynced: 2 } } });
  });
  it('an unchanged legacy avatar (even invalid by today’s caps) never blocks a rename', async () => {
    const legacy = 'https://old.example.com/avatar.jpg';
    const h = make({ avatar: legacy });
    const r = await h.c.updateProfile({ name: 'نام جدید', avatarUrl: legacy }, h.ctx);
    expect(r.name).toBe('نام جدید');
    expect(h.controlDb.globalUser.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { name: 'نام جدید' } });
  });
  it('a changed avatar is validated with a clear message', async () => {
    const h = make();
    await expect(h.c.updateProfile({ avatarUrl: 'https://evil.example/x.png' }, h.ctx)).rejects.toThrow(/تصویر پروفایل/);
    await expect(h.c.updateProfile({ avatarUrl: 'data:image/svg+xml;base64,AAAA' }, h.ctx)).rejects.toThrow(/تصویر پروفایل/);
    expect(h.controlDb.globalUser.update).not.toHaveBeenCalled();
  });
  it('same name → no write, no sync, no audit; invalid name → 400 with Persian message', async () => {
    const h = make({ name: 'علی رضایی' });
    await h.c.updateProfile({ name: 'علی  رضایی' }, h.ctx);
    expect(h.controlDb.globalUser.update).not.toHaveBeenCalled();
    expect(h.sync.syncName).not.toHaveBeenCalled();
    await expect(h.c.updateProfile({ name: 'ع' }, h.ctx)).rejects.toThrow(/۲ نویسه/);
  });
});

describe('ProfileSyncService', () => {
  it('updates User and the linked Employee in every tenant, keeps going when one tenant fails', async () => {
    const calls: string[] = [];
    const dbFor = (slug: string, fail = false) => ({
      user: { findUnique: async () => ({ id: `u-${slug}` }), update: async () => { if (fail) throw new Error('down'); calls.push(`user:${slug}`); } },
      employee: { updateMany: async () => { calls.push(`emp:${slug}`); } },
    });
    const controlDb = { tenantMembership: { findMany: async () => [
      { tenant: { id: '1', slug: 'a', dbHost: 'h', dbPort: 1, dbName: 'a' } },
      { tenant: { id: '2', slug: 'b', dbHost: 'h', dbPort: 1, dbName: 'b' } },
      { tenant: { id: '3', slug: 'c', dbHost: 'h', dbPort: 1, dbName: 'c' } },
    ] } };
    const tp = { forTenant: ({ dbName }: { dbName: string }) => dbFor(dbName, dbName === 'b') };
    const r = await new ProfileSyncService(controlDb as never, tp as never).syncName('g', 'نام');
    expect(r).toEqual({ tenants: 3, failed: 1 });
    expect(calls).toEqual(['user:a', 'emp:a', 'user:c', 'emp:c']);
  });
});
