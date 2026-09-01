import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { AdminSupportService } from './admin-support.service.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { AddMessageDto } from '../support/dto/add-message.dto.js';
import { ResolveTicketDto } from './dto/resolve-ticket.dto.js';
import type { TicketStatus } from '../../generated/control-client/index.js';

@Controller('admin/support/tickets')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
@AdminTeams('SUPER_ADMIN', 'SUPPORT')
export class AdminSupportController {
  constructor(private readonly adminSupport: AdminSupportService) {}

  @Get()
  list(@Query('status') status?: TicketStatus) {
    return this.adminSupport.listTickets(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.adminSupport.getTicket(id);
  }

  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @AdminCtx() ctx: AdminRequestContext,
  ) {
    return this.adminSupport.assign(id, dto.adminUserId, ctx.auth.sub);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: AddMessageDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.adminSupport.reply(id, ctx.auth.sub, dto.body);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
    @AdminCtx() ctx: AdminRequestContext,
  ) {
    return this.adminSupport.resolve(id, dto.resolutionNote, ctx.auth.sub);
  }
}
