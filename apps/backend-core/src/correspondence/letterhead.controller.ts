import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateLetterheadDto, UpdateLetterheadDto } from './dto/letterhead.dto.js';
import { BOX_KEYS, allowedFontFamilies, defaultLayout } from './letterhead-layout.js';
import { LetterheadService } from './letterhead.service.js';

/** مدیریت سربرگ‌ها — خواندن: مشاهده‌ی ماژول؛ نوشتن: دسترسی ویرایش (مدیریتی). */
@Controller('correspondence/letterheads')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('correspondence')
export class LetterheadController {
  constructor(
    private readonly letterheads: LetterheadService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return this.letterheads.list(ctx);
  }

  /** فونت‌های مجاز + چیدمان پیش‌فرض (برای طراح). */
  @Get('meta')
  async meta(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return { fonts: allowedFontFamilies(), boxKeys: BOX_KEYS, defaults: { A4: { portrait: defaultLayout('A4', 'portrait'), landscape: defaultLayout('A4', 'landscape') }, A5: { portrait: defaultLayout('A5', 'portrait'), landscape: defaultLayout('A5', 'landscape') } } };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'correspondence');
    return this.letterheads.get(ctx, id, true);
  }

  @Post()
  async create(@Body() dto: CreateLetterheadDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.letterheads.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateLetterheadDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.letterheads.update(ctx, id, dto);
  }

  @Post(':id/set-default')
  async setDefault(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.letterheads.setDefault(ctx, id);
  }

  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.letterheads.duplicate(ctx, id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'correspondence');
    return this.letterheads.remove(ctx, id);
  }
}
