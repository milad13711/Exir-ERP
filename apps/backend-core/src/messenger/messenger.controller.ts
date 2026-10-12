import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { MessengerService } from './messenger.service.js';
import { MessengerMediaService } from './messenger-media.service.js';
import { MEDIA_MAX_BYTES } from './messenger-media.util.js';
import {
  AddMembersDto,
  ArchiveChatDto,
  CreateDirectDto,
  CreateGroupDto,
  EditMessageDto,
  ForwardDto,
  MuteDto,
  PinChatDto,
  PresenceDto,
  ReactDto,
  ReadDto,
  RenameGroupDto,
  SendMessageDto,
  SetRoleDto,
  UpdateSettingsDto,
} from './dto/messenger.dto.js';

/** بدنه‌ی خام را با سقف سخت می‌خواند (پارسر JSON/urlencoded روی Content-Type فایل‌ها دخالت نمی‌کند). */
function readRawBody(req: Request, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) return reject(new PayloadTooLargeException('حجم فایل بیش از حد مجاز است'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new PayloadTooLargeException('حجم فایل بیش از حد مجاز است'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (e) => reject(e));
  });
}

@Controller('messenger')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('messenger')
export class MessengerController {
  constructor(
    private readonly messenger: MessengerService,
    private readonly media: MessengerMediaService,
  ) {}

  // ── تنظیمات / حضور ──
  @Get('settings')
  async settings(@Ctx() ctx: TenantRequestContext) {
    return this.messenger.getSettings(ctx.tenantDb);
  }

  @Put('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.updateSettings(await this.messenger.actorOf(ctx), dto);
  }

  @Get('presence')
  async myPresence(@Ctx() ctx: TenantRequestContext) {
    return this.messenger.myPresence(await this.messenger.actorOf(ctx));
  }

  @Put('presence')
  async setPresence(@Body() dto: PresenceDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.setHidden(await this.messenger.actorOf(ctx), dto.hidden);
  }

  @Get('me')
  async me(@Ctx() ctx: TenantRequestContext) {
    const actor = await this.messenger.actorOf(ctx);
    return { userId: actor.userId, isManager: actor.isManager };
  }

  @Get('contacts')
  async contacts(@Ctx() ctx: TenantRequestContext) {
    return this.messenger.contacts(await this.messenger.actorOf(ctx));
  }

  @Get('unread')
  async unread(@Ctx() ctx: TenantRequestContext) {
    return this.messenger.unreadTotal(await this.messenger.actorOf(ctx));
  }

  @Get('search')
  async search(@Query('q') q: string, @Query('conversationId') conversationId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.search(await this.messenger.actorOf(ctx), q ?? '', conversationId);
  }

  // ── گفتگوها ──
  @Get('conversations')
  async list(@Ctx() ctx: TenantRequestContext) {
    return this.messenger.listConversations(await this.messenger.actorOf(ctx));
  }

  @Post('conversations/direct')
  async direct(@Body() dto: CreateDirectDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.openDirect(await this.messenger.actorOf(ctx), dto.userId);
  }

  @Post('conversations/group')
  async group(@Body() dto: CreateGroupDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.createGroup(await this.messenger.actorOf(ctx), dto.title, dto.memberIds);
  }

  @Post('conversations/saved')
  async saved(@Ctx() ctx: TenantRequestContext) {
    const actor = await this.messenger.actorOf(ctx);
    const conv = await this.messenger.ensureSaved(actor);
    return this.messenger.getConversation(actor, conv.id);
  }

  @Get('conversations/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.getConversation(await this.messenger.actorOf(ctx), id);
  }

