import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SalesAccountingBackfillController } from './sales-accounting-backfill.controller.js';
import { SalesAccountingBackfillService } from './sales-accounting-backfill.service.js';

describe('backfill report access', () => {
  it('non-manager gets 403 and lastReport is never read; manager gets the report', async () => {
    const svc = Object.create(SalesAccountingBackfillService.prototype) as SalesAccountingBackfillService;
    svc.lastReport = vi.fn(async () => ({ ok: true }) as never);
    const c = new SalesAccountingBackfillController(svc);
    await expect(c.report({ auth: { role: 'MEMBER' } } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.lastReport).not.toHaveBeenCalled();
    await expect(c.report({ auth: { role: 'ADMIN' } } as never)).resolves.toEqual({ report: { ok: true } });
  });
});
