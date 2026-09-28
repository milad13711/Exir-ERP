import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicCertificateService } from './public-certificate.service.js';

@Controller('public/certificates')
export class PublicCertificateController {
  constructor(private readonly service: PublicCertificateService) {}

  @Get(':slug/:code')
  async lookup(@Param('slug') slug: string, @Param('code') code: string) {
    return this.service.lookup(slug, code);
  }

  @Get(':slug/:code/image.png')
  async image(@Param('slug') slug: string, @Param('code') code: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    const png = await this.service.renderImage(slug, code, lang);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  @Get(':slug/:code/pdf')
  async pdf(@Param('slug') slug: string, @Param('code') code: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    const pdf = await this.service.renderPdf(slug, code, lang);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }
}
