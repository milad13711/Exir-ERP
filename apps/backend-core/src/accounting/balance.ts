import type { AccountType } from '../../generated/tenant-client/index.js';

/**
 * Normal balance convention: asset/expense accounts grow on the debit side,
 * liability/equity/revenue accounts grow on the credit side.
 */
export function accountBalance(
  type: AccountType,
  lines: Array<{ debit: number; credit: number }>,
): number {
  const sign = type === 'ASSET' || type === 'EXPENSE' ? 1 : -1;
  return lines.reduce((sum, l) => sum + sign * (l.debit - l.credit), 0);
}
