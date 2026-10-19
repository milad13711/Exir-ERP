import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { StockImportService } from './stock-import.service.js';
import { StockImportCommitDto, StockImportPreviewDto, StockImportVoidDto } from './dto/stock-import.dto.js';

/**
 * ورود موجودی اولیه از اکسل. ثبت نهایی هم «ایجاد» و هم «ویرایش» انبار را می‌خواهد (چون روی موجودی و بهای کالاهای
 * موجود اثر می‌گذارد و سند حسابداری می‌زند)؛ ابطال دسته نیازمند «حذف» است.
 */
@Controller('warehouse/stock-import')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('warehouse')
export class StockImportController {
  constructor(
    private readonly imports: StockImportService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('template')
  async template(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'warehouse');
    const buffer = await this.imports.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="opening-stock-template.xlsx"');
    res.send(buffer);
  }

  @Post('preview')
  async preview(@Body() dto: StockImportPreviewDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    await this.permissions.assertEdit(ctx, 'warehouse');
    return this.imports.preview(ctx, dto.fileBase64, dto.createMissingProducts ?? false);
  }

  @Post('commit')
  async commit(@Body() dto: StockImportCommitDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'warehouse');
    await this.permissions.assertEdit(ctx, 'warehouse');
    return this.imports.commit(ctx, {
      fileBase64: dto.fileBase64,
      fileName: dto.fileName,
      fileHash: dto.fileHash,
      createMissing: dto.createMissingProducts ?? false,
      confirm: dto.confirm,
    });
  }

  @Get('batches')
  async batches(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'warehouse');
    return this.imports.list(ctx);
  }

  @Post('batches/:id/void')
  async voidBatch(@Param('id') id: string, @Body() dto: StockImportVoidDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'warehouse');
    return this.imports.voidBatch(ctx, id, dto.reason.trim());
  }
}
