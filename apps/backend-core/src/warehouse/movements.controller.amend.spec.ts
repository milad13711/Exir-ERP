import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MovementsController } from './movements.controller.js';

function setup(p: { canEdit?: boolean; canDelete?: boolean }) {
  const perms = {
    assertEdit: vi.fn(async () => { if (p.canEdit === false) throw new ForbiddenException(); }),
    assertDelete: vi.fn(async () => { if (p.canDelete === false) throw new ForbiddenException(); }),
    assertViewAll: vi.fn(),
  } as any;
  const amendment = { edit: vi.fn(async () => 'e'), void: vi.fn(async () => 'v'), detail: vi.fn(async () => 'd') } as any;
  const c = new (MovementsController as any)({}, perms, {}, amendment) as MovementsController;
  return { c, perms, amendment };
}

describe('MovementsController edit/void permissions', () => {
  it('edit needs canEdit, void needs canDelete', async () => {
    const a = setup({ canEdit: false });
    await expect(a.c.edit('m', { reason: 'xxx' } as any, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.amendment.edit).not.toHaveBeenCalled();
    const b = setup({ canDelete: false });
    await expect(b.c.voidMovement('m', { reason: 'xxx' } as any, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.amendment.void).not.toHaveBeenCalled();
    const ok = setup({});
    await expect(ok.c.voidMovement('m', { reason: '  دلیل  ' } as any, {} as any)).resolves.toBe('v');
    expect(ok.amendment.void).toHaveBeenCalledWith({}, 'm', 'دلیل');
  });
});
