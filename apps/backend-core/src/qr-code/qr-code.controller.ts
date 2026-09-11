import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { QrCodeService } from './qr-code.service.js';
import { CreateQrCodeDto } from './dto/create-qr-code.dto.js';
import { UpdateQrCodeDto } from './dto/update-qr-code.dto.js';

@Controller('qr-codes')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('qr-code')
export class QrCodeController {
  constructor(
    private readonly qrCodes: QrCodeService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'qr-code');
    return this.qrCodes.list(ctx);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'qr-code');
    return this.qrCodes.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateQrCodeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'qr-code');
    return this.qrCodes.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateQrCodeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'qr-code');
    return this.qrCodes.update(ctx, id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'qr-code');
    return this.qrCodes.remove(ctx, id);
  }

  @Get(':id/image.png')
  async image(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'qr-code');
    const png = await this.qrCodes.imagePngBuffer(ctx, id);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }
}
