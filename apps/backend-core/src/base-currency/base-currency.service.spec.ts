import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { REQUIRE_MODULE_KEY } from '../common/decorators/require-module.decorator.js';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { HUMAN_ONLY_KEY } from '../common/decorators/human-only.decorator.js';
import { BaseCurrencyController } from './base-currency.controller.js';
import { BaseCurrencyService, normalizePhrase, confirmPhraseFor } from './base-currency.service.js';
import { DEFAULT_BASE_CURRENCY, parseBaseCurrency, toGatewayToman, serializeBaseCurrency } from './base-unit.js';
import { isBlockedDuringConversion, writeLock } from './write-lock.js';
import { BaseCurrencyWriteLockInterceptor } from './write-lock.interceptor.js';

const ctxOf = (over: Record<string, unknown> = {}) =>
  ({ tenantId: 't1', tenantSlug: 't1', auth: { sub: 'g1', role: 'OWNER', type: 'user' }, tenantDb: {}, ...over }) as never;

describe('دسترسی و گیت ماژول', () => {
  it('کنترلر روی ماژول currency-exchange، فقط OWNER و فقط نشست انسانی قفل است', () => {
    expect(Reflect.getMetadata(REQUIRE_MODULE_KEY, BaseCurrencyController)).toBe('currency-exchange');
    expect(Reflect.getMetadata(ROLES_KEY, BaseCurrencyController)).toEqual(['OWNER']);
    expect(Reflect.getMetadata(HUMAN_ONLY_KEY, BaseCurrencyController)).toBe(true);
  });

  it('ModuleGuard واقعی: بدون نصب ماژول «تبدیل ارز» → ۴۰۳', async () => {
    const controlDb = {
      moduleDefinition: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', code: 'currency-exchange', name: 'تبدیل ارز', isCore: false, dependsOn: [] }]) },
      tenantModule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    };
    const guard = new ModuleGuard({ getAllAndOverride: () => 'currency-exchange' } as never, controlDb as never);
    const ec = { getType: () => 'http', getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => ({ ctx: { tenantId: 't1' }, method: 'POST' }) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ec)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('RolesGuard: ADMIN/STAFF رد، OWNER قبول', () => {
    const guard = new RolesGuard(new Reflector());
    const ec = (role: string) =>
      ({ getHandler: () => BaseCurrencyController.prototype.execute, getClass: () => BaseCurrencyController, switchToHttp: () => ({ getRequest: () => ({ ctx: { auth: { role } } }) }) }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(ec('ADMIN'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ec('MEMBER'))).toThrow(ForbiddenException);
    expect(guard.canActivate(ec('OWNER'))).toBe(true);
  });

  it('سرویس هم خودش مالک و نشست انسانی را چک می‌کند (دفاع در عمق)', async () => {
    const svc = new BaseCurrencyService({} as never);
    await expect(svc.preview(ctxOf({ auth: { sub: 'g', role: 'ADMIN', type: 'user' } }), { toCode: 'IRR' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.requestConfirmation(ctxOf({ auth: { sub: 'g', role: 'OWNER', type: 'api_key' } }), { dto: { toCode: 'IRR' } })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.execute(ctxOf({ auth: { sub: 'g', role: 'ADMIN', type: 'user' } }), { toCode: 'IRR', idempotencyKey: 'x', confirmPhrase: 'x', otp: '1' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('طرح تبدیل (resolvePlan)', () => {
  const svc = new BaseCurrencyService({} as never);
  it('تومان→ریال: نرخ ثابت ۱۰ و tomanPerUnit=1/10', () => {
    const p = svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'IRR' });
    expect(p.rate).toEqual({ num: 10n, den: 1n });
    expect(p.toLabel).toBe('ریال');
    expect(p.toState.tomanPerUnit).toEqual({ num: 1n, den: 10n });
    expect(p.mode).toBe('STRICT');
    expect(p.phrase).toBe('تغییر ارز پایه به ریال');
  });
  it('نرخ دلخواه برای ریال⇄تومان رد می‌شود', () => {
    expect(() => svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'IRR', rate: '9' })).toThrow(BadRequestException);
    expect(svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'IRR', rate: '10' }).rate).toEqual({ num: 10n, den: 1n });
  });
  it('ارز یکسان رد؛ جفت‌ارز دلخواه نرخ و عنوان می‌خواهد', () => {
    expect(() => svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'IRT' })).toThrow(/یکی/);
    expect(() => svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'USD' })).toThrow(BadRequestException);
    expect(() => svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'USD', toLabel: 'دلار' })).toThrow(/نرخ/);
    const p = svc.resolvePlan(DEFAULT_BASE_CURRENCY, { toCode: 'USD', toLabel: 'دلار', rate: '0.000024', roundingMode: 'ROUND' });
    expect(p.rate).toEqual({ num: 3n, den: 125000n });
    // هر ۱ دلار = 1/0.000024 تومان
    expect(p.toState.tomanPerUnit).toEqual({ num: 125000n, den: 3n });
  });
  it('ریال→تومان: ۱/۱۰ و tomanPerUnit=1', () => {
    const irr = { ...DEFAULT_BASE_CURRENCY, code: 'IRR', label: 'ریال', tomanPerUnit: { num: 1n, den: 10n } };
    const p = svc.resolvePlan(irr, { toCode: 'IRT' });
    expect(p.rate).toEqual({ num: 1n, den: 10n });
    expect(p.toState.tomanPerUnit).toEqual({ num: 1n, den: 1n });
  });
  it('عبارت تأیید: ارقام و ی/ک عربی و فاصله یکدست می‌شود', () => {
    expect(normalizePhrase('  تغییر   ارز پایه به ريال ')).toBe(normalizePhrase(confirmPhraseFor('ریال')));
  });
});

