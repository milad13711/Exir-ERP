import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicSurveyService } from './public-survey.service.js';
import { SubmitSurveyDto } from './dto/submit-survey.dto.js';

/** Unauthenticated by design — see PublicSurveyService for the no-OTP rationale. */
@Controller('public/survey/:slug/:token')
export class PublicSurveyController {
  constructor(private readonly surveys: PublicSurveyService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.surveys.view(slug, token);
  }

  @Post('submit')
  submit(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: SubmitSurveyDto) {
    return this.surveys.submit(slug, token, dto);
  }
}
