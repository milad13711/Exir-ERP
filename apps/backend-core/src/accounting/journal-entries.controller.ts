import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, OnModuleInit, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto.js';
import { ensureDefaultChartOfAccounts } from './default-chart-of-accounts.js';

const entryInclude = {
  lines: { include: { account: { select: { id: true, code: true, name: true } } } },
  createdBy: { select: { name: true } },
} as const;

@Controller('accounting/entries')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class JournalEntriesController implements OnModuleInit {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler('JOURNAL_VOID', {
      approve: async (ctx, id, opts) => {
        await this.voidPosted(ctx, id, opts.requestSummary ?? 'ابطال با تأیید مدیر');
      },
      reject: async () => undefined,
      describe: async (ctx, id) => {
        const e = await ctx.tenantDb.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } });
        return {
          fields: [
            { label: 'شماره سند', value: String(e.number) },
            { label: 'شرح', value: e.description ?? '—' },
            { label: 'ردیف‌ها', value: e.lines.map((l) => `${l.account.code} ${l.account.name}: بدهکار ${l.debit} / بستانکار ${l.credit}`).join('\n') },
          ],
        };
      },
    });
  }

  private validateLines(lines: CreateJournalEntryDto['lines']) {
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
    if (totalDebit !== totalCredit) throw new BadRequestException('مجموع بدهکار و بستانکار سند باید برابر باشد');
    if (totalDebit === 0) throw new BadRequestException('مبلغ سند نمی‌تواند صفر باشد');
    for (const line of lines) {
      if ((line.debit ?? 0) > 0 && (line.credit ?? 0) > 0) throw new BadRequestException('هر ردیف سند فقط می‌تواند بدهکار یا بستانکار باشد، نه هر دو');
    }
    return totalDebit;
  }

  /** ابطال سند قطعی‌شده: سند حذف نمی‌شود؛ یک سند معکوس (بدهکار/بستانکار جابه‌جا) ثبت و سند اصلی «باطل‌شده» علامت می‌خورد. */
  private async voidPosted(ctx: TenantRequestContext, id: string, reason: string) {
    const entry = await ctx.tenantDb.journalEntry.findUnique({ where: { id }, include: { lines: true } });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    if (entry.status !== 'POSTED') throw new ConflictException('فقط سند قطعی‌شده ابطال می‌شود؛ پیش‌نویس را حذف کنید');
    if (entry.voidedAt) throw new ConflictException('این سند قبلاً باطل شده است');
    if (entry.reversalOfId) throw new ConflictException('سند معکوس را نمی‌توان دوباره باطل کرد');
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const [reversal] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `ابطال سند شماره ${entry.number}: ${reason}`,
          status: 'POSTED',
          postedAt: new Date(),
          reversalOfId: entry.id,
          createdByUserId: userId ?? undefined,
          lines: { create: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description })) },
        },
      }),
      ctx.tenantDb.journalEntry.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } }),
    ]);
    await this.approvals.closeForEntity(ctx, 'JOURNAL_VOID', id, 'APPROVED');
    return reversal;
  }

  @Put(':id')
  async updateDraft(@Param('id') id: string, @Body() dto: CreateJournalEntryDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    const entry = await ctx.tenantDb.journalEntry.findFirst({ where: { id, ...scope } });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    if (entry.status !== 'DRAFT') throw new ConflictException('سند قطعی‌شده ویرایش نمی‌شود؛ آن را باطل و سند اصلاحی ثبت کنید');
    this.validateLines(dto.lines);
    const [, updated] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalLine.deleteMany({ where: { entryId: id } }),
      ctx.tenantDb.journalEntry.update({
        where: { id },
        data: {
          date: new Date(dto.date),
          description: dto.description,
          lines: { create: dto.lines.map((l) => ({ accountId: l.accountId, debit: BigInt(l.debit ?? 0), credit: BigInt(l.credit ?? 0), description: l.description })) },
        },
        include: entryInclude,
      }),
    ]);
    return updated;
  }

  @Delete(':id')
  async removeDraft(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    const entry = await ctx.tenantDb.journalEntry.findFirst({ where: { id, ...scope } });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    if (entry.status !== 'DRAFT') throw new ConflictException('سند قطعی‌شده حذف نمی‌شود؛ آن را باطل کنید');
    await ctx.tenantDb.journalEntry.delete({ where: { id } });
    return { success: true };
  }

  @Post(':id/void')
  async void(@Param('id') id: string, @Body() dto: { reason?: string }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    const reason = (dto?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('دلیل ابطال را بنویسید');
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    const entry = await ctx.tenantDb.journalEntry.findFirst({ where: { id, ...scope } });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    const outcome = await this.approvals.runOrRequest(
      ctx,
      { moduleCode: 'accounting', entityType: 'JOURNAL_VOID', entityId: id, title: `ابطال سند حسابداری ${entry.number}`, summary: reason, link: '/accounting' },
      () => this.voidPosted(ctx, id, reason),
    );
    return outcome.executed ? { success: true, pendingApproval: false } : { success: true, pendingApproval: true };
  }

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    await ensureDefaultChartOfAccounts(ctx.tenantDb);
    return ctx.tenantDb.journalEntry.findMany({
      where: scope,
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    const entry = await ctx.tenantDb.journalEntry.findUnique({ where: { id, ...scope }, include: entryInclude });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    return entry;
  }

  @Post()
  async create(@Body() dto: CreateJournalEntryDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    const totalDebit = dto.lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    const totalCredit = dto.lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
    if (totalDebit !== totalCredit) {
      throw new BadRequestException('مجموع بدهکار و بستانکار سند باید برابر باشد');
    }
    if (totalDebit === 0) {
      throw new BadRequestException('مبلغ سند نمی‌تواند صفر باشد');
    }
    for (const line of dto.lines) {
      if ((line.debit ?? 0) > 0 && (line.credit ?? 0) > 0) {
        throw new BadRequestException('هر ردیف سند فقط می‌تواند بدهکار یا بستانکار باشد، نه هر دو');
      }
    }

    const createdByUserId = await resolveTenantUserId(ctx);
    const entry = await ctx.tenantDb.journalEntry.create({
      data: {
        date: new Date(dto.date),
        description: dto.description,
        createdByUserId,
        lines: {
          create: dto.lines.map((l) => ({
            accountId: l.accountId,
            debit: BigInt(l.debit ?? 0),
            credit: BigInt(l.credit ?? 0),
            description: l.description,
          })),
        },
      },
      include: entryInclude,
    });

    await ctx.tenantDb.activityLog.create({
      data: {
        userId: createdByUserId,
        action: 'accounting.entry.created',
        entityType: 'JournalEntry',
        entityId: entry.id,
        metadata: { number: entry.number, totalDebit },
      },
    });
    return entry;
  }

  @Post(':id/post')
  async post(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    const scope = await this.permissions.viewScope(ctx, 'accounting', 'createdByUserId');
    const entry = await ctx.tenantDb.journalEntry.findFirst({ where: { id, ...scope } });
    if (!entry) throw new NotFoundException('سند حسابداری یافت نشد');
    if (entry.status === 'POSTED') {
      throw new BadRequestException('این سند قبلاً ثبت قطعی شده است');
    }

    const userId = await resolveTenantUserId(ctx);
    const posted = await ctx.tenantDb.journalEntry.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date() },
      include: entryInclude,
    });

    await ctx.tenantDb.activityLog.create({
      data: {
        userId,
        action: 'accounting.entry.posted',
        entityType: 'JournalEntry',
        entityId: id,
        metadata: { number: entry.number },
      },
    });
    return posted;
  }
}
