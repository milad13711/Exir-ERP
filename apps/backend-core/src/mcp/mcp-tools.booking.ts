import { CreateAppointmentDto } from '../booking/dto/create-appointment.dto.js';
import type { McpDeps } from './mcp-deps.js';
import { clampLimit, clip, dateProp, idProp, iso, isoProp, limitProp } from './mcp-tools.common.js';
import { parseDto } from './mcp-validate.js';
import type { McpTool } from './mcp-tool.types.js';

const APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PENDING_COORDINATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export function buildBookingTools(d: McpDeps): McpTool[] {
  return [
    {
      name: 'list_booking_services',
      module: 'booking',
      kind: 'read',
      description: 'فهرست خدمات قابل رزرو (id، نام، مدت). شناسه‌ی خدمت را برای list_free_slots و create_appointment لازم دارید.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_a, ctx) => {
        const list = await d.serviceTypes.list(ctx, false);
        return (list as any[]).map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, requiresCoordination: !!s.requiresCoordination }));
      },
    },
    {
      name: 'list_free_slots',
      module: 'booking',
      kind: 'read',
      description:
        'وقت‌های آزاد رزرو برای یک خدمت در یک روز (و اختیاری یک کارشناس). همان منطق رزرو آنلاین: ساعت کاری، تعطیلات، نوبت‌های موجود و ساعت‌های غیرفعال لحاظ می‌شود. فقط از همین وقت‌ها نوبت بسازید.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          serviceTypeId: idProp('شناسه‌ی خدمت'),
          date: dateProp('روز مورد نظر YYYY-MM-DD (میلادی، به وقت تهران)'),
          providerUserId: idProp('شناسه‌ی کارشناس (اختیاری)'),
        },
        required: ['serviceTypeId', 'date'],
      },
      handler: async (a, ctx) => {
        const slots = await d.slots.listFreeSlots(ctx, {
          serviceTypeId: String(a.serviceTypeId),
          date: String(a.date),
          providerUserId: a.providerUserId as string | undefined,
        });
        return slots.slice(0, 80);
      },
    },
    {
      name: 'list_appointments',
      module: 'booking',
      kind: 'read',
      description: 'فهرست نوبت‌ها با فیلتر بازه‌ی زمانی، وضعیت، کارشناس یا مشتری (مرتب بر اساس زمان شروع).',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          from: isoProp('از زمان'),
          to: isoProp('تا زمان'),
          status: { type: 'string', enum: APPOINTMENT_STATUSES },
          providerUserId: idProp('شناسه‌ی کارشناس'),
          contactId: idProp('شناسه‌ی مشتری'),
          limit: limitProp(100),
        },
      },
      handler: async (a, ctx) => {
        const rows: any[] = await d.appointments.list(ctx, {
          from: a.from ? new Date(String(a.from)) : undefined,
          to: a.to ? new Date(String(a.to)) : undefined,
          status: a.status as string | undefined,
          providerUserId: a.providerUserId as string | undefined,
          contactId: a.contactId as string | undefined,
        });
        return rows.slice(0, clampLimit(a.limit, 30, 100)).map((r) => ({
          id: r.id,
          service: r.serviceType?.name ?? null,
          status: r.status,
          paymentStatus: r.paymentStatus,
          customerName: r.customerName,
          customerPhone: r.customerPhone ?? null,
          provider: r.provider?.name ?? null,
          startAt: iso(r.startAt),
          endAt: iso(r.endAt),
          notes: clip(r.notes, 200),
        }));
      },
    },
    {
      name: 'create_appointment',
      module: 'booking',
      kind: 'write',
      description:
        'ثبت نوبت جدید برای مشتری (نیازمند تأیید کاربر). startAt باید دقیقاً یکی از وقت‌های list_free_slots باشد؛ در زمان اجرای تأییدشده دوباره بررسی می‌شود و اگر دیگر آزاد نباشد ثبت نمی‌شود. پیامک/اعلان‌های رزرو طبق تنظیمات ماژول ارسال می‌شود.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          serviceTypeId: idProp('شناسه‌ی خدمت'),
          providerUserId: idProp('شناسه‌ی کارشناس (اختیاری)'),
          contactId: idProp('شناسه‌ی مشتری در CRM (اختیاری)'),
          customerName: { type: 'string', minLength: 2, maxLength: 120 },
          customerPhone: { type: 'string', maxLength: 20 },
          startAt: isoProp('زمان شروع (از list_free_slots)'),
          notes: { type: 'string', maxLength: 1000 },
        },
        required: ['serviceTypeId', 'customerName', 'startAt'],
      },
      summarize: (a) => `ثبت نوبت برای «${String(a.customerName)}» در ${String(a.startAt)}`,
      validate: (a) => void parseDto(CreateAppointmentDto, a),
      handler: async (a, ctx) => {
        const dto = parseDto(CreateAppointmentDto, a);
        const slot = await d.slots.findSlot(ctx, { serviceTypeId: dto.serviceTypeId, providerUserId: dto.providerUserId, startAt: new Date(dto.startAt) });
        if (!slot) throw new Error('این زمان دیگر آزاد نیست؛ یک وقت دیگر از list_free_slots انتخاب کنید');
        const res: any = await d.appointments.create(ctx, dto.providerUserId || !slot.providerIds.length ? dto : { ...dto, providerUserId: slot.providerIds[0] });
        return { id: res.id, status: res.status, startAt: iso(res.startAt) };
      },
    },
  ];
}
