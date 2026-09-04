import { Body, Controller, Param, Post } from '@nestjs/common';
import { PublicContractsService } from './public-contracts.service.js';
import { RequestContractSignOtpDto } from './dto/request-contract-sign-otp.dto.js';
import { VerifyContractSignOtpDto } from './dto/verify-contract-sign-otp.dto.js';
import { ContractSignTicketDto } from './dto/contract-sign-ticket.dto.js';
import { SubmitContractEditRequestDto } from './dto/submit-contract-edit-request.dto.js';
import { PublicSignContractDto } from './dto/public-sign-contract.dto.js';

/** Unauthenticated by design — see PublicContractsService for the dual-party OTP-gating rationale. */
@Controller('public/contracts/:slug/:publicToken')
export class PublicContractsController {
  constructor(private readonly publicContracts: PublicContractsService) {}

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Param('publicToken') publicToken: string, @Body() dto: RequestContractSignOtpDto) {
    return this.publicContracts.requestOtp(slug, publicToken, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Param('publicToken') publicToken: string, @Body() dto: VerifyContractSignOtpDto) {
    return this.publicContracts.verifyOtp(slug, publicToken, dto.phone, dto.code);
  }

  @Post('view')
  view(@Param('slug') slug: string, @Param('publicToken') publicToken: string, @Body() dto: ContractSignTicketDto) {
    return this.publicContracts.view(slug, publicToken, dto.ticket);
  }

  @Post('edit-request')
  submitEditRequest(@Param('slug') slug: string, @Param('publicToken') publicToken: string, @Body() dto: SubmitContractEditRequestDto) {
    return this.publicContracts.submitEditRequest(slug, publicToken, dto.ticket, dto.text);
  }

  @Post('sign')
  sign(@Param('slug') slug: string, @Param('publicToken') publicToken: string, @Body() dto: PublicSignContractDto) {
    return this.publicContracts.sign(slug, publicToken, dto.ticket, dto.signatureDataUrl, dto.signerName, dto.amendmentId);
  }
}
