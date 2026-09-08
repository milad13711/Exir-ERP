import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { OnboardingService } from './onboarding.service.js';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  status(@Ctx() ctx: TenantRequestContext) {
    return this.onboarding.getStatus(ctx);
  }

  @Post('dismiss')
  async dismiss(@Ctx() ctx: TenantRequestContext) {
    await this.onboarding.dismiss(ctx);
    return { success: true };
  }
}
