import { describe, expect, it, vi } from 'vitest';
import { PayrollController } from './payroll.controller.js';

function makeCtx(slip: any) {
  return {
    tenantDb: {
      payrollSlip: {
        findUnique: vi.fn(async () => slip),
        delete: vi.fn(),
      },
    },
  } as any;
}

describe('PayrollController.remove', () => {
  const perms = { assertDelete: vi.fn() } as any;
  const c = new (PayrollController as any)(perms, {}, {}) as PayrollController;

  it('deletes a DRAFT slip', async () => {
    const ctx = makeCtx({ id: 's1', status: 'DRAFT' });
    await expect(c.remove('s1', ctx)).resolves.toEqual({ success: true });
    expect(ctx.tenantDb.payrollSlip.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it.each(['ISSUED', 'PAID'])('refuses to delete a %s slip', async (status) => {
    const ctx = makeCtx({ id: 's1', status });
    await expect(c.remove('s1', ctx)).rejects.toThrow(/پیش‌نویس/);
    expect(ctx.tenantDb.payrollSlip.delete).not.toHaveBeenCalled();
  });

  it('404s on unknown slip', async () => {
    await expect(c.remove('x', makeCtx(null))).rejects.toThrow(/یافت نشد/);
  });
});
