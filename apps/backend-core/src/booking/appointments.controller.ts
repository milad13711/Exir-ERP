import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AppointmentsService } from './appointments.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto.js';

@Controller('booking/appointments')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('booking')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('status') status: string | undefined,
    @Query('providerUserId') providerUserId: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'booking');
    return this.appointments.list(ctx, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      status,
      providerUserId,
      contactId,
    });
  }

  @Post()
  async create(@Body() dto: CreateAppointmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'booking');
    return this.appointments.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAppointmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.appointments.update(ctx, id, dto);
  }

  @Post(':id/confirm')
  async confirm(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.appointments.confirm(ctx, id);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.appointments.complete(ctx, id);
  }

  @Post(':id/no-show')
  async noShow(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'booking');
    return this.appointments.noShow(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'booking');
    return this.appointments.cancel(ctx, id, dto.reason);
  }
}
