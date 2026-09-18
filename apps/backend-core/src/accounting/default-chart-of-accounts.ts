import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

export type AccountSeed = {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isCashAccount?: boolean;
};

/** A standard Iranian SMB chart of accounts — seeded once, the first time the tenant opens Accounting. */
export const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { code: '1010', name: 'صندوق', type: 'ASSET', isCashAccount: true },
  { code: '1020', name: 'بانک', type: 'ASSET', isCashAccount: true },
  { code: '1030', name: 'حساب‌های دریافتنی (مشتریان)', type: 'ASSET' },
  { code: '1040', name: 'موجودی کالا', type: 'ASSET' },
  { code: '2010', name: 'حساب‌های پرداختنی (تأمین‌کنندگان)', type: 'LIABILITY' },
  { code: '2020', name: 'مالیات پرداختنی', type: 'LIABILITY' },
  { code: '3010', name: 'سرمایه', type: 'EQUITY' },
  { code: '4010', name: 'درآمد فروش', type: 'REVENUE' },
  { code: '5010', name: 'بهای تمام‌شده کالای فروش‌رفته', type: 'EXPENSE' },
  { code: '5020', name: 'هزینه‌های اداری و عمومی', type: 'EXPENSE' },
  { code: '5030', name: 'هزینه حقوق و دستمزد', type: 'EXPENSE' },
  { code: '5040', name: 'هزینه کمیسیون فروش/نمایندگی', type: 'EXPENSE' },
];

export async function ensureDefaultChartOfAccounts(db: TenantPrismaClient): Promise<void> {
  const count = await db.account.count();
  if (count > 0) return;
  try {
    await db.account.createMany({
      data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, isSystem: true })),
    });
  } catch (err) {
    // Two requests can both see count()===0 and race to seed (this endpoint
    // is called on every GET, not gated behind tenant provisioning). If a
    // concurrent call already inserted the defaults, that's the outcome we
    // wanted anyway — only re-throw a genuinely different failure.
    const isUniqueConstraintViolation =
      typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
    if (!isUniqueConstraintViolation) throw err;
  }
}
