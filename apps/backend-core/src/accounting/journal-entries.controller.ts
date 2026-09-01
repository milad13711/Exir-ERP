import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
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
export class JournalEntriesController {
  constructor(private readonly permissions: PermissionsService) {}

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
    const entry = await ctx.tenantDb.journalEntry.findUnique({ where: { id } });
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
