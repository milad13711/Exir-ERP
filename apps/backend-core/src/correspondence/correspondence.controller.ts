import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CorrespondenceCoreService, type CorrActor } from './correspondence-core.service.js';
import { CorrespondenceLettersService } from './correspondence-letters.service.js';
import { CorrespondenceReferralsService } from './correspondence-referrals.service.js';
import { CorrespondenceSettingsService } from './correspondence-settings.service.js';
import { CorrespondenceWorkflowService } from './correspondence-workflow.service.js';
import {
  ArchiveDto, BulkArchiveDto, CategoryDto, CreateLetterDto, ExternalFollowupDto, FolderDto, ForwardReferralDto, MarkDeliveredDto, MarkSentDto,
  NoteDto, NumberingSchemeDto, OptionalNoteDto, ParaphDto, ReasonDto, ReferralInputDto, ReferralResponseDto, ReferralReturnDto, RegisterIncomingDto,
  ReplyDto, ReviewDecisionDto, SignDto, SubmitDto, UpdateCategoryDto, UpdateLetterDto, UpdateNumberingSchemeDto,
} from './dto/correspondence.dto.js';
import type { LetterFilters } from './letter-search.js';

type Q = Record<string, string | undefined>;

/** پارامترهای query باید رشته‌ی ساده باشند؛ آرایه/آبجکت (?a[]=1 ، ?a[b]=1) → ۴۰۰ نه ۵۰۰. */
function simpleQuery(q: Record<string, unknown>): Q {
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && typeof v !== 'string') throw new BadRequestException(`پارامتر «${k}» نامعتبر است`);
  }
  return q as Q;
}
const bool = (v: string | undefined) => v === '1' || v === 'true';
const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30) : undefined);

function filtersFrom(q: Q): LetterFilters & { categoryId?: string } {
  return {
    q: q.q, number: q.number, type: q.type, status: list(q.status), categoryId: q.categoryId || undefined, priority: q.priority,
    confidentiality: q.confidentiality, dateField: q.dateField as LetterFilters['dateField'], dateFrom: q.dateFrom, dateTo: q.dateTo,
    sender: q.sender, recipient: q.recipient, mine: bool(q.mine), archived: (q.archived as LetterFilters['archived']) || undefined,
    awaitingReply: bool(q.awaitingReply), responseOverdue: bool(q.responseOverdue), tag: q.tag, createdByUserId: q.createdByUserId,
    relatedContactId: q.relatedContactId, replyToLetterId: q.replyToLetterId,
  };
}

function sendPdf(res: Response, buffer: Buffer, filename: string, snapshot: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="letter.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Letter-Snapshot', snapshot ? '1' : '0');
  res.send(buffer);
}

/**
 * مکاتبات سازمانی (دبیرخانه). همه‌ی مسیرهای by-id در دامنه‌ی دید کاربر حل می‌شوند و خارج از آن ۴۰۴ می‌دهند
 * (CorrespondenceCoreService.findVisible). نوشتن تنظیمات فقط مدیر.
 */
@Controller('correspondence')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('correspondence')
export class CorrespondenceController {
  constructor(
    private readonly core: CorrespondenceCoreService,
    private readonly letters: CorrespondenceLettersService,
    private readonly workflow: CorrespondenceWorkflowService,
    private readonly referrals: CorrespondenceReferralsService,
    private readonly settings: CorrespondenceSettingsService,
  ) {}

