import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { SupportService } from './support.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { AddMessageDto } from './dto/add-message.dto.js';

@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext) {
    return this.support.listMyTickets(ctx.tenantId, ctx.auth.sub);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @Ctx() ctx: TenantRequestContext) {
    return this.support.createTicket(ctx.tenantId, ctx.auth.sub, dto.subject, dto.message);
  }

  @Get(':id/messages')
  messages(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.support.getMessages(ctx.tenantId, id);
  }

  @Post(':id/messages')
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.support.addTenantMessage(ctx.tenantId, id, ctx.auth.sub, dto.body);
  }
}
