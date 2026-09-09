import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicFormsService } from './public-forms.service.js';
import { SubmitPublicFormDto } from './dto/submit-public-form.dto.js';

@Controller('public/forms/:slug')
export class PublicFormsController {
  constructor(private readonly forms: PublicFormsService) {}

  @Get(':formSlug')
  getForm(@Param('slug') slug: string, @Param('formSlug') formSlug: string) {
    return this.forms.getForm(slug, formSlug);
  }

  /** تصویر کاور به‌صورت data URI ذخیره می‌شود؛ اینجا با Content-Type درست پخش می‌شود تا og:image واقعی داشته باشیم. */
  @Get(':formSlug/image')
  async coverImage(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Res() res: Response) {
    const dataUri = await this.forms.getCoverImage(slug, formSlug);
    if (!dataUri) throw new NotFoundException('تصویر یافت نشد');
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if (!match) throw new NotFoundException('تصویر یافت نشد');
    const [, mimeType, base64] = match;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(base64, 'base64'));
  }

  @Post(':formSlug/submit')
  submit(@Param('slug') slug: string, @Param('formSlug') formSlug: string, @Body() dto: SubmitPublicFormDto) {
    return this.forms.submit(slug, formSlug, dto);
  }
}
