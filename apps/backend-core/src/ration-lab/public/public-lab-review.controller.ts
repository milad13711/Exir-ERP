import { Body, Controller, Param, Post } from '@nestjs/common';
import { PublicLabReviewService } from './public-lab-review.service.js';
import { RequestLabOtpDto, VerifyLabOtpDto, SearchSampleDto, SubmitLabReportDto } from '../dto/public-lab-review.dto.js';

/** Unauthenticated by design — see PublicLabReviewService for the OTP-gating rationale. */
@Controller('public/ration-lab/:slug')
export class PublicLabReviewController {
  constructor(private readonly labReview: PublicLabReviewService) {}

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestLabOtpDto) {
    return this.labReview.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyLabOtpDto) {
    return this.labReview.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post('samples/search')
  searchSample(@Param('slug') slug: string, @Body() dto: SearchSampleDto) {
    return this.labReview.searchSample(slug, dto.labToken, dto.sampleCode);
  }

  @Post('samples/:id/report')
  submitReport(@Param('slug') slug: string, @Param('id') id: string, @Body() dto: SubmitLabReportDto) {
    return this.labReview.submitReport(slug, id, dto);
  }
}
