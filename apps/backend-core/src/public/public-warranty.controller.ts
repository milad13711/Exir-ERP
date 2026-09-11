import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicWarrantyService } from './public-warranty.service.js';
import { ActivateWarrantyDto } from './dto/activate-warranty.dto.js';
import { RequestWarrantyServiceDto } from './dto/request-warranty-service.dto.js';
import { WarrantyServiceFeedbackDto } from './dto/warranty-service-feedback.dto.js';

/** Unauthenticated by design — see PublicWarrantyService for the no-OTP rationale. */
@Controller('public/warranty/:slug')
export class PublicWarrantyController {
  constructor(private readonly warranty: PublicWarrantyService) {}

  @Get('lookup')
  lookup(@Param('slug') slug: string, @Query('code') code: string) {
    return this.warranty.lookup(slug, code ?? '');
  }

  @Get('terms')
  terms(@Param('slug') slug: string) {
    return this.warranty.getTerms(slug, 'warranty');
  }

  @Get('service-terms')
  serviceTerms(@Param('slug') slug: string) {
    return this.warranty.getTerms(slug, 'service');
  }

  @Post('activate')
  activate(@Param('slug') slug: string, @Body() dto: ActivateWarrantyDto) {
    return this.warranty.activate(slug, dto);
  }

  @Post('request-service')
  requestService(@Param('slug') slug: string, @Body() dto: RequestWarrantyServiceDto) {
    return this.warranty.requestService(slug, dto);
  }

  @Post('service-feedback/:serviceId')
  submitFeedback(@Param('slug') slug: string, @Param('serviceId') serviceId: string, @Body() dto: WarrantyServiceFeedbackDto) {
    return this.warranty.submitFeedback(slug, serviceId, dto);
  }
}
