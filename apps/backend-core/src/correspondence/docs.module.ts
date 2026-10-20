import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { LetterheadController } from './letterhead.controller.js';
import { LetterheadService } from './letterhead.service.js';
import { LetterPdfService } from './pdf/letter-pdf.service.js';
import { LetterPreviewService } from './pdf/letter-preview.service.js';
import { PdfPreviewController } from './pdf/pdf-preview.controller.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

/** سربرگ + قالب‌ها + تولید PDF نامه. ماژول هسته‌ی مکاتبات (A1) این را import می‌کند. */
@Module({
  imports: [PermissionsModule, ModuleGuardModule],
  controllers: [LetterheadController, TemplatesController, PdfPreviewController],
  providers: [LetterheadService, TemplatesService, LetterPdfService, LetterPreviewService],
  exports: [LetterheadService, TemplatesService, LetterPdfService],
})
export class CorrespondenceDocsModule {}
