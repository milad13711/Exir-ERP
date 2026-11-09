import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AGENT_API_BASE } from './agent-constants.js';
import { AgentApiService } from './agent-api.service.js';

/**
 * API ورودی محصولات (/api/agents-api/v1) — بیرون از JWT عادی؛ احراز با کلید Bearer exir_agent_… + امضای HMAC
 * (هدرهای X-Exir-Timestamp و X-Exir-Signature) داخل AgentApiService. کلید فقط به محصول خودش دسترسی دارد.
 */
@Controller(AGENT_API_BASE.replace(/^\//, ''))
export class AgentsPublicApiController {
  constructor(private readonly api: AgentApiService) {}

  @Get('health')
  async health(@Req() req: Request) {
    const a = await this.api.authenticate(req);
    return { status: 'ok', product: a.productCode, time: new Date().toISOString() };
  }

  @Get('referral-codes/:code/validate')
  async validate(@Param('code') code: string, @Req() req: Request) {
    const a = await this.api.authenticate(req);
    return this.api.validateReferralCode(a, code);
  }

  @Post('events')
  @HttpCode(202)
  async events(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const a = await this.api.authenticate(req);
    const out = await this.api.handleEvent(a, body);
    if (out.status === 'DUPLICATE') res.status(200);
    return { status: out.status, eventId: out.eventId, ...(out.detail ?? {}) };
  }
}
