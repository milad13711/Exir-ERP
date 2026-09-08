import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicMentoringSurveyService } from './public-mentoring-survey.service.js';
import { SubmitMentoringSurveyDto } from '../mentoring/dto/submit-mentoring-survey.dto.js';

/** Unauthenticated by design — see PublicMentoringSurveyService for the no-OTP rationale. */
@Controller('public/mentoring-survey/:slug/:token')
export class PublicMentoringSurveyController {
  constructor(private readonly surveys: PublicMentoringSurveyService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.surveys.view(slug, token);
  }

  @Post('submit')
  submit(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: SubmitMentoringSurveyDto) {
    return this.surveys.submit(slug, token, dto);
  }
}
