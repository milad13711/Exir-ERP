import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PublicRecruitmentService } from './public-recruitment.service.js';
import { AcceptOfferDto } from './dto/accept-offer.dto.js';

/** Unauthenticated by design — see PublicRecruitmentService for the token-based rationale. */
@Controller('public/recruitment/:slug/offer/:token')
export class PublicRecruitmentController {
  constructor(private readonly recruitment: PublicRecruitmentService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.recruitment.viewOffer(slug, token);
  }

  @Post('respond')
  respond(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: AcceptOfferDto, @Req() req: Request) {
    return this.recruitment.respondToOffer(slug, token, dto, req);
  }
}
