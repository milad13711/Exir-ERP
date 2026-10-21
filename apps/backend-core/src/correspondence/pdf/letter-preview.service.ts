import { BadRequestException, Injectable } from '@nestjs/common';
import { formatJalaliDate } from '../../common/persian.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import type { PreviewPdfDto, SamplePdfDto } from '../dto/letterhead.dto.js';
import { validateLayout } from '../letterhead-layout.js';
import { LetterheadService, validateBackgroundImage } from '../letterhead.service.js';
import type { LetterRenderInput } from '../render-input.js';
import { applyTemplate } from '../templates.apply.js';
import { SAMPLE_CONTEXT, TemplatesService } from '../templates.service.js';
import { LetterPdfService } from './letter-pdf.service.js';
import { sanitizeLetterHtml } from './sanitize-letter-html.js';

const SAMPLE_PARAGRAPH =
  '<p>احتراماً، این متن نمونه برای آزمودن جایگاه، فونت و ترازبندی نامه است. محتوای واقعی نامه در همین قسمت جایگزین خواهد شد و همچنان با تراز دوطرفه و فاصله‌ی خطوط تنظیم‌شده در سربرگ نمایش داده می‌شود.</p>';

export function sampleBody(long: boolean): string {
  return SAMPLE_PARAGRAPH.repeat(long ? 36 : 3);
}

/**
 * ساخت LetterRenderInput «سمت سرور» از فیلدهای پیش‌نویس (هرگز ورودی خام کلاینت) — بدنه پاک‌سازی می‌شود،
 * جای خالی‌ها با داده‌ی نمونه پر می‌شود. این سرویس برای پیش‌نمایش/طراح سربرگ است؛ نامه‌ی واقعی را A1 می‌سازد.
 */
@Injectable()
export class LetterPreviewService {
  constructor(
    private readonly pdf: LetterPdfService,
    private readonly letterheads: LetterheadService,
    private readonly templates: TemplatesService,
  ) {}

  private baseSample(): Omit<LetterRenderInput, 'letterhead' | 'bodyHtml' | 'subject'> {
    return {
      number: SAMPLE_CONTEXT.number,
      dateText: formatJalaliDate(new Date()),
      attachmentsText: SAMPLE_CONTEXT.attachments,
      recipients: [{ name: SAMPLE_CONTEXT.recipientName, title: SAMPLE_CONTEXT.recipientTitle }],
      ccNames: ['واحد مالی', 'دبیرخانه'],
      sender: { name: SAMPLE_CONTEXT.senderName, title: SAMPLE_CONTEXT.senderTitle },
      paraphs: [{ authorName: 'محمد کریمی', authorTitle: 'مدیر مالی', text: 'با نظر موافق؛ جهت اقدام به واحد بازرگانی ارجاع شود.', dateText: formatJalaliDate(new Date()) }],
      signature: { imageDataUri: null, stampDataUri: null, signerName: SAMPLE_CONTEXT.senderName, signerTitle: SAMPLE_CONTEXT.senderTitle, signedAtText: formatJalaliDate(new Date()) },
      qr: { verifyUrl: 'https://verify.example.invalid/letter/SAMPLE' },
      watermark: null,
      confidentialityLabel: 'محرمانه',
      priorityLabel: 'فوری',
    };
  }

  /** PDF نمونه برای طراح سربرگ (از DB یا از پیش‌نویس طراح در صورت ارسال layout/backgroundImage). */
  async sampleForLetterhead(ctx: TenantRequestContext, id: string, dto: SamplePdfDto): Promise<Buffer> {
    const saved = await this.letterheads.get(ctx, id, true);
    const size = dto.pageSize ?? (saved.pageSize as 'A4' | 'A5');
    const orient = dto.orientation ?? (saved.orientation as 'portrait' | 'landscape');
    const layout = dto.layout ? validateLayout(dto.layout, size, orient) : saved.layout;
    const image = dto.backgroundImage === undefined ? (saved.backgroundImage ?? null) : dto.backgroundImage ? validateBackgroundImage(dto.backgroundImage) : null;
    return this.pdf.render(
      { ...this.baseSample(), letterhead: { imageDataUri: image, layout }, subject: 'موضوع نمونه‌ی نامه', bodyHtml: sampleBody(dto.long === true) },
      { persianDigits: dto.persianDigits ?? true, tenantId: ctx.tenantId, userId: ctx.auth.sub },
    );
  }

  async previewDraft(ctx: TenantRequestContext, dto: PreviewPdfDto): Promise<Buffer> {
    let subject = dto.subject;
    let bodyHtml = dto.bodyHtml;
    let templateLetterhead: string | null = null;
    if (dto.templateId) {
      const t = await this.templates.get(ctx, dto.templateId);
      const applied = applyTemplate(t, {
        ...SAMPLE_CONTEXT,
        ...(dto.recipientName ? { recipientName: dto.recipientName } : {}),
        ...(dto.recipientTitle ? { recipientTitle: dto.recipientTitle } : {}),
        ...(dto.senderName ? { senderName: dto.senderName } : {}),
        ...(dto.senderTitle ? { senderTitle: dto.senderTitle } : {}),
        ...(dto.subject ? { subject: dto.subject } : {}),
        ...(dto.number ? { number: dto.number } : {}),
        ...(dto.dateText ? { date: dto.dateText } : {}),
      });
      subject ??= applied.subject;
      bodyHtml ??= applied.bodyHtml;
      templateLetterhead = t.defaultLetterheadId;
    }
    if (bodyHtml !== undefined && bodyHtml.length > 650_000) throw new BadRequestException('متن نامه بیش از حد بزرگ است');
    const lh = await this.letterheads.resolveForRender(ctx, { letterheadId: dto.letterheadId ?? templateLetterhead, departmentId: dto.departmentId });
    const s = this.baseSample();
    const sender = { name: dto.senderName ?? s.sender.name, title: dto.senderTitle ?? s.sender.title };
    const input: LetterRenderInput = {
      ...s,
      letterhead: { imageDataUri: lh.imageDataUri, layout: lh.layout },
      number: dto.number ?? s.number,
      dateText: dto.dateText ?? s.dateText,
      subject: subject ?? 'موضوع نمونه',
      bodyHtml: sanitizeLetterHtml(bodyHtml ?? sampleBody(false)),
      attachmentsText: dto.attachmentsText ?? s.attachmentsText,
      recipients: [{ name: dto.recipientName ?? s.recipients[0].name, title: dto.recipientTitle ?? s.recipients[0].title }],
      sender,
      signature: dto.withSignature
        ? {
            ...s.signature!, signerName: sender.name, signerTitle: sender.title,
            ...(dto.signatureTitleLine !== undefined ? { titleLine: dto.signatureTitleLine } : {}),
            ...(dto.signatureNameLine !== undefined ? { nameLine: dto.signatureNameLine } : {}),
            ...(dto.signatureShowDate === false ? { dateLabel: null } : {}),
          }
        : null,
      qr: dto.withQr === false ? null : s.qr,
      paraphs: [],
      watermark: dto.watermark === 'VOID' ? 'باطل‌شده' : dto.watermark === 'DRAFT' || dto.watermark === undefined ? 'پیش‌نویس' : null,
      confidentialityLabel: dto.confidentialityLabel ?? null,
      priorityLabel: dto.priorityLabel ?? null,
    };
    return this.pdf.render(input, { persianDigits: dto.persianDigits ?? false, tenantId: ctx.tenantId, userId: ctx.auth.sub });
  }
}
