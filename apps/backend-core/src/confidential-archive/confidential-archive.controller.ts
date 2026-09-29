import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { VaultTicketGuard } from './guards/vault-ticket.guard.js';
import { RequireVaultEdit } from './decorators/require-vault-edit.decorator.js';
import { ConfidentialArchiveService } from './confidential-archive.service.js';
import { CreateConfidentialDocumentDto } from './dto/create-confidential-document.dto.js';
import { UpdateConfidentialDocumentDto } from './dto/update-confidential-document.dto.js';
import { VerifyVaultOtpDto } from './dto/verify-vault-otp.dto.js';
import { SetArchiveAccessDto } from './dto/set-archive-access.dto.js';

@Controller('confidential-archive')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('confidential-archive')
export class ConfidentialArchiveController {
  constructor(private readonly archive: ConfidentialArchiveService) {}

  // ── ثبت سند — بدون OTP، در دسترس هر کاربری با ماژول نصب‌شده ──────────────
  @Post('documents')
  create(@Body() dto: CreateConfidentialDocumentDto, @Ctx() ctx: TenantRequestContext) {
    return this.archive.createDocument(ctx, dto);
  }

  // ── گام پله‌ای OTP روی شماره‌ی خودِ کاربر لاگین‌شده ────────────────────────
  @Post('otp/request')
  requestOtp(@Ctx() ctx: TenantRequestContext) {
    return this.archive.requestVaultOtp(ctx);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyVaultOtpDto, @Ctx() ctx: TenantRequestContext) {
    return this.archive.verifyVaultOtp(ctx, dto.code);
  }

  /** هر کاربر با ماژول نصب‌شده می‌تواند بپرسد آیا دکمه‌ی «ورود به آرشیو» برایش معنا دارد — بدون OTP. */
  @Get('my-access')
  myAccess(@Ctx() ctx: TenantRequestContext) {
    return this.archive.myAccess(ctx);
  }

  // ── اسناد آرشیو — همه پشت VaultTicketGuard (نیازمند X-Vault-Ticket معتبر) ──
  @Get('documents')
  @UseGuards(VaultTicketGuard)
  list(@Ctx() ctx: TenantRequestContext) {
    return this.archive.listDocuments(ctx);
  }

  @Get('documents/:id')
  @UseGuards(VaultTicketGuard)
  detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.archive.getDocument(ctx, id);
  }

  @Patch('documents/:id')
  @UseGuards(VaultTicketGuard)
  @RequireVaultEdit()
  update(@Param('id') id: string, @Body() dto: UpdateConfidentialDocumentDto, @Ctx() ctx: TenantRequestContext) {
    return this.archive.updateDocument(ctx, id, dto);
  }

  @Delete('documents/:id')
  @UseGuards(VaultTicketGuard)
  @RequireVaultEdit()
  remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.archive.deleteDocument(ctx, id);
  }

  // ── مدیریت دسترسی — فقط مالک/مدیر، بدون نیاز به OTP ──────────────────────
  @Get('access')
  listAccess(@Ctx() ctx: TenantRequestContext) {
    return this.archive.listAccess(ctx);
  }

  @Put('access')
  setAccess(@Body() dto: SetArchiveAccessDto, @Ctx() ctx: TenantRequestContext) {
    return this.archive.setAccess(ctx, dto.userId, dto.canEdit);
  }

  @Delete('access/:userId')
  revokeAccess(@Param('userId') userId: string, @Ctx() ctx: TenantRequestContext) {
    return this.archive.revokeAccess(ctx, userId);
  }
}
