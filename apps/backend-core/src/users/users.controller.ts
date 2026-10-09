import { ForbiddenException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { UsersService } from './users.service.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { UpdateModulePermissionsDto } from './dto/update-module-permissions.dto.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { SetManagementRoleDto } from './dto/set-management-role.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { assertTwoFactorForSensitiveAction } from '../auth/tenant-two-factor-policy.js';

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
    // ماتریس دسترسیِ نقش‌ها اطلاعات مدیریتی است؛ کاربر عادی ماتریس مؤثر خودش را از مسیر /workspace می‌گیرد.
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر');
    return this.users.listRoles(ctx);
  }

  @Post('users/invite')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  invite(@Body() dto: InviteUserDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.inviteUser(ctx, dto.name, dto.phone, dto.roleId);
  }

  @Put('users/:id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.updateUser(ctx, id, dto);
  }

  @Get('users/:id/permissions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  getPermissions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.users.getUserPermissionOverrides(ctx, id);
  }

  @Put('users/:id/permissions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  setPermissions(@Param('id') id: string, @Body() dto: UpdateModulePermissionsDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.setUserPermissionOverrides(ctx, id, dto.entries);
  }

  @Put('users/:id/management-role')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  setManagementRole(@Param('id') id: string, @Body() dto: SetManagementRoleDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.setManagementRole(ctx, id, dto.role, dto.transfer ?? false);
  }

  @Delete('users/:id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.deleteUser(ctx, id);
  }

  @Put('roles/:id/permissions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateModulePermissionsDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.updateModulePermissions(ctx, id, dto.entries);
  }

  @Post('roles')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  createRole(@Body() dto: CreateRoleDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.createRole(ctx, dto.name);
  }

  @Delete('roles/:id')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  deleteRole(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    return this.users.deleteRole(ctx, id);
  }
}
