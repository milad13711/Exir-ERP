import { describe, expect, it, vi } from 'vitest';
import { BookingSlotsService } from './booking-slots.service.js';
import { fromTehran, tehranParts } from './tehran-time.js';

describe('tehran-time', () => {
  it('converts between Tehran wall-clock and absolute time', () => {
    const d = fromTehran('2027-01-10', 12 * 60);
    expect(d.toISOString()).toBe('2027-01-10T08:30:00.000Z');
    expect(tehranParts(d)).toMatchObject({ dateKey: '2027-01-10', minutes: 720 });
  });
});

function ctxWith(opts: { slots?: Array<{ userId: string; weekday: number; startMinute: number; endMinute: number }>; busy?: Array<{ providerUserId: string | null; startAt: Date; endAt: Date }> }) {
  return {
    tenantDb: {
      serviceType: { findUnique: vi.fn().mockResolvedValue({ id: 's', durationMinutes: 60 }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]) },
      staffAvailabilitySlot: { findMany: vi.fn().mockResolvedValue(opts.slots ?? []) },
      appointment: { findMany: vi.fn().mockResolvedValue(opts.busy ?? []) },
    },
  } as never;
}

describe('BookingSlotsService', () => {
  const service = new BookingSlotsService();
  // 2027-01-12 (سه‌شنبه): روز کاری معمولی، تعطیل رسمی نیست

  it('offers only times inside the provider weekly window', async () => {
    const date = '2027-01-12';
    const weekday = tehranParts(fromTehran(date, 720)).weekday;
    const slots = await service.listFreeSlots(ctxWith({ slots: [{ userId: 'u1', weekday, startMinute: 600, endMinute: 720 }] }), { serviceTypeId: 's', date });
    expect(slots.map((s) => s.time)).toEqual(['10:00', '10:30', '11:00']);
  });

  it('removes times that overlap an existing appointment of that provider', async () => {
    const date = '2027-01-12';
    const weekday = tehranParts(fromTehran(date, 720)).weekday;
    const busy = [{ providerUserId: 'u1', startAt: fromTehran(date, 630), endAt: fromTehran(date, 690) }];
    const slots = await service.listFreeSlots(ctxWith({ slots: [{ userId: 'u1', weekday, startMinute: 600, endMinute: 780 }], busy }), { serviceTypeId: 's', date });
    expect(slots.map((s) => s.time)).toEqual(['11:30', '12:00']);
  });

  it('is empty on Friday with default working hours', async () => {
    let friday = '2027-01-15';
    for (let i = 0; i < 7 && tehranParts(fromTehran(friday, 720)).weekday !== 5; i++) friday = `2027-01-${16 + i}`;
    const slots = await service.listFreeSlots(ctxWith({}), { serviceTypeId: 's', date: friday });
    expect(slots).toEqual([]);
  });
});