describe('تأیید پیامکی و اجرا (با دیتابیس ساختگی)', () => {
  let db: Record<string, any>;
  let svc: BaseCurrencyService;
  beforeEach(() => {
    writeLock._reset();
    db = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', phone: '0912', name: 'مالک' }) },
      moduleSetting: { findUnique: vi.fn().mockResolvedValue(null) },
      baseCurrencyConversion: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
      baseCurrencyConfirmation: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    svc = new BaseCurrencyService({} as never, undefined, { isConfigured: () => false } as never);
  });

  it('بدون پیامک‌دهی و بدون OTP_DEV_ECHO، کد ارسال نمی‌شود (۵۰۳) و کد در پاسخ نشت نمی‌کند', async () => {
    delete process.env.OTP_DEV_ECHO;
    await expect(svc.requestConfirmation(ctxOf({ tenantDb: db }), { dto: { toCode: 'IRR' } })).rejects.toThrow(/پیامک/);
  });

  it('سقف ۳ درخواست کد در ۱۵ دقیقه', async () => {
    db.baseCurrencyConfirmation.count.mockResolvedValue(3);
    await expect(svc.requestConfirmation(ctxOf({ tenantDb: db }), { dto: { toCode: 'IRR' } })).rejects.toThrow(/زیاد/);
  });

  it('ایمپوتنت: کلید تکراری رکورد قبلی را برمی‌گرداند و چیزی اجرا نمی‌شود', async () => {
    const row = { id: 'c1', kind: 'CONVERT', status: 'DONE', fromCode: 'IRT', toCode: 'IRR', fromLabel: 'تومان', toLabel: 'ریال', rateNum: '10', rateDen: '1', roundingMode: 'STRICT', startedAt: new Date(), finishedAt: new Date(), executedByName: 'م', errorMessage: null, reversedById: null, reverseOfId: null, backupFile: null };
    db.baseCurrencyConversion.findUnique.mockResolvedValue(row);
    const r = await svc.execute(ctxOf({ tenantDb: db }), { toCode: 'IRR', idempotencyKey: 'k', confirmPhrase: 'x', otp: '123456' } as never);
    expect(r).toMatchObject({ id: 'c1', replayed: true });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('عبارت اشتباه، پیش از مصرف کد پیامکی رد می‌شود', async () => {
    // پیش‌نمایش داخل start با دیتابیس ساختگی: columns همه موجود → ستون‌های فرضی را از information_schema می‌دهیم
    db.$queryRawUnsafe.mockImplementation(async (q: string) => {
      if (q.includes('information_schema')) {
        const { MONEY_COLUMNS, RATE_COLUMNS, CURRENCY_CODE_COLUMNS } = await import('./money-columns.js');
        const { JSON_MONEY_COLUMNS } = await import('./json-money.js');
        return [...MONEY_COLUMNS, ...RATE_COLUMNS, ...CURRENCY_CODE_COLUMNS, ...JSON_MONEY_COLUMNS].map((c) => ({ table_name: c.table, column_name: c.column }));
      }
      if (q.includes('GROUP BY "entryId" HAVING')) return [{ n: '0' }];
      if (q.includes('accounting_journal_lines') && q.includes('COUNT(DISTINCT')) return [{ d: '0', c: '0', e: '0' }];
      if (q.includes('ORDER BY ABS') || q.includes('AS doc')) return [];
      if (q.includes('"rows"')) {
        const row: Record<string, string> = { rows: '0' };
        for (let i = 0; i < 20; i += 1) Object.assign(row, { [`c${i}n`]: '0', [`c${i}s`]: '0', [`c${i}m`]: '0', [`c${i}l`]: '0' });
        return [row];
      }
      return [{ n: '0', l: '0', m: '0' }];
    });
    await expect(svc.execute(ctxOf({ tenantDb: db }), { toCode: 'IRR', idempotencyKey: 'k2', confirmPhrase: 'نادرست', otp: '123456' } as never)).rejects.toThrow(/عبارت/);
    expect(db.baseCurrencyConfirmation.findFirst).not.toHaveBeenCalled();
  });

  it('در حال اجرا بودن یک عملیات → ۴۰۹', async () => {
    db.baseCurrencyConversion.count.mockResolvedValue(1);
    await expect(svc.execute(ctxOf({ tenantDb: db }), { toCode: 'IRR', idempotencyKey: 'k3', confirmPhrase: 'x', otp: '123456' } as never)).rejects.toThrow(/در حال اجرا/);
  });
});

describe('قفل نوشتن اسناد مالی', () => {
  it('مسیرهای مالی مسدود، خواندن و پیام‌رسان و خود تنظیمات ارز پایه آزاد', () => {
    expect(isBlockedDuringConversion('POST', '/api/sales/invoices')).toBe(true);
    expect(isBlockedDuringConversion('PUT', '/api/accounting/journal-entries/1')).toBe(true);
    expect(isBlockedDuringConversion('POST', '/api/public/store/shop/orders?x=1')).toBe(true);
    expect(isBlockedDuringConversion('POST', '/api/settings/currencies')).toBe(true);
    expect(isBlockedDuringConversion('GET', '/api/sales/invoices')).toBe(false);
    expect(isBlockedDuringConversion('POST', '/api/settings/base-currency/execute')).toBe(false);
    expect(isBlockedDuringConversion('POST', '/api/messenger/messages')).toBe(false);
    expect(isBlockedDuringConversion('POST', '/api/auth/refresh')).toBe(false);
  });

  const exec = (req: Record<string, unknown>) =>
    ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const next = { handle: () => of('ok') } as never;
  const allowed = async (p: Promise<unknown>) => firstValueFrom((await p) as import('rxjs').Observable<string>);

  it('حین تبدیل، نوشتن مالی همان تننت ۴۲۳ می‌گیرد؛ تننت دیگر، GET و اسلاگ ناشناس آزادند؛ پس از آزادسازی دوباره مجاز', async () => {
    writeLock._reset();
    const it = new BaseCurrencyWriteLockInterceptor();
    writeLock.acquire('t1', 'c1', 'shop-a');
    const db = { baseCurrencyConversion: { count: vi.fn().mockResolvedValue(0) } };
    const post = (extra: Record<string, unknown>) => it.intercept(exec({ method: 'POST', originalUrl: '/api/sales/invoices', ...extra }), next);
    await expect(post({ ctx: { tenantId: 't1', tenantDb: db } })).rejects.toMatchObject({ status: 423 });
    await expect(allowed(it.intercept(exec({ method: 'GET', originalUrl: '/api/sales/invoices', ctx: { tenantId: 't1', tenantDb: db } }), next))).resolves.toBe('ok');
    await expect(allowed(post({ ctx: { tenantId: 't2', tenantDb: db } }))).resolves.toBe('ok');
    // عمومی: فقط اسلاگِ قفل‌شده مسدود می‌شود
    const pub = (slug?: string) => it.intercept(exec({ method: 'POST', originalUrl: '/api/public/store/x/orders', params: slug ? { slug } : {} }), next);
    await expect(pub('shop-a')).rejects.toMatchObject({ status: 423 });
    await expect(allowed(pub('shop-b'))).resolves.toBe('ok');
    await expect(allowed(pub(undefined))).resolves.toBe('ok');
    writeLock.release('t1');
    await expect(allowed(post({ ctx: { tenantId: 't1', tenantDb: db } }))).resolves.toBe('ok');
    await expect(allowed(pub('shop-a'))).resolves.toBe('ok');
  });

  it('شمارنده‌ی درخواست‌های در جریان: drain تا پایان آن‌ها صبر می‌کند و در timeout false برمی‌گرداند', async () => {
    writeLock._reset();
    const leave = writeLock.enter('t1');
    expect(writeLock.inflightCount('t1')).toBe(1);
    expect(await writeLock.drain('t1', '', 120, 10)).toBe(false);
    setTimeout(leave, 60);
    expect(await writeLock.drain('t1', '', 1000, 10)).toBe(true);
    expect(writeLock.inflightCount('t1')).toBe(0);
    const leave2 = writeLock.enter(writeLock.slugKey('shop-a'));
    expect(writeLock.inflightCount('t9', 'shop-a')).toBe(1);
    leave2();
    leave2(); // idempotent
    expect(writeLock.inflightCount('t9', 'shop-a')).toBe(0);
  });

  it('درخواست مالی که شروع شده در شمارنده می‌آید و پس از اتمام کم می‌شود', async () => {
    writeLock._reset();
    const it = new BaseCurrencyWriteLockInterceptor();
    const { Subject } = await import('rxjs');
    const subj = new Subject<string>();
    const handle = { handle: () => subj.asObservable() } as never;
    const db = { baseCurrencyConversion: { count: vi.fn().mockResolvedValue(0) } };
    const obs = (await it.intercept(exec({ method: 'POST', originalUrl: '/api/checks', ctx: { tenantId: 'tq', tenantDb: db } }), handle)) as import('rxjs').Observable<string>;
    const sub = obs.subscribe();
    expect(writeLock.inflightCount('tq')).toBe(1);
    subj.next('x');
    subj.complete();
    sub.unsubscribe();
    expect(writeLock.inflightCount('tq')).toBe(0);
  });

  it('ردیف RUNNING با ضربان تازه در دیتابیس (پروسه‌ی دیگر) هم قفل می‌کند', async () => {
    writeLock._reset();
    const it = new BaseCurrencyWriteLockInterceptor();
    const db = { baseCurrencyConversion: { count: vi.fn().mockResolvedValue(1) } };
    await expect(it.intercept(exec({ method: 'POST', originalUrl: '/api/checks', ctx: { tenantId: 'tx', tenantDb: db } }), next)).rejects.toMatchObject({ status: 423 });
  });
});

describe('واحد پایه و درگاه پرداخت', () => {
  it('پیش‌فرض تومان؛ مقدار خراب هم به تومان برمی‌گردد', () => {
    expect(parseBaseCurrency(null)).toBe(DEFAULT_BASE_CURRENCY);
    expect(parseBaseCurrency({ code: 'x', label: '' })).toBe(DEFAULT_BASE_CURRENCY);
    const irr = parseBaseCurrency({ code: 'IRR', label: 'ریال', tomanPerUnitNum: '1', tomanPerUnitDen: '10' });
    expect(irr.label).toBe('ریال');
    expect(parseBaseCurrency(serializeBaseCurrency(irr))).toEqual(irr);
  });
  it('toGatewayToman: ریال ÷۱۰ دقیق؛ نامضرب رد (نه گرد بی‌صدا)؛ تومان بدون تغییر', () => {
    const irr = parseBaseCurrency({ code: 'IRR', label: 'ریال', tomanPerUnitNum: '1', tomanPerUnitDen: '10' });
    expect(toGatewayToman(150_000, DEFAULT_BASE_CURRENCY)).toBe(150_000);
    expect(toGatewayToman(1_500_000, irr)).toBe(150_000);
    expect(() => toGatewayToman(1_500_005, irr)).toThrow(BadRequestException);
    expect(() => toGatewayToman(-1, irr)).toThrow(BadRequestException);
    expect(() => toGatewayToman(1.5, irr)).toThrow(BadRequestException);
  });
});
