import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';

@Controller('projects')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'projects');
    return this.projects.list(ctx, { status, contactId });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'projects');
    return this.projects.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateProjectDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'projects');
    return this.projects.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    return this.projects.update(ctx, id, dto);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    return this.projects.start(ctx, id);
  }

  @Post(':id/hold')
  async hold(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    return this.projects.hold(ctx, id);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'projects');
    return this.projects.complete(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'projects');
    return this.projects.cancel(ctx, id);
  }
}
