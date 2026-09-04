import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { InvoicesService } from '../sales/invoices.service.js';
import type { PurchaseOrdersService } from '../purchasing/purchase-orders.service.js';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';

/** Every module-suggestion ticket is tagged this way so list_module_suggestions can find them among regular support tickets without a schema change. */
const MODULE_SUGGESTION_MARKER = '[پیشنهاد ماژول]';

/** JSON Schema, kept intentionally loose (this repo has no schema-builder dependency yet). */
type JsonSchema = Record<string, unknown>;

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** READ runs immediately when called. CREATE/UPDATE/DELETE never run on the caller's turn — see mcp.controller.ts — they only run once a human approves the pending request this produces, via the same handler. */
  operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
  /** Required for every non-READ tool — the human-readable line shown on the approval popup/list. */
  summarize?: (args: Record<string, unknown>) => string;
  handler: (args: Record<string, unknown>, ctx: TenantRequestContext) => Promise<unknown>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Built once per process (see McpToolsService) with the two services whose
 * business logic (tax/COGS/credit-check for invoices, cost layering for
 * purchase orders) is non-trivial enough that this file reuses the real
 * thing rather than re-deriving it — every other tool here talks to Prisma
 * directly, same lightweight pattern the first 5 tools already used.
 */
export function buildMcpTools(invoices: InvoicesService, purchaseOrders: PurchaseOrdersService, controlDb: ControlPrismaService): McpTool[] {
  return [
    // ── CRM ──────────────────────────────────────────────────────────────
    {
      name: 'list_crm_deals',
      description: 'فهرست فرصت‌های فروش CRM، به‌همراه نام مخاطب و مرحله‌ی فعلی. می‌تواند بر اساس مرحله فیلتر شود.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['NEW', 'CONTACTED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'], description: 'فیلتر بر اساس مرحله (اختیاری)' },
        },
      },
      handler: async (args, ctx) => {
        const deals = await ctx.tenantDb.crmDeal.findMany({
          where: typeof args.stage === 'string' ? { stage: args.stage as never } : undefined,
          include: { contact: { select: { name: true, company: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        return deals.map((d) => ({ id: d.id, title: d.title, value: Number(d.value), stage: d.stage, contact: d.contact.name, company: d.contact.company }));
      },
    },
    {
      name: 'create_crm_contact',
      description: 'ثبت یک مخاطب جدید در CRM (شخص حقیقی یا شرکت).',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'نام مخاطب یا شرکت' },
          type: { type: 'string', enum: ['INDIVIDUAL', 'COMPANY'] },
          phone: { type: 'string' },
          email: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['name'],
      },
      summarize: (a) => `ثبت مخاطب جدید در CRM: «${String(a.name)}»`,
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
      name: 'update_crm_contact',
      description: 'ویرایش اطلاعات یک مخاطب موجود در CRM (فقط فیلدهای داده‌شده تغییر می‌کند).',
      operation: 'UPDATE',
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['contactId'],
      },
      summarize: (a) => `ویرایش مخاطب CRM (${String(a.contactId)})`,
      handler: async (args, ctx) => {
        const contact = await ctx.tenantDb.crmContact.update({
          where: { id: String(args.contactId) },
          data: {
            name: typeof args.name === 'string' ? args.name : undefined,
            phone: typeof args.phone === 'string' ? args.phone : undefined,
            email: typeof args.email === 'string' ? args.email : undefined,
            company: typeof args.company === 'string' ? args.company : undefined,
          },
        });
        return { id: contact.id, name: contact.name };
      },
    },
    {
      name: 'create_crm_deal',
      description: 'ثبت یک فرصت فروش جدید برای یک مخاطب موجود.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          title: { type: 'string' },
          value: { type: 'number', description: 'ارزش تخمینی فرصت به تومان' },
        },
        required: ['contactId', 'title'],
      },
      summarize: (a) => `ثبت فرصت فروش «${String(a.title)}»`,
      handler: async (args, ctx) => {
        const ownerUserId = await resolveTenantUserId(ctx);
        const deal = await ctx.tenantDb.crmDeal.create({
          data: {
            contactId: String(args.contactId),
            title: String(args.title),
            value: BigInt(Math.round(Number(args.value ?? 0))),
            stage: 'NEW',
            ownerUserId,
          },
        });
        return { id: deal.id, title: deal.title };
      },
    },

    // ── فروش ─────────────────────────────────────────────────────────────
    {
      name: 'list_sales_invoices',
      description: 'فهرست فاکتورهای فروش اخیر، به‌همراه وضعیت و مبلغ.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const list = await ctx.tenantDb.salesInvoice.findMany({
          include: { contact: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });
        return list.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, contact: i.contact.name, status: i.status, total: i.total, paidAmount: i.paidAmount }));
      },
    },
    {
      name: 'create_sales_invoice',
      description: 'ثبت یک فاکتور فروش جدید (پیش‌نویس) برای یک مشتری موجود، با یک یا چند قلم کالا/خدمت.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number', description: 'قیمت واحد به تومان' },
              },
              required: ['description', 'quantity', 'unitPrice'],
            },
          },
          notes: { type: 'string' },
        },
        required: ['contactId', 'lines'],
      },
      summarize: (a) => {
        const lines = Array.isArray(a.lines) ? (a.lines as Array<{ description?: string }>) : [];
        return `ثبت فاکتور فروش جدید — ${lines.length} قلم (${lines.map((l) => l.description).join('، ')})`;
      },
      handler: (args, ctx) =>
        invoices.create(ctx, {
          contactId: String(args.contactId),
          lines: (args.lines as Array<{ description: string; quantity: number; unitPrice: number }>).map((l) => ({
            description: l.description,
            quantity: Math.round(l.quantity),
            unitPrice: Math.round(l.unitPrice),
          })),
          notes: typeof args.notes === 'string' ? args.notes : undefined,
        } as never),
    },

    // ── خرید ─────────────────────────────────────────────────────────────
    {
      name: 'list_purchase_orders',
      description: 'فهرست سفارش‌های خرید اخیر، به‌همراه وضعیت و تأمین‌کننده.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const list = await ctx.tenantDb.purchaseOrder.findMany({
          include: { supplier: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });
        return list.map((o) => ({ id: o.id, orderNo: o.orderNo, supplier: o.supplier.name, status: o.status, total: o.total }));
      },
    },
    {
      name: 'create_purchase_order',
      description: 'ثبت یک سفارش خرید جدید از یک تأمین‌کننده‌ی موجود.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          supplierId: { type: 'string' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitCost: { type: 'number', description: 'بهای واحد به تومان' },
              },
              required: ['description', 'quantity', 'unitCost'],
            },
          },
          notes: { type: 'string' },
        },
        required: ['supplierId', 'lines'],
      },
      summarize: (a) => {
        const lines = Array.isArray(a.lines) ? (a.lines as Array<{ description?: string }>) : [];
        return `ثبت سفارش خرید جدید — ${lines.length} قلم (${lines.map((l) => l.description).join('، ')})`;
      },
      handler: (args, ctx) =>
        purchaseOrders.create(ctx, {
          supplierId: String(args.supplierId),
          lines: (args.lines as Array<{ description: string; quantity: number; unitCost: number }>).map((l) => ({
            description: l.description,
            quantity: Math.round(l.quantity),
            unitCost: Math.round(l.unitCost),
          })),
          notes: typeof args.notes === 'string' ? args.notes : undefined,
        } as never),
    },

    // ── انبار ────────────────────────────────────────────────────────────
    {
      name: 'list_products',
      description: 'فهرست کالاهای فعال انبار به‌همراه موجودی فعلی. می‌تواند بر اساس نام/کد جستجو کند.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'جستجو در نام یا کد کالا (اختیاری)' } } },
      handler: async (args, ctx) => {
        const products = await ctx.tenantDb.product.findMany({
          where: {
            isActive: true,
            ...(typeof args.q === 'string' && args.q ? { OR: [{ name: { contains: args.q, mode: 'insensitive' } }, { sku: { contains: args.q, mode: 'insensitive' } }] } : {}),
          },
          take: 30,
          orderBy: { name: 'asc' },
        });
        return products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, salePrice: p.salePrice }));
      },
    },
    {
      name: 'create_product',
      description: 'ثبت یک کالای جدید در کاتالوگ انبار.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'کد یکتای کالا' },
          name: { type: 'string' },
          unit: { type: 'string' },
          salePrice: { type: 'number' },
          costPrice: { type: 'number' },
        },
        required: ['sku', 'name'],
      },
      summarize: (a) => `ثبت کالای جدید «${String(a.name)}» (کد ${String(a.sku)})`,
      handler: async (args, ctx) => {
        const product = await ctx.tenantDb.product.create({
          data: {
            sku: String(args.sku),
            name: String(args.name),
            unit: typeof args.unit === 'string' ? args.unit : 'عدد',
            salePrice: typeof args.salePrice === 'number' ? Math.round(args.salePrice) : 0,
            costPrice: typeof args.costPrice === 'number' ? Math.round(args.costPrice) : 0,
          },
        });
        return { id: product.id, sku: product.sku, name: product.name };
      },
    },

    // ── حسابداری ─────────────────────────────────────────────────────────
    {
      name: 'get_accounting_summary',
      description: 'خلاصه‌ی وضعیت مالی: موجودی نقد و بانک، درآمد و هزینه‌ی ماه جاری، تعداد اسناد پیش‌نویس.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const [cashAccounts, monthLines, draftCount] = await Promise.all([
          ctx.tenantDb.account.findMany({ where: { isCashAccount: true }, include: { lines: { where: { entry: { status: 'POSTED' } }, select: { debit: true, credit: true } } } }),
          ctx.tenantDb.journalLine.findMany({ where: { entry: { status: 'POSTED', date: { gte: monthStart } } }, include: { account: { select: { type: true } } } }),
          ctx.tenantDb.journalEntry.count({ where: { status: 'DRAFT' } }),
        ]);

        const cashBalance = cashAccounts.reduce((sum, acc) => sum + acc.lines.reduce((s, l) => s + (acc.type === 'ASSET' ? 1 : -1) * (Number(l.debit) - Number(l.credit)), 0), 0);
        const monthRevenue = monthLines.filter((l) => l.account.type === 'REVENUE').reduce((s, l) => s + (Number(l.credit) - Number(l.debit)), 0);
        const monthExpense = monthLines.filter((l) => l.account.type === 'EXPENSE').reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0);

        return { cashBalance, monthRevenue, monthExpense, draftJournalEntries: draftCount };
      },
    },
    {
      name: 'create_journal_entry',
      description: 'ثبت یک سند حسابداری دستی (باید مجموع بدهکار و بستانکار برابر باشد). کد حساب‌ها را از فهرست حساب‌ها بگیرید.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          lines: {
            type: 'array',
            items: { type: 'object', properties: { accountCode: { type: 'string' }, debit: { type: 'number' }, credit: { type: 'number' } }, required: ['accountCode'] },
          },
        },
        required: ['description', 'lines'],
      },
      summarize: (a) => `ثبت سند حسابداری: ${String(a.description)}`,
      handler: async (args, ctx) => {
        const userId = await resolveTenantUserId(ctx);
        const rawLines = args.lines as Array<{ accountCode: string; debit?: number; credit?: number }>;
        const accounts = await ctx.tenantDb.account.findMany({ where: { code: { in: rawLines.map((l) => l.accountCode) } } });
        const byCode = new Map(accounts.map((a) => [a.code, a]));

        const resolved = rawLines.map((l) => {
          const account = byCode.get(l.accountCode);
          if (!account) throw new Error(`کد حساب ${l.accountCode} یافت نشد`);
          return { accountId: account.id, debit: BigInt(Math.round(l.debit ?? 0)), credit: BigInt(Math.round(l.credit ?? 0)) };
        });
        const totalDebit = resolved.reduce((s, l) => s + l.debit, 0n);
        const totalCredit = resolved.reduce((s, l) => s + l.credit, 0n);
        if (totalDebit !== totalCredit) throw new Error(`سند نامتوازن است: بدهکار ${totalDebit} ≠ بستانکار ${totalCredit}`);

        const entry = await ctx.tenantDb.journalEntry.create({
          data: { date: new Date(), description: String(args.description), status: 'POSTED', postedAt: new Date(), createdByUserId: userId, lines: { create: resolved } },
        });
        return { id: entry.id };
      },
    },

    // ── منابع انسانی ─────────────────────────────────────────────────────
    {
      name: 'list_employees',
      description: 'فهرست کارمندان فعال، به‌همراه سمت و واحد.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const employees = await ctx.tenantDb.employee.findMany({ where: { status: 'ACTIVE' }, take: 50, orderBy: { fullName: 'asc' } });
        return employees.map((e) => ({ id: e.id, fullName: e.fullName, employeeCode: e.employeeCode, position: e.position }));
      },
    },
    {
      name: 'create_leave_request',
      description: 'ثبت درخواست مرخصی برای یک کارمند موجود (نیازمند تأیید مدیر بالادستی، مستقل از این تأیید).',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          type: { type: 'string', enum: ['ANNUAL', 'SICK', 'UNPAID'] },
          startDate: { type: 'string', description: 'تاریخ شروع، YYYY-MM-DD میلادی' },
          endDate: { type: 'string', description: 'تاریخ پایان، YYYY-MM-DD میلادی' },
          reason: { type: 'string' },
        },
        required: ['employeeId', 'startDate', 'endDate'],
      },
      summarize: (a) => `ثبت درخواست مرخصی برای کارمند (${String(a.employeeId)}) از ${String(a.startDate)} تا ${String(a.endDate)}`,
      handler: async (args, ctx) => {
        const start = new Date(String(args.startDate));
        const end = new Date(String(args.endDate));
        if (end < start) throw new Error('تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد');
        const daysCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;

        const request = await ctx.tenantDb.leaveRequest.create({
          data: {
            employeeId: String(args.employeeId),
            type: (args.type as 'ANNUAL' | 'SICK' | 'UNPAID') ?? 'ANNUAL',
            startDate: start,
            endDate: end,
            daysCount,
            reason: typeof args.reason === 'string' ? args.reason : undefined,
          },
        });
        return { id: request.id, daysCount };
      },
    },

    // ── وظایف ────────────────────────────────────────────────────────────
    {
      name: 'list_tasks',
      description: 'فهرست وظایف باز (انجام‌نشده) در سامانه.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const tasks = await ctx.tenantDb.task.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 50 });
        return tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt }));
      },
    },
    {
      name: 'create_task',
      description: 'ثبت یک وظیفه‌ی جدید.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['NORMAL', 'MEDIUM', 'URGENT'] } },
        required: ['title'],
      },
      summarize: (a) => `ثبت وظیفه‌ی جدید: «${String(a.title)}»`,
      handler: async (args, ctx) => {
        const assignedUserId = await resolveTenantUserId(ctx);
        const task = await ctx.tenantDb.task.create({
          data: { title: String(args.title), priority: (args.priority as 'NORMAL' | 'MEDIUM' | 'URGENT') ?? 'NORMAL', assignedUserId },
        });
        return { id: task.id, title: task.title };
      },
    },

    // ── پیشنهاد ماژول جدید به تیم اکسیر ─────────────────────────────────
    {
      name: 'suggest_new_module',
      description:
        'وقتی یک نیاز تکرارشونده‌ی خاصِ این کسب‌وکار/صنف را شناسایی کردید که هیچ ماژول استانداردی امروز پاسخگویش نیست، این پیشنهاد را مستقیماً برای تیم اکسیر ثبت کنید تا بررسی و در صورت تأیید، به‌صورت یک ماژول واقعی ساخته شود. همیشه اول با کاربر مطرح کنید و فقط با رضایت او این ابزار را صدا بزنید.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'عنوان کوتاه ماژول پیشنهادی' },
          description: { type: 'string', description: 'توضیح نیاز، چرا برای این کسب‌وکار/صنف کاربردی است، و چه مشکلی حل می‌کند' },
        },
        required: ['title', 'description'],
      },
      summarize: (a) => `پیشنهاد ماژول جدید به تیم اکسیر: «${String(a.title)}»`,
      handler: async (args, ctx) => {
        const owner = await controlDb.tenantMembership.findFirst({ where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE' } });
        if (!owner) throw new Error('کاربر مالک این محیط کاری یافت نشد');
        const ticket = await controlDb.supportTicket.create({
          data: {
            tenantId: ctx.tenantId,
            createdByUserId: owner.globalUserId,
            subject: `${MODULE_SUGGESTION_MARKER} ${String(args.title)}`,
            priority: 'MEDIUM',
          },
        });
        await controlDb.supportMessage.create({
          data: { ticketId: ticket.id, senderType: 'TENANT_USER', senderId: owner.globalUserId, body: String(args.description) },
        });
        return { id: ticket.id, title: args.title };
      },
    },
    {
      name: 'list_module_suggestions',
      description: 'فهرست پیشنهادهای ماژول جدیدی که قبلاً برای تیم اکسیر ثبت شده، به‌همراه وضعیت بررسی — برای این‌که ببینید آیا پیشنهاد قبلی به یک ماژول واقعی تبدیل شده.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const tickets = await controlDb.supportTicket.findMany({
          where: { tenantId: ctx.tenantId, subject: { startsWith: MODULE_SUGGESTION_MARKER } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        return tickets.map((t) => ({
          id: t.id,
          title: t.subject.replace(MODULE_SUGGESTION_MARKER, '').trim(),
          status: t.status,
          resolutionNote: t.resolutionNote,
          createdAt: t.createdAt,
        }));
      },
    },
  ];
}