  /** هر مسیر ابتدا دسترسی «مشاهده» را می‌سنجد (matrix) و هویت را برمی‌گرداند. */
  private async actorFor(ctx: TenantRequestContext): Promise<CorrActor> {
    const actor = await this.core.actor(ctx);
    if (!actor.matrix.canViewAll && !actor.matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    return actor;
  }

  private assertManager(actor: CorrActor) {
    if (!actor.isManager) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند تنظیمات مکاتبات را تغییر دهد');
  }

  // ── عمومی/داشبورد ──────────────────────────────────────────────────────
  @Get('people')
  async people(@Ctx() ctx: TenantRequestContext) {
    const a = await this.actorFor(ctx);
    return this.letters.people(ctx, !(a.isManager || a.matrix.canViewAll));
  }

  @Get('me')
  async me(@Ctx() ctx: TenantRequestContext) {
    const a = await this.actorFor(ctx);
    return { userId: a.userId, name: a.name, title: a.title, isManager: a.isManager, isOwner: a.isOwner, matrix: a.matrix };
  }

  @Get('counters')
  async counters(@Ctx() ctx: TenantRequestContext) {
    return this.letters.counters(ctx, await this.actorFor(ctx));
  }

  @Get('inbox')
  async inbox(@Query('tab') tab: unknown, @Ctx() ctx: TenantRequestContext) {
    if (typeof tab !== 'string') throw new BadRequestException('پارامتر «tab» نامعتبر است');
    return this.letters.inbox(ctx, await this.actorFor(ctx), tab);
  }

  @Get('reports/overdue')
  async overdue(@Ctx() ctx: TenantRequestContext) {
    return this.letters.overdueReport(ctx, await this.actorFor(ctx));
  }

  // ── فهرست/ثبت ──────────────────────────────────────────────────────────
  @Get('letters')
  async list(@Query() raw: Record<string, unknown>, @Ctx() ctx: TenantRequestContext) {
    const q = simpleQuery(raw);
    return this.letters.list(ctx, await this.actorFor(ctx), filtersFrom(q), q.cursor || undefined, q.limit ? Number(q.limit) : undefined);
  }

  @Get('letters/register.csv')
  async registerCsv(@Query() raw: Record<string, unknown>, @Res() res: Response, @Ctx() ctx: TenantRequestContext) {
    const filters = filtersFrom(simpleQuery(raw));
    const csv = await this.letters.registerCsv(ctx, await this.actorFor(ctx), filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="letter-register.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Post('letters')
  async create(@Body() dto: CreateLetterDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.createDraft(ctx, await this.actorFor(ctx), dto);
  }

  @Post('letters/incoming')
  async registerIncoming(@Body() dto: RegisterIncomingDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.registerIncoming(ctx, await this.actorFor(ctx), dto);
  }

  @Post('letters/incoming/check-duplicate')
  async checkDuplicate(@Body() dto: Pick<RegisterIncomingDto, 'senderContactId' | 'senderOrgName' | 'senderName' | 'externalNumber' | 'externalDate'>, @Ctx() ctx: TenantRequestContext) {
    const r = await this.letters.findDuplicates(ctx, await this.actorFor(ctx), dto);
    // فقط وجود تکرار + مواردی که در دامنه‌ی خود کاربر است؛ تعداد مخفی‌ها عمداً برنمی‌گردد (نشت وجود نامه‌ی محرمانه)
    return { hasDuplicate: r.count > 0, duplicates: r.visible };
  }

  @Post('letters/bulk-archive')
  async bulkArchive(@Body() dto: BulkArchiveDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.bulkArchive(ctx, await this.actorFor(ctx), dto.ids, dto.folderId, dto.retentionUntil);
  }

  @Get('letters/:id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.letters.getDetail(ctx, await this.actorFor(ctx), id);
  }

  @Patch('letters/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateLetterDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.update(ctx, await this.actorFor(ctx), id, dto);
  }

  @Delete('letters/:id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.letters.deleteDraft(ctx, await this.actorFor(ctx), id);
  }

  @Get('letters/:id/revisions')
  async revisions(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.letters.revisions(ctx, await this.actorFor(ctx), id);
  }

  @Get('letters/:id/pdf')
  async pdf(@Param('id') id: string, @Query('paraphs') paraphs: unknown, @Res() res: Response, @Ctx() ctx: TenantRequestContext) {
    const r = await this.workflow.pdfFor(ctx, await this.actorFor(ctx), id, { withParaphs: bool(typeof paraphs === 'string' ? paraphs : undefined) });
    sendPdf(res, r.buffer, r.filename, r.snapshot);
  }

  @Get('letters/:id/slip')
  async slip(@Param('id') id: string, @Query('variant') variant: unknown, @Res() res: Response, @Ctx() ctx: TenantRequestContext) {
    const r = await this.workflow.slipPdf(ctx, await this.actorFor(ctx), id, variant === 'label' ? 'label' : 'slip');
    sendPdf(res, r.buffer, r.filename, false);
  }

  @Get('letters/:id/evidence')
  async evidence(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.evidenceFor(ctx, await this.actorFor(ctx), id);
  }

  // ── گردش ───────────────────────────────────────────────────────────────
  @Post('letters/:id/submit')
  async submit(@Param('id') id: string, @Body() dto: SubmitDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.submit(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/review')
  async review(@Param('id') id: string, @Body() dto: ReviewDecisionDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.review(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/sign')
  async sign(@Param('id') id: string, @Body() dto: SignDto, @Req() req: Request, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.sign(ctx, await this.actorFor(ctx), id, dto, req);
  }
  @Post('letters/:id/return')
  async returnBack(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.returnForEdit(ctx, await this.actorFor(ctx), id, dto.note);
  }
  @Post('letters/:id/reject')
  async reject(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.reject(ctx, await this.actorFor(ctx), id, dto.note);
  }
  @Post('letters/:id/void')
  async voidIt(@Param('id') id: string, @Body() dto: ReasonDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.voidLetter(ctx, await this.actorFor(ctx), id, dto.reason);
  }
  @Post('letters/:id/reopen')
  async reopen(@Param('id') id: string, @Body() dto: OptionalNoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.reopen(ctx, await this.actorFor(ctx), id, dto.note);
  }
  @Post('letters/:id/close')
  async close(@Param('id') id: string, @Body() dto: OptionalNoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.closeIncoming(ctx, await this.actorFor(ctx), id, dto.note);
  }
  @Post('letters/:id/sent')
  async sent(@Param('id') id: string, @Body() dto: MarkSentDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.markSent(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/delivered')
  async delivered(@Param('id') id: string, @Body() dto: MarkDeliveredDto, @Ctx() ctx: TenantRequestContext) {
    return this.workflow.markDelivered(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/reply')
  async reply(@Param('id') id: string, @Body() dto: ReplyDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.createReply(ctx, await this.actorFor(ctx), id, dto.type ?? 'OUTGOING');
  }
  @Post('letters/:id/correction')
  async correction(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.letters.createCorrection(ctx, await this.actorFor(ctx), id);
  }
  @Post('letters/:id/followups')
  async followup(@Param('id') id: string, @Body() dto: ExternalFollowupDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.addFollowup(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/archive')
  async archive(@Param('id') id: string, @Body() dto: ArchiveDto, @Ctx() ctx: TenantRequestContext) {
    return this.letters.archive(ctx, await this.actorFor(ctx), id, dto.folderId, dto.retentionUntil);
  }
  @Post('letters/:id/unarchive')
  async unarchive(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.letters.unarchive(ctx, await this.actorFor(ctx), id);
  }

  // ── ارجاع و پاراف ──────────────────────────────────────────────────────
  @Post('letters/:id/refer')
  async refer(@Param('id') id: string, @Body() dto: ReferralInputDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.refer(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('letters/:id/paraphs')
  async paraph(@Param('id') id: string, @Body() dto: ParaphDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.addParaph(ctx, await this.actorFor(ctx), id, dto.text);
  }
  @Post('referrals/:id/seen')
  async seen(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.markSeen(ctx, await this.actorFor(ctx), id);
  }
  @Post('referrals/:id/done')
  async done(@Param('id') id: string, @Body() dto: ReferralResponseDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.complete(ctx, await this.actorFor(ctx), id, dto.response);
  }
  @Post('referrals/:id/return')
  async refReturn(@Param('id') id: string, @Body() dto: ReferralReturnDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.returnBack(ctx, await this.actorFor(ctx), id, dto.response);
  }
  @Post('referrals/:id/forward')
  async forward(@Param('id') id: string, @Body() dto: ForwardReferralDto, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.forward(ctx, await this.actorFor(ctx), id, dto);
  }
  @Post('referrals/:id/cancel')
  async cancelRef(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.referrals.cancel(ctx, await this.actorFor(ctx), id);
  }

  // ── تنظیمات ────────────────────────────────────────────────────────────
  @Get('categories')
  async categories(@Ctx() ctx: TenantRequestContext) {
    await this.actorFor(ctx);
    return this.settings.listCategories(ctx);
  }
  @Post('categories')
  async createCategory(@Body() dto: CategoryDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.createCategory(ctx, dto);
  }
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.updateCategory(ctx, id, dto);
  }
  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.deleteCategory(ctx, id);
  }

  @Get('numbering-schemes')
  async schemes(@Ctx() ctx: TenantRequestContext) {
    await this.actorFor(ctx);
    return this.settings.listSchemes(ctx);
  }
  @Get('numbering-schemes/preview')
  async previewNumber(@Query('type') type: unknown, @Query('categoryId') categoryId: unknown, @Ctx() ctx: TenantRequestContext) {
    const a = await this.actorFor(ctx);
    if (typeof type !== 'string' || (categoryId !== undefined && typeof categoryId !== 'string')) throw new BadRequestException('پارامتر نامعتبر است');
    // شمارنده‌ی کلی سازمان فقط برای مدیر/مشاهده‌ی همه؛ «فقط خودم» نباید حجم نامه‌ها را از روی شماره حدس بزند
    if (!(a.isManager || a.matrix.canViewAll)) return { next: null, schemeId: null, pattern: null };
    return this.settings.previewNext(ctx, type, categoryId as string | undefined);
  }
  @Post('numbering-schemes')
  async createScheme(@Body() dto: NumberingSchemeDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.createScheme(ctx, dto);
  }
  @Patch('numbering-schemes/:id')
  async updateScheme(@Param('id') id: string, @Body() dto: UpdateNumberingSchemeDto, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.updateScheme(ctx, id, dto);
  }
  @Delete('numbering-schemes/:id')
  async deleteScheme(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.deleteScheme(ctx, id);
  }

  @Get('archive-folders')
  async folders(@Ctx() ctx: TenantRequestContext) {
    await this.actorFor(ctx);
    return this.settings.listFolders(ctx);
  }
  @Post('archive-folders')
  async createFolder(@Body() dto: FolderDto, @Ctx() ctx: TenantRequestContext) {
    const a = await this.actorFor(ctx);
    if (!(a.isManager || a.matrix.canEdit)) throw new ForbiddenException('اجازه‌ی مدیریت پوشه‌های بایگانی را ندارید');
    return this.settings.createFolder(ctx, dto);
  }
  @Patch('archive-folders/:id')
  async updateFolder(@Param('id') id: string, @Body() dto: FolderDto, @Ctx() ctx: TenantRequestContext) {
    const a = await this.actorFor(ctx);
    if (!(a.isManager || a.matrix.canEdit)) throw new ForbiddenException('اجازه‌ی مدیریت پوشه‌های بایگانی را ندارید');
    return this.settings.updateFolder(ctx, id, dto);
  }
  @Delete('archive-folders/:id')
  async deleteFolder(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    this.assertManager(await this.actorFor(ctx));
    return this.settings.deleteFolder(ctx, id);
  }
}
