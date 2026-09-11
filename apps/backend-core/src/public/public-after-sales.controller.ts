import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicAfterSalesService } from './public-after-sales.service.js';
import { RequestWarrantyServiceDto } from './dto/request-warranty-service.dto.js';
import { WarrantyServiceFeedbackDto } from './dto/warranty-service-feedback.dto.js';

/** Unauthenticated by design — see PublicAfterSalesService for the no-OTP rationale. */
@Controller('public/after-sales-service/:slug')
export class PublicAfterSalesController {
  constructor(private readonly afterSales: PublicAfterSalesService) {}

  @Get('terms')
  terms(@Param('slug') slug: string) {
    return this.afterSales.getTerms(slug);
  }

  @Get('status')
  status(@Param('slug') slug: string, @Query('code') code: string) {
    return this.afterSales.status(slug, code ?? '');
  }

  @Post('request-service')
  requestService(@Param('slug') slug: string, @Body() dto: RequestWarrantyServiceDto) {
    return this.afterSales.requestService(slug, dto);
  }

  @Post('service-feedback/:serviceId')
  submitFeedback(@Param('slug') slug: string, @Param('serviceId') serviceId: string, @Body() dto: WarrantyServiceFeedbackDto) {
    return this.afterSales.submitFeedback(slug, serviceId, dto);
  }
}