  @Patch('conversations/:id')
  async rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameGroupDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.renameGroup(await this.messenger.actorOf(ctx), id, dto.title);
  }

  @Patch('conversations/:id/mute')
  async mute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MuteDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.setMuted(await this.messenger.actorOf(ctx), id, dto.muted);
  }

  @Patch('conversations/:id/pin')
  async pinChat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PinChatDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.setChatPinned(await this.messenger.actorOf(ctx), id, dto.pinned);
  }

  @Patch('conversations/:id/archive')
  async archiveChat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ArchiveChatDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.setChatArchived(await this.messenger.actorOf(ctx), id, dto.archived);
  }

  @Post('conversations/:id/members')
  async addMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMembersDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.addMembers(await this.messenger.actorOf(ctx), id, dto.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  async removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.removeMember(await this.messenger.actorOf(ctx), id, userId);
  }

  @Patch('conversations/:id/members/:userId/role')
  async setRole(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetRoleDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.setRole(await this.messenger.actorOf(ctx), id, userId, dto.role);
  }

  @Post('conversations/:id/leave')
  async leave(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.leave(await this.messenger.actorOf(ctx), id);
  }

  @Post('conversations/:id/read')
  async read(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReadDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.markRead(await this.messenger.actorOf(ctx), id, dto.seq);
  }

  @Post('conversations/:id/pins/:messageId')
  async pin(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.pin(await this.messenger.actorOf(ctx), id, messageId, true);
  }

  @Delete('conversations/:id/pins/:messageId')
  async unpin(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.pin(await this.messenger.actorOf(ctx), id, messageId, false);
  }

  // ── پیام‌ها ──
  @Get('conversations/:id/messages')
  async messages(@Param('id', ParseUUIDPipe) id: string, @Query('before') before: string | undefined, @Query('after') after: string | undefined, @Query('limit') limit: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const b = before !== undefined ? Number(before) : undefined;
    if (b !== undefined && (!Number.isInteger(b) || b < 1)) throw new BadRequestException('مکان‌نما نامعتبر است');
    const a = after !== undefined ? Number(after) : undefined;
    if (a !== undefined && (!Number.isInteger(a) || a < 0)) throw new BadRequestException('مکان‌نما نامعتبر است');
    return this.messenger.listMessages(await this.messenger.actorOf(ctx), id, { before: b, after: a, limit: limit ? Number(limit) || undefined : undefined });
  }

  @Post('conversations/:id/messages')
  async send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.sendMessage(await this.messenger.actorOf(ctx), id, dto);
  }

  @Patch('messages/:id')
  async edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditMessageDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.editMessage(await this.messenger.actorOf(ctx), id, dto.text);
  }

  @Delete('messages/:id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query('scope') scope: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.deleteMessage(await this.messenger.actorOf(ctx), id, scope === 'all' ? 'all' : 'me');
  }

  @Post('messages/:id/reactions')
  async react(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.react(await this.messenger.actorOf(ctx), id, dto.emoji);
  }

  @Post('messages/:id/forward')
  async forward(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ForwardDto, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.forward(await this.messenger.actorOf(ctx), id, dto.conversationIds);
  }

  @Post('messages/:id/save')
  async save(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: TenantRequestContext) {
    return this.messenger.save(await this.messenger.actorOf(ctx), id);
  }

  // ── رسانه (۲۴ ساعته) ──
  /** بدنه‌ی خام فایل؛ Content-Type = نوع فایل، X-File-Name = نام (URL-encoded). */
  @Post('conversations/:id/media')
  async upload(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Ctx() ctx: TenantRequestContext) {
    const actor = await this.messenger.actorOf(ctx);
    const body = await readRawBody(req, MEDIA_MAX_BYTES);
    const name = req.headers['x-file-name'];
    return this.media.upload(actor, id, body, req.headers['content-type'], Array.isArray(name) ? name[0] : name);
  }

  @Get('media/:id/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  async download(@Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const f = await this.media.download(await this.messenger.actorOf(ctx), id);
    const asInline = inline === '1' && (f.kind === 'IMAGE' || f.kind === 'VIDEO');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(f.data.length));
    res.setHeader('Content-Disposition', `${asInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.end(f.data);
  }
}
