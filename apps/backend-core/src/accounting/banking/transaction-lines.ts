import { BadRequestException } from '@nestjs/common';
import type { PostingLine } from '../journal-posting.js';

/**
 * سند حسابداری متوازن یک تراکنش بانک/صندوق (مبلغ صحیح تومان):
 *  دریافت: بدهکار حساب بانک/صندوق ← بستانکار حساب مقابل
 *  پرداخت: بدهکار حساب مقابل ← بستانکار حساب بانک/صندوق
 *  انتقال: بدهکار مقصد ← بستانکار مبدأ
 */
export function buildTransactionLines(
  type: 'RECEIPT' | 'PAYMENT' | 'TRANSFER',
  amount: number,
  holderAccountId: string,
  otherAccountId: string,
): PostingLine[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('مبلغ باید عدد صحیح مثبت (تومان) باشد');
  if (holderAccountId === otherAccountId) throw new BadRequestException('حساب مبدأ و مقصد/مقابل نمی‌تواند یکی باشد');
  const a = BigInt(amount);
  if (type === 'RECEIPT') {
    return [
      { accountId: holderAccountId, debit: a, credit: 0n },
      { accountId: otherAccountId, debit: 0n, credit: a },
    ];
  }
  if (type === 'PAYMENT') {
    return [
      { accountId: otherAccountId, debit: a, credit: 0n },
      { accountId: holderAccountId, debit: 0n, credit: a },
    ];
  }
  // TRANSFER: holder = مبدأ، other = مقصد
  return [
    { accountId: otherAccountId, debit: a, credit: 0n },
    { accountId: holderAccountId, debit: 0n, credit: a },
  ];
}

/** سند افتتاحیه‌ی بانک/صندوق در برابر حساب ۳۰۲۰؛ مانده‌ی منفی طرف مقابل را جابه‌جا می‌کند. */
export function buildOpeningLines(openingBalance: number, holderAccountId: string, equityAccountId: string): PostingLine[] {
  if (!Number.isSafeInteger(openingBalance) || openingBalance === 0) throw new BadRequestException('مانده‌ی افتتاحیه نامعتبر است');
  const a = BigInt(Math.abs(openingBalance));
  return openingBalance > 0
    ? [
        { accountId: holderAccountId, debit: a, credit: 0n },
        { accountId: equityAccountId, debit: 0n, credit: a },
      ]
    : [
        { accountId: equityAccountId, debit: a, credit: 0n },
        { accountId: holderAccountId, debit: 0n, credit: a },
      ];
}
