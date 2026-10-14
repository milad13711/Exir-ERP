import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClientSignatureEvidenceDto } from '../common/signature-evidence/index.js';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PublicFleetOfferService } from './public-fleet-offer.service.js';

export class AcceptOfferDto {
  /** شواهد اختیاری سمت کلاینت برای مدرک حقوقی پذیرش (غیرقابل‌اعتماد؛ IP/زمان را سرور تعیین می‌کند). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}

/** Unauthenticated by design — see PublicFleetOfferService for the no-OTP rationale. */
@Controller('public/fleet/offer/:slug/:token')
export class PublicFleetOfferController {
  constructor(private readonly offers: PublicFleetOfferService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.offers.view(slug, token);
  }

  @Post('accept')
  accept(@Param('slug') slug: string, @Param('token') token: string, @Req() req: Request, @Body() dto: AcceptOfferDto) {
    return this.offers.accept(slug, token, req, dto?.evidence);
  }
}
