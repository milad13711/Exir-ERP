import { Injectable, Optional } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { publicRef } from '../common/tenant-public-key.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { CONFIDENTIALITY_LABELS, PRIORITY_LABELS, type Confidentiality, type Priority } from './correspondence.constants.js';
import { defaultLayout, validateLayout } from './letterhead-layout.js';
import { LetterPdfService } from './pdf/letter-pdf.service.js';
import type { IncomingSlipRenderInput, LetterRenderInput, LetterheadLayout } from './render-input.js';
import { jalaliText, jalaliTimeText } from './tehran-date.js';
import { deriveVerifyToken } from './verify-token.js';

type Letter = Awaited<ReturnType<TenantRequestContext['tenantDb']['corrLetter']['findFirstOrThrow']>>;
type ParaphRow = { authorName: string; authorTitle: string | null; text: string; createdAt: Date };

export const verifyUrl = (tenantSlug: string, tenantId: string, letterId: string): string => {
  const base = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/correspondence-verify/${publicRef(tenantSlug)}/${deriveVerifyToken(tenantId, letterId)}`;
};

/** ساخت ورودی رندر (قرارداد با رندرکننده‌ی PDF) از رکورد نامه + سربرگ + مهر/امضا. */
@Injectable()
export class CorrespondenceRenderService {
  constructor(
    private readonly pdf: LetterPdfService,
    private readonly stamps: CompanyStampService,
    @Optional() private readonly controlDb?: ControlPrismaService,
  ) {}

  async orgName(ctx: TenantRequestContext): Promise<string> {
    const t = await this.controlDb?.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }).catch(() => null);
    return t?.name ?? 'سازمان';
  }

  async loadLetterhead(ctx: TenantRequestContext, letterheadId: string | null): Promise<LetterRenderInput['letterhead']> {
    const row =
      (letterheadId ? await ctx.tenantDb.corrLetterhead.findFirst({ where: { id: letterheadId, isActive: true } }) : null) ??
      (await ctx.tenantDb.corrLetterhead.findFirst({ where: { isDefault: true, isActive: true } }));
    if (!row) return { imageDataUri: null, layout: defaultLayout('A4', 'portrait') };
    let layout: LetterheadLayout;
    try {
      layout = validateLayout(row.layoutJson, row.pageSize as 'A4' | 'A5', row.orientation as 'portrait' | 'landscape');
    } catch {
      layout = defaultLayout(row.pageSize as 'A4' | 'A5', row.orientation as 'portrait' | 'landscape');
    }
    return { imageDataUri: row.backgroundImage ?? null, layout };
  }

  async build(
    ctx: TenantRequestContext,
    letter: Letter,
    extra: {
      paraphs: ParaphRow[];
      attachmentTitles: string[];
      signature: { signerName: string; signerTitle: string | null; signedAt: Date; useStamp: boolean } | null;
      watermark: LetterRenderInput['watermark'];
      withQr: boolean;
      senderTitle?: string | null;
    },
  ): Promise<LetterRenderInput> {
    const letterhead = await this.loadLetterhead(ctx, letter.letterheadId);
    let signature: LetterRenderInput['signature'] = null;
    if (extra.signature) {
      const stamp = extra.signature.useStamp ? await this.stamps.getStamp(ctx).catch(() => ({} as { signatureImage?: string; stampImage?: string })) : {};
      signature = {
        imageDataUri: stamp.signatureImage ?? null, stampDataUri: stamp.stampImage ?? null, signerName: extra.signature.signerName,
        signerTitle: extra.signature.signerTitle, signedAtText: jalaliTimeText(extra.signature.signedAt),
      };
    }
    const recipients = (Array.isArray(letter.recipients) ? letter.recipients : []) as { name: string; title?: string; org?: string }[];
    const attachmentsText = letter.attachmentsText?.trim() || (extra.attachmentTitles.length ? `${extra.attachmentTitles.length} فقره: ${extra.attachmentTitles.join('، ')}`.slice(0, 300) : null);
    return {
      letterhead,
      number: letter.letterNumber,
      dateText: letter.letterDate ? jalaliText(letter.letterDate) : jalaliText(new Date()),
      subject: letter.subject,
      bodyHtml: letter.bodyHtml,
      attachmentsText,
      recipients: recipients.map((r) => ({ name: [r.name, r.org].filter(Boolean).join(' - '), title: r.title ?? null })),
      ccNames: letter.ccNames,
      sender: { name: letter.createdByName ?? '', title: extra.senderTitle ?? null },
      paraphs: extra.paraphs.map((p) => ({ authorName: p.authorName, authorTitle: p.authorTitle, text: p.text, dateText: jalaliTimeText(p.createdAt) })),
      signature,
      qr: extra.withQr ? { verifyUrl: verifyUrl(ctx.tenantSlug, ctx.tenantId, letter.id) } : null,
      watermark: extra.watermark,
      confidentialityLabel: letter.confidentiality === 'NORMAL' ? null : CONFIDENTIALITY_LABELS[letter.confidentiality as Confidentiality] ?? null,
      priorityLabel: letter.priority === 'NORMAL' ? null : PRIORITY_LABELS[letter.priority as Priority] ?? null,
    };
  }

  /** priority=true فقط برای فاز ۲ امضا (slot رزرو + معاف از سطل توکن) */
  render(input: LetterRenderInput, ctx: TenantRequestContext, priority = false): Promise<Buffer> {
    return this.pdf.render(input, { persianDigits: true, tenantId: ctx.tenantId, userId: ctx.auth.sub, priority });
  }

  async slipInput(ctx: TenantRequestContext, letter: Letter): Promise<IncomingSlipRenderInput> {
    return {
      orgName: await this.orgName(ctx),
      secretariatNumber: letter.letterNumber ?? '',
      registeredAtText: jalaliTimeText(letter.registeredAt ?? letter.createdAt),
      externalNumber: letter.externalNumber,
      externalDateText: letter.externalDate ? jalaliText(letter.externalDate) : null,
      senderName: [letter.senderOrgName, letter.senderName].filter(Boolean).join(' - ') || '—',
      subject: letter.subject,
      pageCount: letter.pageCount,
      attachmentsText: letter.attachmentsText,
      registrarName: letter.registeredByName ?? letter.createdByName ?? '',
      qr: { verifyUrl: verifyUrl(ctx.tenantSlug, ctx.tenantId, letter.id) },
    };
  }

  async renderSlip(ctx: TenantRequestContext, letter: Letter, variant: 'slip' | 'label'): Promise<Buffer> {
    const input = await this.slipInput(ctx, letter);
    return this.pdf.renderIncomingSlip(input, { variant, headerImageDataUri: null, persianDigits: true, tenantId: ctx.tenantId, userId: ctx.auth.sub });
  }
}
