import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';

/** JSON Schema, kept intentionally loose (this repo has no schema-builder dependency yet). */
type JsonSchema = Record<string, unknown>;

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: TenantRequestContext) => Promise<unknown>;
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_crm_deals',
    description: 'فهرست فرصت‌های فروش CRM، به‌همراه نام مخاطب و مرحله‌ی فعلی. می‌تواند بر اساس مرحله فیلتر شود.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
          description: 'فیلتر بر اساس مرحله‌ی فرصت فروش (اختیاری)',
        },
      },
    },
    handler: async (args, ctx) => {
      const deals = await ctx.tenantDb.crmDeal.findMany({
        where: typeof args.stage === 'string' ? { stage: args.stage as never } : undefined,
        include: { contact: { select: { name: true, company: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return deals.map((d) => ({
        id: d.id,
        title: d.title,
        value: Number(d.value),
        stage: d.stage,
        contact: d.contact.name,
        company: d.contact.company,
      }));
    },
  },
  {
    name: 'create_crm_contact',
    description: 'ثبت یک مخاطب جدید در CRM (شخص حقیقی یا شرکت).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'نام مخاطب یا شرکت' },
        type: { type: 'string', enum: ['INDIVIDUAL', 'COMPANY'], description: 'نوع مخاطب' },
        phone: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args, ctx) => {
      const ownerUserId = await resolveTenantUserId(ctx);
      const contact = await ctx.tenantDb.crmContact.create({
        data: {
          name: String(args.name),
          type: (args.type as 'INDIVIDUAL' | 'COMPANY') ?? 'INDIVIDUAL',
          phone: typeof args.phone === 'string' ? args.phone : undefined,
          email: typeof args.email === 'string' ? args.email : undefined,
          company: typeof args.company === 'string' ? args.company : undefined,
          ownerUserId,
        },
      });
      return { id: contact.id, name: contact.name };
    },
  },
  {
    name: 'list_tasks',
    description: 'فهرست وظایف باز (انجام‌نشده) در سامانه.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const tasks = await ctx.tenantDb.task.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt }));
    },
  },
  {
    name: 'create_task',
    description: 'ثبت یک وظیفه‌ی جدید.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان وظیفه' },
        priority: { type: 'string', enum: ['NORMAL', 'MEDIUM', 'URGENT'] },
      },
      required: ['title'],
    },
    handler: async (args, ctx) => {
      const assignedUserId = await resolveTenantUserId(ctx);
      const task = await ctx.tenantDb.task.create({
        data: {
          title: String(args.title),
          priority: (args.priority as 'NORMAL' | 'MEDIUM' | 'URGENT') ?? 'NORMAL',
          assignedUserId,
        },
      });
      return { id: task.id, title: task.title };
    },
  },
  {
    name: 'get_accounting_summary',
    description: 'خلاصه‌ی وضعیت مالی: موجودی نقد و بانک، درآمد و هزینه‌ی ماه جاری، تعداد اسناد پیش‌نویس.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [cashAccounts, monthLines, draftCount] = await Promise.all([
        ctx.tenantDb.account.findMany({
          where: { isCashAccount: true },
          include: { lines: { where: { entry: { status: 'POSTED' } }, select: { debit: true, credit: true } } },
        }),
        ctx.tenantDb.journalLine.findMany({
          where: { entry: { status: 'POSTED', date: { gte: monthStart } } },
          include: { account: { select: { type: true } } },
        }),
        ctx.tenantDb.journalEntry.count({ where: { status: 'DRAFT' } }),
      ]);

      const cashBalance = cashAccounts.reduce(
        (sum, acc) =>
          sum +
          acc.lines.reduce(
            (s, l) => s + (acc.type === 'ASSET' ? 1 : -1) * (Number(l.debit) - Number(l.credit)),
            0,
          ),
        0,
      );
      const monthRevenue = monthLines
        .filter((l) => l.account.type === 'REVENUE')
        .reduce((s, l) => s + (Number(l.credit) - Number(l.debit)), 0);
      const monthExpense = monthLines
        .filter((l) => l.account.type === 'EXPENSE')
        .reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0);

      return { cashBalance, monthRevenue, monthExpense, draftJournalEntries: draftCount };
    },
  },
];
