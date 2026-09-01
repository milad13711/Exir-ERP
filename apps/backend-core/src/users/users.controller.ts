import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { UsersService } from './users.service.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { UpdateModulePermissionsDto } from './dto/update-module-permissions.dto.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  list(@Ctx() ctx: TenantRequestContext) {
    return this.users.listUsers(ctx);
  }

  @Get('roles')
  roles(@Ctx() ctx: TenantRequestContext) {
    return this.users.listRoles(ctx);
  }

  @Post('users/invite')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  invite(@Body() dto: InviteUserDto, @Ctx() ctx: TenantRequestContext) {
    return this.users.inviteUser(ctx, dto.name, dto.phone, dto.roleId);
  }

  @Put('roles/:id/permissions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateModulePermissionsDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.users.updateModulePermissions(ctx, id, dto.entries);
  }
}
