import { DeclareShipmentDto } from '../dispatch/dto/dispatch.dto.js';
import type { McpDeps } from './mcp-deps.js';
import { clampLimit, clip, dateProp, idProp, iso, isoProp, limitProp } from './mcp-tools.common.js';
import { parseDto } from './mcp-validate.js';
import type { McpTool } from './mcp-tool.types.js';

const SHIPMENT_STATUSES = [
  'DRAFT', 'OFFERED', 'ACCEPTED', 'DELIVERED', 'CANCELLED', 'AWAITING_DRIVER', 'VEHICLE_ARRIVED', 'CLEANLINESS_APPROVED', 'TARE_RECORDED',
  'LOADED', 'WEIGHED', 'AWAITING_DOCS', 'FINAL_CHECK', 'READY_TO_DEPART', 'IN_TRANSIT', 'SUSPENDED',
];

export function buildDispatchTools(d: McpDeps): McpTool[] {
  return [
    {
      name: 'search_shipments',
      module: 'dispatch',
      kind: 'read',
      description:
        'فهرست و جست‌وجوی بارهای ماژول اعلام بار با فیلتر راننده، منطقه، وضعیت، نوع بار، بازه‌ی وزن خالص (کیلوگرم) و تاریخ ثبت؛ به‌همراه جمع وزن خالص و تعداد به تفکیک وضعیت.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: SHIPMENT_STATUSES },
          driverId: idProp('شناسه‌ی راننده'),
          region: { type: 'string', maxLength: 100 },
          cargoType: { type: 'string', maxLength: 200 },
          contactId: idProp('شناسه‌ی مشتری'),
          minNetKg: { type: 'number', minimum: 0, maximum: 1000000 },
          maxNetKg: { type: 'number', minimum: 0, maximum: 1000000 },
          from: dateProp('ثبت از تاریخ (YYYY-MM-DD)'),
          to: dateProp('ثبت تا تاریخ (YYYY-MM-DD)'),
          q: { type: 'string', maxLength: 200, description: 'شماره‌ی بار، نام مشتری/راننده، پلاک یا نوع بار' },
          limit: limitProp(50),
        },
      },
      handler: async (a, ctx) => {
        const limit = clampLimit(a.limit);
        const res = await d.dispatchReport.query(ctx, {
          status: a.status as string | undefined,
          driverId: a.driverId as string | undefined,
          region: a.region as string | undefined,
          cargoType: a.cargoType as string | undefined,
          contactId: a.contactId as string | undefined,
          minNetKg: a.minNetKg as number | undefined,
          maxNetKg: a.maxNetKg as number | undefined,
          from: a.from as string | undefined,
          to: a.to as string | undefined,
          q: a.q as string | undefined,
          onlyDispatch: true,
          limit,
        });
        return {
          summary: res.summary,
          shipments: res.rows.slice(0, limit).map((r) => ({
            id: r.id,
            shipmentNo: r.shipmentNo,
            status: r.status,
            statusLabel: r.statusLabel,
            customer: r.customerName,
            cargoType: r.cargoType,
            region: r.region,
            driver: r.driverName,
            plate: r.plateNumber,
            tareKg: r.tareKg,
            grossKg: r.grossKg,
            netKg: r.netKg,
            createdAt: iso(r.createdAt),
            deliveredAt: iso(r.deliveredAt),
          })),
        };
      },
    },
    {
      name: 'get_shipment',
      module: 'dispatch',
      kind: 'read',
      description: 'جزئیات یک بار: وضعیت، راننده، وزن‌ها (خالی، پر، خالص، مورد انتظار، تأیید وزن)، اسناد ناقص و خط زمان کامل رویدادها. لینک‌ها و فایل‌ها برنمی‌گردد.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: { shipmentId: idProp('شناسه‌ی بار (id از search_shipments)') }, required: ['shipmentId'] },
      handler: async (a, ctx) => {
        const r: any = await d.dispatch.detail(ctx, String(a.shipmentId));
        const s = r.shipment;
        const l = s.loading;
        return {
          id: s.id,
          shipmentNo: s.shipmentNo,
          status: s.status,
          statusLabel: r.statusLabels?.[s.status] ?? s.status,
          customer: l?.customerName ?? s.contact?.name ?? null,
          cargoType: s.cargoType,
          quantity: s.quantity,
          unit: s.unit,
          region: s.region,
          deliveryAddress: clip(s.deliveryAddress, 300),
          pickupAt: iso(s.pickupAt),
          driver: s.driver ? { name: s.driver.name, plate: s.driver.plateNumber, vehicle: s.driver.vehicleType } : null,
          weights: l
            ? {
                needsWeighing: l.needsWeighing,
                expectedKg: l.expectedWeightKg ?? null,
                tareKg: l.tareKg ?? null,
                grossKg: l.grossKg ?? null,
                netKg: l.netKg ?? null,
                weightConfirmedAt: iso(l.weightConfirmedAt),
              }
            : null,
          docs: { complete: r.docsComplete, missing: r.missingDocTypes },
          receiptStatus: r.receipt?.status ?? null,
          timeline: (r.events ?? []).map((e: any) => ({ type: e.type, at: iso(e.createdAt), by: e.actorName, from: e.fromStatus, to: e.toStatus, note: clip(e.note ?? e.reason, 300) })),
        };
      },
    },
    {
      name: 'get_dispatch_overview',
      module: 'dispatch',
      kind: 'read',
      description: 'شمارنده‌ی سریع بارهای فعال اعلام بار به تفکیک وضعیت: منتظر راننده، منتظر اسناد، آماده‌ی حرکت، در مسیر، متوقف.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: (_a, ctx) => d.dispatchReport.activeCounts(ctx),
    },
    {
      name: 'declare_shipment',
      module: 'dispatch',
      kind: 'write',
      description:
        'اعلام بار جدید (نیازمند تأیید کاربر). می‌تواند دستی باشد یا از روی یک فاکتور فروش (sourceType=SALES_INVOICE) یا دستور تولید (PRODUCTION_ORDER) با sourceId؛ برای منبع، سرور از ثبت بار تکراری برای همان منبع جلوگیری می‌کند. راننده و مراحل بعدی (وزن‌کشی، اسناد، حرکت) را کاربر در پنل پیش می‌برد.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          sourceType: { type: 'string', enum: ['MANUAL', 'SALES_INVOICE', 'PRODUCTION_ORDER'] },
          sourceId: idProp('شناسه‌ی فاکتور یا دستور تولید (اگر sourceType دستی نیست الزامی است)'),
          contactId: idProp('شناسه‌ی مشتری'),
          cargoType: { type: 'string', minLength: 1, maxLength: 200 },
          quantity: { type: 'integer', minimum: 1, maximum: 2000000000 },
          unit: { type: 'string', maxLength: 40 },
          deliveryAddress: { type: 'string', minLength: 2, maxLength: 600 },
          region: { type: 'string', maxLength: 100 },
          pickupAt: isoProp('زمان بارگیری'),
          needsWeighing: { type: 'boolean' },
          kgPerUnit: { type: 'number', minimum: 0.001, maximum: 100000 },
          expectedWeightKg: { type: 'number', minimum: 0, maximum: 1000000 },
        },
        required: ['cargoType', 'quantity', 'deliveryAddress', 'pickupAt'],
      },
      summarize: (a) => `اعلام بار: ${String(a.cargoType)} × ${String(a.quantity)} به «${String(a.deliveryAddress).slice(0, 60)}»${a.sourceType && a.sourceType !== 'MANUAL' ? ` (از روی ${a.sourceType === 'SALES_INVOICE' ? 'فاکتور' : 'دستور تولید'})` : ''}`,
      validate: (a) => {
        const dto = parseDto(DeclareShipmentDto, a);
        if (dto.sourceType && dto.sourceType !== 'MANUAL' && !dto.sourceId) throw new Error('برای منبع فاکتور/تولید، sourceId الزامی است');
      },
      handler: async (a, ctx) => {
        const dto = parseDto(DeclareShipmentDto, a);
        const res: any = await d.dispatch.declare(ctx, dto);
        const s = res.shipment ?? res;
        return { id: s.id ?? s.shipment?.id, shipmentNo: s.shipmentNo ?? s.shipment?.shipmentNo, alreadyExisted: !!res.alreadyExisted };
      },
    },
    {
      name: 'get_operations_overview',
      module: 'operations',
      kind: 'read',
      description: 'شمارنده‌های داشبورد عملیات وظایف: جدید، در حال انجام، معوق، منتظر تأیید، دارای مشکل، انجام‌شده امروز/این هفته، زمان‌بندی‌شده.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: (_a, ctx) => d.operations.counters(ctx),
    },
  ];
}
