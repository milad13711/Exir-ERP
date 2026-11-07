import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * گارد «هیچ مسیر تغییردهنده‌ای بدون کنترل دسترسی نیست».
 *
 * اسکنر ایستا (scripts/route-guard-scan.mjs) همه‌ی کنترلرها را می‌خواند و برای هر مسیر POST/PUT/PATCH/DELETE
 * بررسی می‌کند که خودِ متد یا سرویس‌هایی که صدا می‌زند (تا عمق ۳) یک کنترل دسترسی داشته باشد
 * (PermissionsService.assert* / getEffective / viewScope، گارد نقش مدیر، دامنه‌ی دید رکورد، مالکیت و ...).
 * هر مسیر جدیدِ بدون هیچ کنترلی تست را می‌شکند — یا کنترل اضافه کنید، یا (فقط برای مسیرهای خودخدمت
 * شخصی) با دلیل به فهرست استثنا اضافه کنید.
 */
const SCANNER = pathToFileURL(resolve(__dirname, '../../scripts/route-guard-scan.mjs')).href;

type Route = {
  file: string; prefix: string; verb: string; path: string; auth: boolean; guarded: boolean;
  modules: string[]; actions: string[];
};

/** مسیرهای تغییردهنده‌ی بدون کنترل ماژول، با دلیل. کلید: «فایل VERB prefix/path». */
const MUTATING_EXCEPTIONS: Record<string, string> = {
  'auth/auth.controller.ts Post auth/otp/request': 'ورود (قبل از احراز هویت)',
  'auth/auth.controller.ts Post auth/otp/verify': 'ورود (قبل از احراز هویت)',
  'auth/auth.controller.ts Post auth/otp/select-tenant': 'ورود (انتخاب شرکت)',
  'confidential-archive/confidential-archive.controller.ts Post confidential-archive/documents': 'ثبت سند شخصی در گاو‌صندوق؛ خواندن/ویرایش/حذف پشت VaultTicketGuard و مالکیت',
  'confidential-archive/confidential-archive.controller.ts Post confidential-archive/otp/request': 'OTP روی شماره‌ی خود کاربر',
  'onboarding/onboarding.controller.ts Post onboarding/dismiss': 'ترجیح شخصی کاربر',
  'support/support.controller.ts Post support/tickets/': 'تیکت پشتیبانی خودخدمت (فقط داده‌ی خود کاربر)',
};

describe('controller route permission coverage', async () => {
  const { scan } = (await import(/* @vite-ignore */ SCANNER)) as { scan: () => Route[] };
  const routes = scan();
  const key = (r: Route) => `${r.file} ${r.verb} ${r.prefix}/${r.path}`;
  const mutating = routes.filter((r) => r.verb !== 'Get');

  it('finds a realistic number of routes (sanity)', () => {
    expect(routes.length).toBeGreaterThan(1000);
    expect(mutating.filter((r) => r.verb === 'Delete').length).toBeGreaterThan(50);
  });

  it('every authenticated mutating route has a permission/ownership/role guard', () => {
    const missing = mutating.filter((r) => r.auth && !r.guarded && !(key(r) in MUTATING_EXCEPTIONS)).map(key);
    expect(missing).toEqual([]);
  });

  it('the exception list has no stale entries', () => {
    const live = new Set(mutating.filter((r) => r.auth && !r.guarded).map(key));
    const stale = Object.keys(MUTATING_EXCEPTIONS).filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });

  it('module-gated DELETE routes check canDelete (or are an edit of the parent record)', () => {
    // DELETE روی «زیرمنبع» (پیوست، یادداشت، شاهد، لینک...) با canEdit والد مجاز است؛ DELETE روی خود رکورد باید canDelete بخواهد.
    const bad = mutating
      .filter((r) => r.verb === 'Delete' && r.modules.length > 0 && !r.actions.includes('Delete') && !r.actions.includes('Edit'))
      .map(key);
    expect(bad).toEqual([]);
  });

  it('root POST of a module-gated controller requires canCreate', () => {
    const REVIEWED: Record<string, string> = {
      'correspondence/letterhead.controller.ts': 'تنظیمات سربرگ = ویرایش ماژول',
      'correspondence/templates.controller.ts': 'تنظیمات قالب = ویرایش ماژول',
      'hr/attendance.controller.ts': 'ثبت حضور = ویرایش ماژول HR (ثبت دستی)',
    };
    const bad = mutating
      .filter((r) => r.verb === 'Post' && r.path === '' && r.modules.length > 0 && !r.actions.includes('Create') && !(r.file in REVIEWED))
      .map(key);
    expect(bad).toEqual([]);
  });
});
