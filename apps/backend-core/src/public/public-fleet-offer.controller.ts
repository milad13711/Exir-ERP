import { Controller, Get, Param, Post } from '@nestjs/common';
import { PublicFleetOfferService } from './public-fleet-offer.service.js';

/** Unauthenticated by design — see PublicFleetOfferService for the no-OTP rationale. */
@Controller('public/fleet/offer/:slug/:token')
export class PublicFleetOfferController {
  constructor(private readonly offers: PublicFleetOfferService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.offers.view(slug, token);
  }

  @Post('accept')
  accept(@Param('slug') slug: string, @Param('token') token: string) {
    return this.offers.accept(slug, token);
  }
}
