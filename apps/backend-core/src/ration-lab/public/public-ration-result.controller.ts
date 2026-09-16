import { Body, Controller, Param, Post } from '@nestjs/common';
import { PublicRationResultService } from './public-ration-result.service.js';
import { RequestResultOtpDto, VerifyResultOtpDto, ListResultSamplesDto, GetResultSampleDto } from '../dto/public-ration-result.dto.js';

/** Unauthenticated by design — see PublicRationResultService for the OTP-gating rationale. */
@Controller('public/ration-result/:slug')
export class PublicRationResultController {
  constructor(private readonly result: PublicRationResultService) {}

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestResultOtpDto) {
    return this.result.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyResultOtpDto) {
    return this.result.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post('samples')
  listSamples(@Param('slug') slug: string, @Body() dto: ListResultSamplesDto) {
    return this.result.listSamples(slug, dto.resultToken);
  }

  @Post('samples/:id')
  getSample(@Param('slug') slug: string, @Param('id') id: string, @Body() dto: GetResultSampleDto) {
    return this.result.getSample(slug, id, dto.resultToken);
  }
}
