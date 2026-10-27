import { UpdateFunnelStageDto } from '../crm/dto/update-funnel-stage.dto.js';
import { buildContactSearchWhere } from '../crm/contact-search.js';
import { CreateDashboardReminderDto } from '../dashboard/dto/create-dashboard-reminder.dto.js';
import type { McpDeps } from './mcp-deps.js';
import { clampLimit, dateProp, idProp, iso, limitProp } from './mcp-tools.common.js';
import { McpValidationError, parseDto } from './mcp-validate.js';
import type { McpTool } from './mcp-tool.types.js';

const FUNNEL_STAGES = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK', 'CHURNED', 'DISQUALIFIED'];

export function buildMiscTools(d: McpDeps): McpTool[] {
  return [
    // ── CRM: قیف مشتری ────────────────────────────────────────────────────
    {
      name: 'search_crm_contacts',
      module: 'crm',
      kind: 'read',
      description: 'جست‌وجوی مخاطبان CRM بر اساس نام، شرکت، موبایل، ایمیل یا کد؛ با نمایش مرحله‌ی قیف مشتری. شناسه‌ی مخاطب را برای ابزارهای قیف لازم دارید.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 100 },
          funnelStage: { type: 'string', enum: FUNNEL_STAGES },
          limit: limitProp(30),
        },
      },
      handler: async (a, ctx) => {
        const where = { ...buildContactSearchWhere(a.q, 'all'), ...(typeof a.funnelStage === 'string' ? { funnelStage: a.funnelStage } : {}) };
        const rows = await ctx.tenantDb.crmContact.findMany({
          where: where as never,
          orderBy: { createdAt: 'desc' },
          take: clampLimit(a.limit, 15, 30),
          select: { id: true, name: true, company: true, phone: true, funnelStage: true, isCustomer: true, createdAt: true },
        });
        return rows.map((r) => ({ id: r.id, name: r.name, company: r.company, phone: r.phone, funnelStage: r.funnelStage, isCustomer: r.isCustomer, createdAt: iso(r.createdAt) }));
      },
    },
    {
      name: 'update_funnel_stage',
      module: 'crm',
      kind: 'write',
      description:
        'جابه‌جایی دستی یک سرنخ بین مراحل پیش از خرید قیف: NEW_LEAD، CONTACTED، QUALIFIED (نیازمند تأیید کاربر). مراحل پس از خرید با رویدادهای واقعی (فاکتور، برد فرصت) پیش می‌رود و دستی نیست. برای رد صلاحیت از disqualify_lead و برای تبدیل به مشتری از convert_lead_to_customer استفاده کنید.',
      operation: 'UPDATE',
      inputSchema: {
        type: 'object',
        properties: { contactId: idProp('شناسه‌ی مخاطب'), stage: { type: 'string', enum: ['NEW_LEAD', 'CONTACTED', 'QUALIFIED'] } },
        required: ['contactId', 'stage'],
      },
      summarize: (a) => `تغییر مرحله‌ی قیف مخاطب (${String(a.contactId)}) به ${String(a.stage)}`,
      validate: (a) => void parseDto(UpdateFunnelStageDto, { stage: a.stage }),
      handler: async (a, ctx) => {
        const dto = parseDto(UpdateFunnelStageDto, { stage: a.stage });
        const r = await d.funnel.transitionLeadStage(ctx, String(a.contactId), dto.stage);
        if (!r.ok) throw new Error(r.error);
        return { contactId: a.contactId, stage: dto.stage };
      },
    },
    {
      name: 'disqualify_lead',
      module: 'crm',
      kind: 'write',
      description: 'رد صلاحیت یک سرنخ با ذکر دلیل (نیازمند تأیید کاربر). دلیل الزامی است. فقط برای سرنخ‌هایی که هنوز مشتری نشده‌اند.',
      operation: 'UPDATE',
      inputSchema: {
        type: 'object',
        properties: { contactId: idProp('شناسه‌ی مخاطب'), reason: { type: 'string', minLength: 3, maxLength: 500 } },
        required: ['contactId', 'reason'],
      },
      summarize: (a) => `رد صلاحیت سرنخ (${String(a.contactId)}): «${String(a.reason).slice(0, 80)}»`,
      validate: (a) => void parseDto(UpdateFunnelStageDto, { stage: 'DISQUALIFIED', reason: a.reason }),
      handler: async (a, ctx) => {
        const dto = parseDto(UpdateFunnelStageDto, { stage: 'DISQUALIFIED', reason: a.reason });
        const r = await d.funnel.transitionLeadStage(ctx, String(a.contactId), 'DISQUALIFIED', dto.reason);
        if (!r.ok) throw new Error(r.error);
        return { contactId: a.contactId, stage: 'DISQUALIFIED' };
      },
    },
    {
      name: 'convert_lead_to_customer',
      module: 'crm',
      kind: 'write',
      description: 'تبدیل یک سرنخ به مشتری بدون نیاز به فاکتور (نیازمند تأیید کاربر). اگر قبلاً مشتری شده باشد تغییری نمی‌کند. اتوماسیون‌های «تبدیل به مشتری» اجرا می‌شوند.',
      operation: 'UPDATE',
      inputSchema: { type: 'object', properties: { contactId: idProp('شناسه‌ی مخاطب') }, required: ['contactId'] },
      summarize: (a) => `تبدیل سرنخ (${String(a.contactId)}) به مشتری`,
      handler: async (a, ctx) => {
        const r = await d.funnel.convertToCustomer(ctx, String(a.contactId));
        if (!r.ok) throw new Error(r.error);
        return { contactId: a.contactId, converted: r.converted };
      },
    },

    // ── انبار: فقط خواندن (ثبت رسید/حواله سرویس مستقل ندارد و عمداً از MCP باز نشده) ──
    {
      name: 'get_stock_levels',
      module: 'warehouse',
      kind: 'read',
      description: 'موجودی فعلی کالاها (مجموع تغییرات موجودی)، با امکان جست‌وجو، محدودکردن به یک انبار و نمایش فقط کالاهای زیر نقطه‌ی سفارش.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 100, description: 'نام یا کد کالا' },
          warehouseId: idProp('شناسه‌ی انبار (اختیاری)'),
          onlyLow: { type: 'boolean', description: 'فقط کالاهای رسیده به نقطه‌ی سفارش مجدد' },
          limit: limitProp(100),
        },
      },
      handler: async (a, ctx) => {
        const q = typeof a.q === 'string' ? a.q.trim() : '';
        const products = await ctx.tenantDb.product.findMany({
          where: { isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}) },
          orderBy: { name: 'asc' },
          take: 500,
          select: { id: true, sku: true, name: true, unit: true, reorderPoint: true },
        });
        const sums = await ctx.tenantDb.stockMovement.groupBy({
          by: ['productId'],
          where: { productId: { in: products.map((p) => p.id) }, ...(typeof a.warehouseId === 'string' ? { warehouseId: a.warehouseId } : {}) },
          _sum: { quantityDelta: true },
        });
        const stock = new Map(sums.map((s) => [s.productId, s._sum.quantityDelta ?? 0]));
        let rows = products.map((p) => {
          const qty = stock.get(p.id) ?? 0;
          return { id: p.id, sku: p.sku, name: p.name, unit: p.unit, stock: qty, reorderPoint: p.reorderPoint, low: p.reorderPoint > 0 && qty <= p.reorderPoint };
        });
        if (a.onlyLow === true) rows = rows.filter((r) => r.low);
        return rows.slice(0, clampLimit(a.limit, 30, 100));
      },
    },

    // ── یادآوری شخصی ─────────────────────────────────────────────────────
    {
      name: 'create_reminder',
      module: 'dashboard',
      kind: 'write',
      description:
        'ثبت یک یادآوری روی تقویم داشبورد (نیازمند تأیید کاربر). یادآوری برای همان کاربری ثبت می‌شود که درخواست را تأیید می‌کند. تاریخ میلادی YYYY-MM-DD و ساعت HH:mm به وقت تهران.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          date: dateProp('روز یادآوری (YYYY-MM-DD)'),
          time: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'ساعت HH:mm به وقت تهران؛ نبود = تمام‌روز' },
          allDay: { type: 'boolean' },
          note: { type: 'string', maxLength: 2000 },
          channels: { type: 'array', items: { type: 'string', enum: ['IN_APP', 'PUSH', 'SMS', 'EMAIL'] }, maxItems: 4 },
          leadMinutes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 43200 }, maxItems: 6, description: 'پیش‌هشدار (دقیقه قبل از موعد)' },
          repeatRule: { type: 'string', enum: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] },
        },
        required: ['title', 'date'],
      },
      summarize: (a) => `ثبت یادآوری «${String(a.title)}» در ${String(a.date)}${a.time ? ` ساعت ${String(a.time)}` : ''}`,
      validate: (a) => {
        parseDto(CreateDashboardReminderDto, a);
        if (a.time !== undefined && a.allDay === true) throw new McpValidationError('time و allDay=true با هم معنا ندارند');
      },
      handler: async (a, ctx) => {
        const dto = parseDto(CreateDashboardReminderDto, { ...a, allDay: a.allDay ?? a.time === undefined });
        const r = await d.reminders.create(ctx, dto);
        return { id: r.id, remindAt: r.remindAt };
      },
    },
  ];
}
