import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateStatementLinesDto } from './dto/create-statement-lines.dto.js';
import { MatchStatementLineDto } from './dto/match-statement-line.dto.js';

/**
 * مغایرت‌گیری بانکی — چون اتصال مستقیم به بانک وجود ندارد، ردیف‌های صورت‌حساب
 * دستی وارد می‌شوند و در برابر ردیف‌های دفتر (JournalLine) روی همان حساب
 * صندوق/بانک تطبیق داده می‌شوند. تطبیق فقط یک اشاره‌ی یک‌به‌یک است — هیچ
 * سند حسابداری‌ای از این ماژول صادر نمی‌شود.
 */
@Controller('accounting/reconciliation')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class ReconciliationController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get(':accountId')
  async overview(@Param('accountId') accountId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('حساب یافت نشد');

    const [statementLines, journalLines, allJournalLines] = await Promise.all([
      ctx.tenantDb.bankStatementLine.findMany({
        where: { accountId },
        orderBy: { date: 'desc' },
        include: { matchedJournalLine: { include: { entry: { select: { number: true, date: true } } } } },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { accountId, entry: { status: 'POSTED' }, bankStatementLine: null },
        include: { entry: { select: { number: true, date: true, description: true } } },
        orderBy: { entry: { date: 'desc' } },
      }),
      ctx.tenantDb.journalLine.findMany({
        where: { accountId, entry: { status: 'POSTED' } },
        select: { debit: true, credit: true },
      }),
    ]);

    const bookBalance = allJournalLines.reduce((sum, l) => sum + (Number(l.debit) - Number(l.credit)), 0);
    const unreconciledStatementLines = statementLines.filter((l) => !l.matchedJournalLineId);
    const reconciledStatementLines = statementLines.filter((l) => l.matchedJournalLineId);
    const statementBalance = statementLines.reduce((sum, l) => sum + Number(l.amount), 0);
    const reconciledBalance = reconciledStatementLines.reduce((sum, l) => sum + Number(l.amount), 0);

    return {
      account,
      bookBalance,
      statementBalance,
      reconciledBalance,
      difference: bookBalance - reconciledBalance,
      unreconciledStatementLines,
      reconciledStatementLines,
      unreconciledJournalLines: journalLines.map((l) => ({
        id: l.id,
        entryNumber: l.entry.number,
        date: l.entry.date,
        description: l.description ?? l.entry.description,
        amount: Number(l.debit) - Number(l.credit),
      })),
    };
  }

  @Post(':accountId/statement-lines')
  async addStatementLines(
    @Param('accountId') accountId: string,
    @Body() dto: CreateStatementLinesDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertCreate(ctx, 'accounting');
    const account = await ctx.tenantDb.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('حساب یافت نشد');
    const userId = await resolveTenantUserId(ctx);
    await ctx.tenantDb.bankStatementLine.createMany({
      data: dto.lines.map((l) => ({
        accountId,
        date: new Date(l.date),
        description: l.description,
        amount: l.amount,
        reference: l.reference,
        createdByUserId: userId,
      })),
    });
    return { success: true, count: dto.lines.length };
  }

  @Delete('statement-lines/:id')
  async removeStatementLine(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    const line = await ctx.tenantDb.bankStatementLine.findUnique({ where: { id } });
    if (!line) throw new NotFoundException('ردیف صورت‌حساب یافت نشد');
    if (line.matchedJournalLineId) throw new ConflictException('این ردیف تطبیق‌خورده است — ابتدا تطبیق را لغو کنید');
    await ctx.tenantDb.bankStatementLine.delete({ where: { id } });
    return { success: true };
  }

  @Post('match')
  async match(@Body() dto: MatchStatementLineDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const [statementLine, journalLine] = await Promise.all([
      ctx.tenantDb.bankStatementLine.findUnique({ where: { id: dto.statementLineId } }),
      ctx.tenantDb.journalLine.findUnique({ where: { id: dto.journalLineId }, include: { bankStatementLine: true } }),
    ]);
    if (!statementLine) throw new NotFoundException('ردیف صورت‌حساب یافت نشد');
    if (!journalLine) throw new NotFoundException('ردیف دفتر یافت نشد');
    if (statementLine.matchedJournalLineId) throw new ConflictException('این ردیف صورت‌حساب قبلاً تطبیق‌خورده است');
    if (journalLine.bankStatementLine) throw new ConflictException('این ردیف دفتر قبلاً تطبیق‌خورده است');
    if (statementLine.accountId !== journalLine.accountId) {
      throw new BadRequestException('ردیف صورت‌حساب و ردیف دفتر باید روی یک حساب باشند');
    }
    return ctx.tenantDb.bankStatementLine.update({
      where: { id: dto.statementLineId },
      data: { matchedJournalLineId: dto.journalLineId, reconciledAt: new Date() },
    });
  }

  @Post('unmatch/:statementLineId')
  async unmatch(@Param('statementLineId') statementLineId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const line = await ctx.tenantDb.bankStatementLine.findUnique({ where: { id: statementLineId } });
    if (!line) throw new NotFoundException('ردیف صورت‌حساب یافت نشد');
    return ctx.tenantDb.bankStatementLine.update({
      where: { id: statementLineId },
      data: { matchedJournalLineId: null, reconciledAt: null },
    });
  }

  /**
   * تطبیق خودکار — فقط ردیف‌هایی که مبلغشان دقیقاً یکسان است را جفت می‌کند،
   * یک‌به‌یک و حریصانه. مواردی که ابهام دارند (چند ردیف با مبلغ یکسان) دست‌نخورده
   * می‌مانند تا کاربر خودش تطبیق دهد.
   */
  @Post(':accountId/auto-match')
  async autoMatch(@Param('accountId') accountId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const [statementLines, journalLines] = await Promise.all([
      ctx.tenantDb.bankStatementLine.findMany({ where: { accountId, matchedJournalLineId: null } }),
      ctx.tenantDb.journalLine.findMany({ where: { accountId, entry: { status: 'POSTED' }, bankStatementLine: null } }),
    ]);

    const usedJournalLineIds = new Set<string>();
    const matches: Array<{ statementLineId: string; journalLineId: string }> = [];
    for (const sl of statementLines) {
      const candidate = journalLines.find(
        (jl) => !usedJournalLineIds.has(jl.id) && Number(jl.debit) - Number(jl.credit) === Number(sl.amount),
      );
      if (candidate) {
        usedJournalLineIds.add(candidate.id);
        matches.push({ statementLineId: sl.id, journalLineId: candidate.id });
      }
    }

    await Promise.all(
      matches.map((m) =>
        ctx.tenantDb.bankStatementLine.update({
          where: { id: m.statementLineId },
          data: { matchedJournalLineId: m.journalLineId, reconciledAt: new Date() },
        }),
      ),
    );

    return { matched: matches.length };
  }
}
