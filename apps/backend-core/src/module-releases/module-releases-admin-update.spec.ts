import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ModuleReleasesAdminService } from './module-releases-admin.service.js';

function make(release: { id: string; status: string } | null) {
  const tx = { moduleRelease: { update: vi.fn() }, moduleReleaseChange: { deleteMany: vi.fn(), createMany: vi.fn() } };
  const controlDb: any = {
    moduleRelease: { findUnique: vi.fn(async () => release), update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const svc: any = new (ModuleReleasesAdminService as any)(controlDb, {}, {});
  svc.get = vi.fn(async () => ({ id: 'r1' }));
  return { svc, tx, controlDb };
}

describe('ModuleReleasesAdminService.update — فقط پیش‌نویس', () => {
  it('انتشار منتشرشده (یا هر وضعیت غیر DRAFT) ۴۰۹ می‌دهد و چیزی نمی‌نویسد', async () => {
    for (const status of ['PUBLISHED', 'PUBLISHING', 'ARCHIVED']) {
      const { svc, tx, controlDb } = make({ id: 'r1', status });
      await expect(svc.update('r1', { title: 'تازه' })).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.update('r1', { title: 'تازه' })).rejects.toThrow('پیش‌نویس');
      expect(controlDb.$transaction).not.toHaveBeenCalled();
      expect(tx.moduleRelease.update).not.toHaveBeenCalled();
    }
  });
  it('پیش‌نویس ویرایش می‌شود؛ نبودن انتشار ۴۰۴', async () => {
    const { svc, tx } = make({ id: 'r1', status: 'DRAFT' });
    await svc.update('r1', { title: 'عنوان جدید' });
    expect(tx.moduleRelease.update).toHaveBeenCalledOnce();
    await expect(make(null).svc.update('x', { title: 'a' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
