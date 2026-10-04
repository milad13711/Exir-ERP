import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateBudgetDto } from './dto/create-budget.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';
import { accountBalance } from './balance.js';

const BUDGET_INCLUDE = { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } } };

@Controller('accounting/budgets')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class BudgetsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    return ctx.tenantDb.budget.findMany({ orderBy: { periodStart: 'desc' } });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'accounting');
    const budget = await ctx.tenantDb.budget.findUnique({ where: { id }, include: BUDGET_INCLUDE });
    if (!budget) throw new NotFoundException('بودجه یافت نشد');

    const actuals = await Promise.all(
      budget.lines.map(async (line) => {
        const journalLines = await ctx.tenantDb.journalLine.findMany({
          where: {
            accountId: line.accountId,
            entry: { status: 'POSTED', date: { gte: budget.periodStart, lte: budget.periodEnd } },
          },
          select: { debit: true, credit: true },
        });
        const actual = accountBalance(
          line.account.type,
          journalLines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) })),
        );
        return { lineId: line.id, actual };
      }),
    );
    const actualByLineId = new Map(actuals.map((a) => [a.lineId, a.actual]));

    return {
      ...budget,
      lines: budget.lines.map((l) => {
        const actual = actualByLineId.get(l.id) ?? 0;
        return { ...l, actual, variance: l.amount - actual };
      }),
    };
  }

  @Post()
  async create(@Body() dto: CreateBudgetDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'accounting');
    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.budget.create({
      data: {
        name: dto.name,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        createdByUserId,
        lines: { create: dto.lines },
      },
      include: BUDGET_INCLUDE,
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateBudgetDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    await this.permissions.assertViewAll(ctx, 'accounting'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    await ctx.tenantDb.budget.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.budget.update({
      where: { id },
      data: {
        name: dto.name,
        ...(dto.periodStart ? { periodStart: new Date(dto.periodStart) } : {}),
        ...(dto.periodEnd ? { periodEnd: new Date(dto.periodEnd) } : {}),
        ...(dto.lines ? { lines: { deleteMany: {}, create: dto.lines } } : {}),
      },
      include: BUDGET_INCLUDE,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'accounting');
    await this.permissions.assertViewAll(ctx, 'accounting'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    await ctx.tenantDb.budget.findUniqueOrThrow({ where: { id } });
    await ctx.tenantDb.budget.delete({ where: { id } });
    return { success: true };
  }
}
