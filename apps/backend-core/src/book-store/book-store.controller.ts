import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { BookStoreService } from './book-store.service.js';

@Controller('book-store/orders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('book-store')
export class BookStoreController {
  constructor(
    private readonly bookStore: BookStoreService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'book-store');
    return this.bookStore.list(ctx);
  }

  @Post(':id/ship')
  async ship(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'book-store');
    return this.bookStore.markShipped(ctx, id);
  }
}
