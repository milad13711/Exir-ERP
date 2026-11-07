import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { DriversService } from './drivers.service.js';
import { DriversController } from './drivers.controller.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';

function ctxWith(db: Record<string, unknown>): TenantRequestContext {
  return { tenantDb: db, auth: { role: 'OWNER' }, tenantId: 't1' } as unknown as TenantRequestContext;
}

describe('DriversService delete / archive / restore', () => {
  const svc = new DriversService();

  function db(counts: { shipments: number; offers: number }) {
    return {
      driver: {
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', isActive: true }),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'd1', ...data })),
        delete: vi.fn().mockResolvedValue({}),
      },
      shipment: { count: vi.fn().mockResolvedValue(counts.shipments) },
      shipmentOffer: { count: vi.fn().mockResolvedValue(counts.offers) },
    };
  }

  it('hard-deletes an unreferenced driver', async () => {
    const d = db({ shipments: 0, offers: 0 });
    await expect(svc.remove(ctxWith(d), 'd1')).resolves.toEqual({ success: true });
    expect(d.driver.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('refuses to delete a driver with shipments/offers and suggests archive', async () => {
    const d = db({ shipments: 2, offers: 1 });
    await expect(svc.remove(ctxWith(d), 'd1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.remove(ctxWith(d), 'd1')).rejects.toThrow(/بایگانی/);
    expect(d.driver.delete).not.toHaveBeenCalled();
  });

  it('archives and restores', async () => {
    const d = db({ shipments: 1, offers: 0 });
    expect(await svc.archive(ctxWith(d), 'd1')).toMatchObject({ isActive: false });
    expect(await svc.restore(ctxWith(d), 'd1')).toMatchObject({ isActive: true });
  });
});

describe('ShipmentsService update / remove', () => {
  const svc = new ShipmentsService({} as never, {} as never, {} as never, {} as never);

  function db(status: string, loading = false) {
    return {
      shipment: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', status }),
        update: vi.fn().mockResolvedValue({ id: 's1' }),
        delete: vi.fn().mockResolvedValue({}),
      },
      shipmentLoading: {
        findUnique: vi.fn().mockResolvedValue(loading ? { id: 'l1' } : null),
        count: vi.fn().mockResolvedValue(loading ? 1 : 0),
      },
      shipmentOffer: { count: vi.fn().mockResolvedValue(0) },
      attachment: { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  it('edits only DRAFT shipments', async () => {
    const ok = db('DRAFT');
    await svc.update(ctxWith(ok), 's1', { cargoType: 'x', pickupAt: '2026-11-10T08:00:00.000Z' });
    expect(ok.shipment.update).toHaveBeenCalled();
    const offered = db('OFFERED');
    await expect(svc.update(ctxWith(offered), 's1', { cargoType: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes DRAFT/CANCELLED only, never accepted/delivered or dispatch-workflow shipments', async () => {
    for (const st of ['DRAFT', 'CANCELLED']) {
      const d = db(st);
      await expect(svc.remove(ctxWith(d), 's1')).resolves.toEqual({ success: true });
      expect(d.attachment.deleteMany).toHaveBeenCalled();
    }
    for (const st of ['OFFERED', 'ACCEPTED', 'DELIVERED']) {
      const d = db(st);
      await expect(svc.remove(ctxWith(d), 's1')).rejects.toBeInstanceOf(ConflictException);
      expect(d.shipment.delete).not.toHaveBeenCalled();
    }
    const inDispatch = db('DRAFT', true);
    await expect(svc.remove(ctxWith(inDispatch), 's1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('fleet controllers permission guards', () => {
  const deny = {
    assertView: vi.fn().mockRejectedValue(new ForbiddenException()),
    assertViewAll: vi.fn().mockRejectedValue(new ForbiddenException()),
    assertCreate: vi.fn().mockRejectedValue(new ForbiddenException()),
    assertEdit: vi.fn().mockRejectedValue(new ForbiddenException()),
    assertDelete: vi.fn().mockRejectedValue(new ForbiddenException()),
  } as unknown as PermissionsService;
  const ctx = ctxWith({});

  it('driver delete requires canDelete; archive/restore require canEdit', async () => {
    const drivers = { remove: vi.fn(), archive: vi.fn(), restore: vi.fn(), usage: vi.fn() };
    const c = new DriversController(drivers as never, deny);
    await expect(c.remove('d1', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.archive('d1', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.restore('d1', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.usage('d1', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(drivers.remove).not.toHaveBeenCalled();
    expect(drivers.archive).not.toHaveBeenCalled();
  });

  it('shipment update/delete are guarded', async () => {
    const shipments = { update: vi.fn(), remove: vi.fn(), usage: vi.fn() };
    const c = new ShipmentsController(shipments as never, deny);
    await expect(c.update('s1', {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.remove('s1', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(shipments.update).not.toHaveBeenCalled();
    expect(shipments.remove).not.toHaveBeenCalled();
  });
});
