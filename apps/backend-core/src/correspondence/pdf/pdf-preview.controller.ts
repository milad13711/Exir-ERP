import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../../common/guards/module.guard.js';
import { RequireModule } from '../../common/decorators/require-module.decorator.js';
import { Ctx } from '../../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { PermissionsService } from '../../permissions/permissions.service.js';
import { PreviewPdfDto, SamplePdfDto } from '../dto/letterhead.dto.js';
import { LetterPreviewService } from './letter-preview.service.js';

function sendPdf(res: Response, pdf: Buffer, name: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(pdf);
}

/** پیش‌نمایش‌های PDF (سنگین): محدودیت نرخ در rate-limit.ts (corr-pdf-token) + صف هم‌زمانی در LetterPdfService. */
@Controller('correspondence')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('correspondence')
export class PdfPreviewController {
  constructor(
    private readonly preview: LetterPreviewService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post('pdf/preview')
  async previewDraft(@Body() dto: PreviewPdfDto, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'correspondence');
    sendPdf(res, await this.preview.previewDraft(ctx, dto), 'preview');
  }

  @Post('letterheads/:id/sample-pdf')
  async sample(@Param('id') id: string, @Body() dto: SamplePdfDto, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    sendPdf(res, await this.preview.sampleForLetterhead(ctx, id, dto), 'letterhead-sample');
  }

  @Post('templates/:id/preview-pdf')
  async templatePdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'correspondence');
    sendPdf(res, await this.preview.previewDraft(ctx, { templateId: id }), 'template-preview');
  }
}
