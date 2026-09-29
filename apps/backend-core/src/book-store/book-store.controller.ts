import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { BookStoreService } from './book-store.service.js';
import type { BookStoreSettings } from './book-store-settings.service.js';

@Controller('book-store')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('book-store')
export class BookStoreController {
  constructor(
    private readonly bookStore: BookStoreService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('orders')
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'book-store');
    return this.bookStore.list(ctx);
  }

  @Post('orders/:id/ship')
  async ship(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'book-store');
    return this.bookStore.markShipped(ctx, id);
  }

  @Get('settings')
  async getSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'book-store');
    return this.bookStore.getSettings(ctx);
  }

  @Put('settings')
  async updateSettings(@Body() dto: Partial<BookStoreSettings>, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'book-store');
    return this.bookStore.updateSettings(ctx, dto);
  }
}
