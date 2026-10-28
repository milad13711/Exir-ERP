import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { hashContent } from '../common/signature-evidence/signature-evidence.util.js';
import { snapshotInvoice } from './invoice-amendment.js';

/** سیاست امضای داخلی فاکتور: خاموش | اختیاری | الزامی پیش از صدور (تأیید) فاکتور. */
export const SIGNATURE_POLICIES = ['off', 'optional', 'required'] as const;
export type SignaturePolicy = (typeof SIGNATURE_POLICIES)[number];

export const SIGN_ENTITY_TYPE = 'SALES_INVOICE_SIGN';
export const SIGNATURE_POLICY_KEY = 'internalSignaturePolicy';
export const SALES_MODULE = 'sales';

/** انواع امضای ثبت‌شده روی فاکتور: DRAWN = امضای دست‌نویس مستقیم (مسیر قدیمی)؛ دو نوع دیگر تصاویر ثبت‌شده‌ی شرکت از کارتابل. */
export const SIGNATURE_KINDS = ['DRAWN', 'SIGNATURE', 'STAMP_AND_SIGNATURE'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export function parseSignaturePolicy(value: unknown): SignaturePolicy {
  return value === 'optional' || value === 'required' ? value : 'off';
}

export async function readSignaturePolicy(tenantDb: Pick<TenantPrismaClient, 'moduleSetting'>): Promise<SignaturePolicy> {
  const row = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: SALES_MODULE, key: SIGNATURE_POLICY_KEY } } });
  return parseSignaturePolicy(row?.value);
}

type HashableInvoice = Parameters<typeof snapshotInvoice>[0] & { officialInvoiceNo?: number | null; invoiceNo?: number };

/**
 * هش پایدار از «محتوای مالی» فاکتور — در لحظه‌ی امضا ذخیره می‌شود و بعداً هر تغییری (حتی از مسیرهایی غیر از ویرایش،
 * مثل تعدیل وزن بار) با مقایسه‌ی آن تشخیص داده می‌شود. ترتیب اقلام روی هش اثر ندارد.
 */
export function invoiceContentHash(inv: HashableInvoice): string {
  const snap = snapshotInvoice(inv);
  const lines = [...snap.lines].sort((a, b) => `${a.productId ?? ''}|${a.description}|${a.quantity}|${a.unitPrice}`.localeCompare(`${b.productId ?? ''}|${b.description}|${b.quantity}|${b.unitPrice}`));
  return hashContent({ invoiceNo: inv.invoiceNo ?? null, officialInvoiceNo: inv.officialInvoiceNo ?? null, ...snap, contactName: undefined, lines });
}

/** امضای فعلی فاکتور بعد از امضا تغییر کرده است؟ (فقط وقتی هش ثبت شده باشد؛ امضاهای قدیمی بدون هش «معتبر» حساب می‌شوند.) */
export function isSignatureStale(inv: { signedAt: Date | null; signedContentHash: string | null }, currentHash: string): boolean {
  return !!inv.signedAt && !!inv.signedContentHash && inv.signedContentHash !== currentHash;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\s/g, '');
  return d.length >= 7 ? `${d.slice(0, 4)}***${d.slice(-3)}` : null;
}

/**
 * امضای فاکتور را پاک و در تاریخچه (DocumentRevision) ثبت می‌کند و درخواست امضای در انتظار را می‌بندد.
 * فاکتور صادرشده با قواعد ویرایش/ابطال (invoice-amendment) محافظت می‌شود؛ این مسیر برای پیش‌نویسِ ویرایش‌شده و امضای کهنه است.
 */
export async function clearInvoiceSignature(
  ctx: TenantRequestContext,
  approvals: { closeForEntity(ctx: TenantRequestContext, entityType: string, entityId: string, status: 'APPROVED' | 'REJECTED'): Promise<unknown> },
  invoiceId: string,
  reason: string,
  userId: string | null,
): Promise<void> {
  const db = ctx.tenantDb;
  const inv = await db.salesInvoice.findUnique({ where: { id: invoiceId }, select: { signedAt: true, signedByName: true, signatureKind: true, revisionCount: true } });
  if (!inv?.signedAt) return;
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
  await db.$transaction([
    db.salesInvoice.update({
      where: { id: invoiceId },
      data: {
        signedAt: null,
        signedByUserId: null,
        signedByName: null,
        signatureDataUrl: null,
        stampDataUrl: null,
        signatureKind: null,
        signedContentHash: null,
        signatureInvalidatedAt: new Date(),
        signatureInvalidReason: reason,
        revisionCount: { increment: 1 },
      },
    }),
    db.documentRevision.create({
      data: {
        entityType: 'sales_invoice',
        entityId: invoiceId,
        revisionNo: inv.revisionCount + 1,
        action: 'SIGNATURE_INVALIDATED',
        reason,
        before: { signedBy: inv.signedByName, kind: inv.signatureKind } as never,
        after: { signed: false } as never,
        changes: [{ field: 'امضا', from: `امضاشده توسط ${inv.signedByName ?? '—'}`, to: 'بی‌اعتبار شد' }] as never,
        userId,
        userName: user?.name ?? null,
      },
    }),
  ]);
  await approvals.closeForEntity(ctx, SIGN_ENTITY_TYPE, invoiceId, 'REJECTED');
}
