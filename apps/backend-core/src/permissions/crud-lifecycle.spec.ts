import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { PermissionsService } from './permissions.service.js';
import { BankingLifecycleService } from '../accounting/banking/banking-lifecycle.service.js';
import { EventsService } from '../events/events.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { DispatchRulesService } from '../dispatch/dispatch-rules.service.js';
import { ProductionOrdersController } from '../production/orders.controller.js';
import { TestTypesController } from '../quality-control/test-types.controller.js';
import { QualitySamplesController } from '../quality-control/samples.controller.js';
import { RationDiscountCodesController } from '../ration-lab/discount-codes.controller.js';
import { AttendanceController } from '../hr/attendance.controller.js';
import { ContractsController } from '../contracts/contracts.controller.js';
import { EventsController } from '../events/events.controller.js';

const ctxWith = (db: Record<string, unknown>) => ({ tenantDb: db, auth: { role: 'OWNER' }, tenantId: 't1' }) as unknown as TenantRequestContext;
const deny = new Proxy({}, { get: () => vi.fn().mockRejectedValue(new ForbiddenException()) }) as unknown as PermissionsService;
const ctx = ctxWith({});

describe('banking delete rules (accounting records stay immutable)', () => {
  const svc = new BankingLifecycleService();
  it('refuses a bank with transactions, cheque books or an opening entry', async () => {
    for (const bank of [{ tx: 1, books: 0, opening: null }, { tx: 0, books: 2, opening: null }, { tx: 0, books: 0, opening: 'je1' }]) {
      const db = {
        bankAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'b', name: 'ملی', openingEntryId: bank.opening }), delete: vi.fn() },
        bankTransaction: { count: vi.fn().mockResolvedValue(bank.tx) },
        chequeBook: { count: vi.fn().mockResolvedValue(bank.books) },
      };
      await expect(svc.deleteBank(ctxWith(db), 'b')).rejects.toBeInstanceOf(ConflictException);
      expect(db.bankAccount.delete).not.toHaveBeenCalled();
    }
  });
  it('deletes a pristine bank / cash box / cheque book', async () => {
    const db = {
      bankAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'b', name: 'x', openingEntryId: null }), delete: vi.fn() },
      cashBox: { findUnique: vi.fn().mockResolvedValue({ id: 'c', name: 'x', openingEntryId: null }), delete: vi.fn() },
      chequeBook: { findUnique: vi.fn().mockResolvedValue({ id: 'k', name: 'x' }), count: vi.fn().mockResolvedValue(0), delete: vi.fn() },
      chequeLeaf: { count: vi.fn().mockResolvedValue(0) },
      bankTransaction: { count: vi.fn().mockResolvedValue(0) },
    };
    await svc.deleteBank(ctxWith(db), 'b');
    await svc.deleteCashBox(ctxWith(db), 'c');
    await svc.deleteChequeBook(ctxWith(db), 'k');
    expect(db.bankAccount.delete).toHaveBeenCalled();
    expect(db.cashBox.delete).toHaveBeenCalled();
    expect(db.chequeBook.delete).toHaveBeenCalled();
  });
  it('refuses a cheque book with used leaves', async () => {
    const db = { chequeBook: { findUnique: vi.fn().mockResolvedValue({ id: 'k', name: 'x' }), delete: vi.fn() }, chequeLeaf: { count: vi.fn().mockResolvedValue(3) } };
    await expect(svc.deleteChequeBook(ctxWith(db), 'k')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('events / contracts / dispatch doc-type delete rules', () => {
  it('event with bookings or tickets cannot be deleted', async () => {
    const db = {
      event: { findUnique: vi.fn().mockResolvedValue({ id: 'e', status: 'DRAFT' }), delete: vi.fn() },
      eventBooking: { count: vi.fn().mockResolvedValue(1) },
      eventTicket: { count: vi.fn().mockResolvedValue(0) },
    };
    await expect(EventsService.prototype.remove.call({}, ctxWith(db), 'e')).rejects.toBeInstanceOf(ConflictException);
    db.eventBooking.count.mockResolvedValue(0);
    await expect(EventsService.prototype.remove.call({}, ctxWith(db), 'e')).resolves.toEqual({ ok: true });
  });

  it('only an unsigned, unlocked, dependency-free DRAFT contract can be deleted', async () => {
    const base = { id: 'c', status: 'DRAFT', isLocked: false, partyASignedAt: null, partyBSignedAt: null, _count: { amendments: 0, editRequests: 0, mentoringEngagements: 0 } };
    const mk = (row: Record<string, unknown>) => ({ contract: { findUnique: vi.fn().mockResolvedValue({ ...base, ...row }), delete: vi.fn() }, attachment: { deleteMany: vi.fn() } });
    for (const bad of [{ status: 'ACTIVE' }, { isLocked: true }, { partyASignedAt: new Date() }, { partyBSignedAt: new Date() }, { _count: { amendments: 1, editRequests: 0, mentoringEngagements: 0 } }]) {
      const db = mk(bad);
      await expect(ContractsService.prototype.remove.call({}, ctxWith(db), 'c')).rejects.toBeInstanceOf(ConflictException);
      expect(db.contract.delete).not.toHaveBeenCalled();
    }
    const ok = mk({});
    await ContractsService.prototype.remove.call({}, ctxWith(ok), 'c');
    expect(ok.contract.delete).toHaveBeenCalled();
  });

  it('system or in-use dispatch doc types are not deletable', async () => {
    const mk = (type: Record<string, unknown>, docs: number, rules: number) => ({
      dispatchDocType: { findUnique: vi.fn().mockResolvedValue({ id: 't', code: 'x', isSystem: false, ...type }), delete: vi.fn() },
      shipmentDocument: { count: vi.fn().mockResolvedValue(docs) },
      dispatchDocRule: { count: vi.fn().mockResolvedValue(rules) },
    });
    await expect(DispatchRulesService.prototype.deleteDocType.call({}, ctxWith(mk({ isSystem: true }, 0, 0)), 't')).rejects.toBeInstanceOf(ConflictException);
    await expect(DispatchRulesService.prototype.deleteDocType.call({}, ctxWith(mk({}, 1, 0)), 't')).rejects.toBeInstanceOf(ConflictException);
    await expect(DispatchRulesService.prototype.deleteDocType.call({}, ctxWith(mk({}, 0, 1)), 't')).rejects.toBeInstanceOf(ConflictException);
    await expect(DispatchRulesService.prototype.deleteDocType.call({}, ctxWith(mk({}, 0, 0)), 't')).resolves.toEqual({ success: true });
  });
});

describe('production order edit/delete', () => {
  const c = new ProductionOrdersController(deny, {} as never, {} as never);
  it('is permission-guarded', async () => {
    await expect(c.update('o', {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.remove('o', ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
  const allow = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }) as unknown as PermissionsService;
  const ok = new ProductionOrdersController(allow, {} as never, {} as never);
  it('only DRAFT can be edited; only DRAFT/CANCELLED without QC samples can be deleted', async () => {
    const mk = (status: string, samples = 0) => ({
      productionOrder: { findUnique: vi.fn().mockResolvedValue({ id: 'o', status, _count: { qualitySamples: samples } }), delete: vi.fn(), update: vi.fn() },
    });
    await expect(ok.update('o', { quantityPlanned: 5 }, ctxWith(mk('IN_PROGRESS')))).rejects.toBeInstanceOf(ConflictException);
    for (const st of ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'QC_PENDING', 'RAW_MATERIAL_APPROVED']) {
      const db = mk(st);
      await expect(ok.remove('o', ctxWith(db))).rejects.toBeInstanceOf(ConflictException);
      expect(db.productionOrder.delete).not.toHaveBeenCalled();
    }
    await expect(ok.remove('o', ctxWith(mk('DRAFT', 1)))).rejects.toBeInstanceOf(ConflictException);
    const good = mk('CANCELLED');
    await expect(ok.remove('o', ctxWith(good))).resolves.toEqual({ success: true });
  });
});

describe('guards on the newly added routes', () => {
  it('quality-control / ration-lab / attendance / contract / event routes require their permission', async () => {
    const tt = new TestTypesController(deny);
    await expect(tt.update('t', {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(tt.archive('t', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(tt.remove('t', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const qs = new QualitySamplesController(deny, {} as never);
    await expect(qs.update('s', {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(qs.remove('s', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(qs.removeResult('s', 'r', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const dc = new RationDiscountCodesController(deny);
    await expect(dc.update('d', {}, ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(dc.remove('d', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new AttendanceController(deny).remove('a', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const events = new EventsController({} as never, {} as never, {} as never, deny, {} as never);
    await expect(events.remove('e', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ContractsController.prototype.remove).toBeTypeOf('function');
  });
});
