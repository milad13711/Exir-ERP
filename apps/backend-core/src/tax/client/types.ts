/** ایستادن در برابر وابستگی مستقیم به enumهای Prisma در لایه‌ی خالص (تست بدون کلاینت تولیدشده). */
export type TaxEnvironment = 'SANDBOX' | 'PRODUCTION';
export type TaxInvoiceStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'QUEUED'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';
