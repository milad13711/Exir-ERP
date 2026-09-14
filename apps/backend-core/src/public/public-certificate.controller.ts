import { Controller, Get, Param, Res } from '@nestjs/common';
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
  async image(@Param('slug') slug: string, @Param('code') code: string, @Res() res: Response) {
    const png = await this.service.renderImage(slug, code);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }
}
