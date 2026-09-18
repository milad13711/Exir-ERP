import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicReferralSurveyService } from './public-referral-survey.service.js';
import { SubmitReferralSurveyDto } from '../referral-marketing/dto/submit-referral-survey.dto.js';

/** Unauthenticated by design — see PublicReferralSurveyService for the no-OTP rationale. */
@Controller('public/referral-survey/:slug/:token')
export class PublicReferralSurveyController {
  constructor(private readonly surveys: PublicReferralSurveyService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.surveys.view(slug, token);
  }

  @Post('submit')
  submit(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: SubmitReferralSurveyDto) {
    return this.surveys.submit(slug, token, dto);
  }
}
