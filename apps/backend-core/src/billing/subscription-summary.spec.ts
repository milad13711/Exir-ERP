import { describe, expect, it, vi } from 'vitest';
import { ModuleGuard } from '../common/guards/module.guard.js';
import {
  buildSummary,
  computeModuleEntitlement,
  computeTenantEntitlement,
  isModuleRowUsable,
  pickBanner,
  redactForMember,
  tehranDayIndex,
  tenantAccess,
  timeLeft,
  type InvoiceInput,
  type ModuleEntitlementInput,
  type TenantEntitlementInput,
} from './subscription-summary.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-07T10:00:00Z'); // ۱۷ آبان ۱۴۰۵، ۱۳:۳۰ تهران
const at = (days: number, from = NOW) => new Date(from.getTime() + days * DAY);

const sub = (over: Partial<NonNullable<TenantEntitlementInput['subscription']>> = {}) => ({
  status: 'ACTIVE',
  startedAt: at(-200),
  currentPeriodEnd: at(60),
  lifetime: false,
  autoRenew: true,
  planName: 'حرفه‌ای',
  planCode: 'pro',
  ...over,
});
const tenantIn = (over: Partial<TenantEntitlementInput> = {}): TenantEntitlementInput => ({ tenantStatus: 'ACTIVE', subscription: sub(), planInvoices: [], ...over });
const inv = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({ id: 'inv1', amount: 1000, status: 'PENDING', purpose: 'PLAN_RENEWAL', items: null, dueAt: at(3), paidAt: null, ...over });
const mod = (install: ModuleEntitlementInput['install'], over: Partial<ModuleEntitlementInput> = {}): ModuleEntitlementInput => ({ code: 'crm', name: 'CRM', isCore: false, priceMonthly: 100, install, ...over });
const modInstall = (over: Partial<NonNullable<ModuleEntitlementInput['install']>> = {}) => ({ status: 'INSTALLED', billingMode: 'MONTHLY', currentPeriodEnd: at(30), pendingRenewalInvoiceId: null, ...over });
const modInv = (over: Partial<InvoiceInput> = {}) => inv({ id: 'minv', purpose: 'MODULE_RENEWAL', items: [{ moduleCode: 'crm' }], ...over });

describe('tehran day boundary', () => {
  it('rolls the calendar day at Tehran midnight (20:30Z), not UTC midnight', () => {
    const before = new Date('2026-11-07T20:29:00Z'); // ۲۳:۵۹ تهران
    const after = new Date('2026-11-07T20:31:00Z'); // ۰۰:۰۱ تهران، فردا
    expect(tehranDayIndex(after) - tehranDayIndex(before)).toBe(1);
    const utcMidnightA = new Date('2026-11-07T23:59:00Z');
    const utcMidnightB = new Date('2026-11-08T00:01:00Z');
    expect(tehranDayIndex(utcMidnightB)).toBe(tehranDayIndex(utcMidnightA)); // هر دو ۰۳:۳۰ بامداد تهران همان روز
  });
  it('expires at the exact instant; daysLeft 0 means "ends today"', () => {
    const end = new Date('2026-11-07T20:00:00Z'); // ۲۳:۳۰ تهران همین امروز
    expect(timeLeft(end, NOW)).toMatchObject({ expired: false, daysLeft: 0 });
    expect(timeLeft(end, new Date('2026-11-07T20:00:00Z'))).toMatchObject({ expired: true, daysLeft: 0 });
    expect(timeLeft(end, new Date('2026-11-07T20:15:00Z'))).toMatchObject({ expired: true, daysOverdue: 0 });
    expect(timeLeft(end, new Date('2026-11-07T20:45:00Z')).daysOverdue).toBe(1); // بعد از نیمه‌شب تهران
  });
  it('banner copy never shows a positive day count once expired', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(-0.1) }) }), NOW);
    expect(e.daysLeft).toBeNull();
    expect(e.state).toBe('GRACE');
  });
});

describe('tenant entitlement matrix', () => {
  it('ACTIVE far from expiry: no banner, no action', () => {
    const e = computeTenantEntitlement(tenantIn(), NOW);
    expect(e).toMatchObject({ state: 'ACTIVE', usable: true, nextAction: 'NONE', severity: 'none', daysLeft: 60 });
  });
  it('expiring soon WITH an open invoice -> pay it', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(5) }), planInvoices: [inv()] }), NOW);
    expect(e).toMatchObject({ state: 'EXPIRING_SOON', nextAction: 'PAY_INVOICE', openInvoice: { id: 'inv1' } });
  });
  it('expiring soon WITHOUT an invoice -> offer a renewal request, never "pay"', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(5) }) }), NOW);
    expect(e).toMatchObject({ state: 'EXPIRING_SOON', nextAction: 'REQUEST_INVOICE', openInvoice: null });
  });
  it('invoice awaiting platform approval is not payable and not nagged', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(5) }), planInvoices: [inv({ status: 'AWAITING_APPROVAL' })] }), NOW);
    expect(e).toMatchObject({ nextAction: 'NONE', awaitingApproval: true, openInvoice: null });
  });
  it('severity escalates to danger within 3 days', () => {
    expect(computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(2) }) }), NOW).severity).toBe('danger');
    expect(computeTenantEntitlement(tenantIn({ subscription: sub({ currentPeriodEnd: at(9) }) }), NOW).severity).toBe('warning');
  });
  it('free trial running / trial ended but not yet locked (GRACE, still usable)', () => {
    expect(computeTenantEntitlement(tenantIn({ subscription: sub({ status: 'TRIAL', currentPeriodEnd: at(0.5) }) }), NOW)).toMatchObject({ state: 'TRIAL', usable: true, hoursLeft: 12 });
    expect(computeTenantEntitlement(tenantIn({ subscription: sub({ status: 'TRIAL', currentPeriodEnd: at(-0.2) }) }), NOW)).toMatchObject({ state: 'GRACE', usable: true });
  });
  it('lapsed period on an ACTIVE tenant is GRACE (enforcement lets them in), not EXPIRED', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: sub({ status: 'PAST_DUE', currentPeriodEnd: at(-9) }) }), NOW);
    expect(e).toMatchObject({ state: 'GRACE', usable: true, daysOverdue: 9, nextAction: 'REQUEST_INVOICE' });
  });
  it('PENDING_PAYMENT after trial: EXPIRED, billing-only, points at the unpaid invoice', () => {
    const e = computeTenantEntitlement(tenantIn({ tenantStatus: 'PENDING_PAYMENT', subscription: sub({ status: 'PAST_DUE', currentPeriodEnd: at(-1) }), planInvoices: [inv({ purpose: null })] }), NOW);
    expect(e).toMatchObject({ state: 'EXPIRED', usable: false, billingOnly: true, nextAction: 'PAY_INVOICE' });
  });
  it('PENDING_PAYMENT with no invoice at all -> request one (never a dead end)', () => {
    const e = computeTenantEntitlement(tenantIn({ tenantStatus: 'PENDING_PAYMENT', subscription: sub({ status: 'PAST_DUE', currentPeriodEnd: at(-1) }) }), NOW);
    expect(e).toMatchObject({ billingOnly: true, nextAction: 'REQUEST_INVOICE' });
  });
  it('REGRESSION: paid setup invoice but subscription record stale -> never "expired" for a paying ACTIVE tenant', () => {
    const e = computeTenantEntitlement(
      tenantIn({ subscription: sub({ status: 'PAST_DUE', startedAt: at(-3), currentPeriodEnd: at(-1) }), planInvoices: [inv({ status: 'PAID', purpose: null, paidAt: at(-0.5) })] }),
      NOW,
    );
    expect(e).toMatchObject({ state: 'ACTIVE', usable: true, staleRecord: true, expiresAt: null, severity: 'none' });
  });
  it('paid-but-still-locked legacy tenant routes to support, not a second payment', () => {
    const e = computeTenantEntitlement(
      tenantIn({ tenantStatus: 'PENDING_PAYMENT', subscription: sub({ status: 'PAST_DUE', currentPeriodEnd: at(-1) }), planInvoices: [inv({ status: 'PAID', purpose: null, paidAt: at(-1.5) })] }),
      NOW,
    );
    expect(e).toMatchObject({ billingOnly: true, nextAction: 'CONTACT_SUPPORT', staleRecord: true });
  });
  it('lifetime subscription with a (display-only) past/far date is NO_EXPIRY', () => {
    expect(computeTenantEntitlement(tenantIn({ subscription: sub({ lifetime: true, status: 'PAST_DUE', currentPeriodEnd: at(-30) }) }), NOW)).toMatchObject({ state: 'NO_EXPIRY', usable: true, expiresAt: null });
  });
  it('suspended / cancelled tenant: SUSPENDED regardless of dates', () => {
    expect(computeTenantEntitlement(tenantIn({ tenantStatus: 'SUSPENDED' }), NOW)).toMatchObject({ state: 'SUSPENDED', usable: false, nextAction: 'CONTACT_SUPPORT' });
    expect(computeTenantEntitlement(tenantIn({ tenantStatus: 'CANCELLED' }), NOW).state).toBe('SUSPENDED');
  });
  it('no subscription row', () => {
    expect(computeTenantEntitlement(tenantIn({ subscription: null }), NOW)).toMatchObject({ state: 'NOT_SUBSCRIBED', usable: true });
  });
});

describe('on-premise licence is the authority (cloud subscription row is ignored)', () => {
  const stalePastDue = sub({ status: 'PAST_DUE', currentPeriodEnd: at(-100) });
  it('perpetual licence -> NO_EXPIRY even though the leftover cloud row is expired', () => {
    const e = computeTenantEntitlement(tenantIn({ subscription: stalePastDue, license: { mode: 'on_premise', state: 'valid', daysLeft: null, warningLevel: 0 } }), NOW);
    expect(e).toMatchObject({ source: 'ON_PREMISE_LICENSE', state: 'NO_EXPIRY', usable: true });
  });
  it('valid dated licence -> ACTIVE, or EXPIRING_SOON on warning, with support (not invoice) as the path', () => {
    expect(computeTenantEntitlement(tenantIn({ subscription: stalePastDue, license: { mode: 'on_premise', state: 'valid', daysLeft: 200, warningLevel: 0 } }), NOW).state).toBe('ACTIVE');
    expect(computeTenantEntitlement(tenantIn({ subscription: stalePastDue, license: { mode: 'on_premise', state: 'valid', daysLeft: 12, warningLevel: 1 } }), NOW)).toMatchObject({ state: 'EXPIRING_SOON', nextAction: 'CONTACT_SUPPORT', daysLeft: 12 });
  });
  it('grace (offline or expired token) is usable GRACE; expired/invalid blocks', () => {
    expect(computeTenantEntitlement(tenantIn({ license: { mode: 'on_premise', state: 'grace', daysLeft: 5, reasonCode: 'offline_grace' } }), NOW)).toMatchObject({ state: 'GRACE', usable: true, reason: 'license_offline_grace' });
    expect(computeTenantEntitlement(tenantIn({ license: { mode: 'on_premise', state: 'expired' } }), NOW)).toMatchObject({ state: 'EXPIRED', usable: false });
  });
  it('cloud mode licence object does not change the cloud result', () => {
    expect(computeTenantEntitlement(tenantIn({ license: { mode: 'cloud' } }), NOW).source).toBe('CLOUD_SUBSCRIPTION');
  });
});

describe('module entitlement matrix', () => {
  it('core module without a row: included, usable', () => {
    expect(computeModuleEntitlement(mod(null, { isCore: true }), [], true, NOW)).toMatchObject({ state: 'NO_EXPIRY', usable: true });
  });
  it('paid module never bought: NOT_SUBSCRIBED, not usable, no banner', () => {
    const e = computeModuleEntitlement(mod(null), [], true, NOW);
    expect(e).toMatchObject({ state: 'NOT_SUBSCRIBED', usable: false });
  });
  it('admin-activated module with no billing mode/expiry is NO_EXPIRY, never EXPIRING', () => {
    expect(computeModuleEntitlement(mod(modInstall({ billingMode: null, currentPeriodEnd: null })), [], true, NOW)).toMatchObject({ state: 'NO_EXPIRY', reason: 'granted_without_expiry', usable: true });
  });
  it('licence-lifetime module (period end null) is NO_EXPIRY', () => {
    expect(computeModuleEntitlement(mod(modInstall({ billingMode: 'LICENSE', currentPeriodEnd: null })), [], true, NOW)).toMatchObject({ state: 'NO_EXPIRY', reason: 'license_lifetime' });
  });
  it('monthly module 30 days out: ACTIVE (not flagged)', () => {
    expect(computeModuleEntitlement(mod(modInstall()), [], true, NOW)).toMatchObject({ state: 'ACTIVE', daysLeft: 30, nextAction: 'NONE' });
  });
  it('expiring in window with matching open invoice -> pay; invoice found via items even without pending lock', () => {
    const e = computeModuleEntitlement(mod(modInstall({ currentPeriodEnd: at(4) })), [modInv()], true, NOW);
    expect(e).toMatchObject({ state: 'EXPIRING_SOON', nextAction: 'PAY_INVOICE', openInvoice: { id: 'minv' } });
  });
  it('expiring in window with NO invoice -> request one (the header used to say "pay" here)', () => {
    expect(computeModuleEntitlement(mod(modInstall({ currentPeriodEnd: at(4) })), [], true, NOW)).toMatchObject({ state: 'EXPIRING_SOON', nextAction: 'REQUEST_INVOICE', openInvoice: null });
  });
  it('rejected (FAILED) renewal invoice is not an open invoice -> request a new one', () => {
    const e = computeModuleEntitlement(mod(modInstall({ currentPeriodEnd: at(4), pendingRenewalInvoiceId: 'minv' })), [modInv({ status: 'FAILED' })], true, NOW);
    expect(e).toMatchObject({ openInvoice: null, nextAction: 'REQUEST_INVOICE' });
  });
  it('renewal invoice awaiting approval: no pay link, nothing for the customer to do', () => {
    expect(computeModuleEntitlement(mod(modInstall({ currentPeriodEnd: at(4) })), [modInv({ status: 'AWAITING_APPROVAL' })], true, NOW)).toMatchObject({ awaitingApproval: true, nextAction: 'NONE', openInvoice: null });
  });
  it('period ended but still INSTALLED (cron not run / invoice held): GRACE and usable, matching ModuleGuard', () => {
    expect(computeModuleEntitlement(mod(modInstall({ currentPeriodEnd: at(-1) })), [], true, NOW)).toMatchObject({ state: 'GRACE', usable: true });
  });
  it('period ended and cron disabled it: EXPIRED, not usable', () => {
    expect(computeModuleEntitlement(mod(modInstall({ status: 'DISABLED', currentPeriodEnd: at(-3) })), [], true, NOW)).toMatchObject({ state: 'EXPIRED', usable: false, daysOverdue: 3 });
  });
  it('disabled by the tenant inside a paid period is NOT expiry', () => {
    expect(computeModuleEntitlement(mod(modInstall({ status: 'DISABLED', currentPeriodEnd: at(20) })), [], true, NOW)).toMatchObject({ state: 'NOT_SUBSCRIBED', usable: false });
  });
  it('demo TRIAL module', () => {
    expect(computeModuleEntitlement(mod({ status: 'TRIAL', billingMode: null, currentPeriodEnd: null, pendingRenewalInvoiceId: null }), [], true, NOW)).toMatchObject({ state: 'TRIAL', usable: true });
  });
  it('tenant-level block makes every module unusable (module state itself is unchanged)', () => {
    const e = computeModuleEntitlement(mod(modInstall()), [], false, NOW);
    expect(e).toMatchObject({ state: 'ACTIVE', usable: false });
  });
});

describe('banner selection (single source for the header)', () => {
  const build = (t: Partial<TenantEntitlementInput>, ms: ModuleEntitlementInput[], invs: InvoiceInput[] = []) => buildSummary(tenantIn(t), ms, invs, NOW);
  it('healthy tenant with healthy modules: no banner', () => {
    expect(build({}, [mod(modInstall())]).banner).toBeNull();
  });
  it('licensed lifetime tenant never gets an expired banner even with junk cloud row', () => {
    const s = build({ subscription: sub({ lifetime: true, status: 'PAST_DUE', currentPeriodEnd: at(-500) }) }, []);
    expect(s.banner).toBeNull();
    expect(s.tenant.state).toBe('NO_EXPIRY');
  });
  it('module banner only for real renewal needs; manually-disabled and demo modules are silent', () => {
    const s = build({}, [mod(modInstall({ status: 'DISABLED', currentPeriodEnd: at(3) }), { code: 'a' }), mod({ status: 'TRIAL', billingMode: null, currentPeriodEnd: null, pendingRenewalInvoiceId: null }, { code: 'b' }), mod(null, { code: 'c' })]);
    expect(s.banner).toBeNull();
  });
  it('module expiring with invoice -> banner points to the invoice; extra modules counted', () => {
    const s = build({}, [mod(modInstall({ currentPeriodEnd: at(4) }), { code: 'crm' }), mod(modInstall({ currentPeriodEnd: at(6) }), { code: 'hr', name: 'HR' })], [modInv()]);
    expect(s.banner).toMatchObject({ scope: 'module', state: 'EXPIRING_SOON', moduleCode: 'crm', moreModules: 1, nextAction: 'PAY_INVOICE', invoiceId: 'minv' });
  });
  it('long-expired modules stop nagging the header after 14 days', () => {
    expect(build({}, [mod(modInstall({ status: 'DISABLED', currentPeriodEnd: at(-20) }))]).banner).toBeNull();
    expect(build({}, [mod(modInstall({ status: 'DISABLED', currentPeriodEnd: at(-5) }))]).banner).toMatchObject({ state: 'EXPIRED' });
  });
  it('tenant-level problem outranks module warning; suspended outranks all', () => {
    const grace = build({ subscription: sub({ currentPeriodEnd: at(-2) }) }, [mod(modInstall({ currentPeriodEnd: at(2) }))]);
    expect(grace.banner).toMatchObject({ scope: 'tenant', state: 'GRACE' });
    expect(build({ tenantStatus: 'SUSPENDED' }, []).banner?.state).toBe('SUSPENDED');
  });
  it('pickBanner is pure over its inputs', () => {
    const s = build({ subscription: sub({ status: 'TRIAL', currentPeriodEnd: at(0.4) }) }, []);
    expect(pickBanner(s.tenant, s.modules)).toEqual(s.banner);
    expect(s.banner).toMatchObject({ state: 'TRIAL', nextAction: 'REQUEST_INVOICE' });
  });
});

describe('member (non OWNER/ADMIN) view leaks nothing', () => {
  it('strips dates, plan, invoices, amounts; keeps a neutral tenant-level warning only', () => {
    const full = buildSummary(tenantIn({ subscription: sub({ currentPeriodEnd: at(-3) }), planInvoices: [inv()] }), [mod(modInstall({ currentPeriodEnd: at(3) }))], [modInv()], NOW);
    const m = redactForMember(full);
    expect(m.viewer).toBe('MEMBER');
    expect(JSON.stringify(m)).not.toMatch(/inv1|minv|حرفه‌ای|"pro"|1000/);
    expect(m.tenant).toMatchObject({ expiresAt: null, openInvoice: null, planName: null, nextAction: 'NONE' });
    expect(m.openInvoices).toEqual([]);
    expect(m.banner).toMatchObject({ scope: 'tenant', state: 'GRACE', invoiceId: null, nextAction: 'NONE' });
  });
  it('member never sees module-level expiry banners', () => {
    const full = buildSummary(tenantIn(), [mod(modInstall({ currentPeriodEnd: at(3) }))], [], NOW);
    expect(full.banner?.scope).toBe('module');
    expect(redactForMember(full).banner).toBeNull();
  });
});

describe('enforcement and display agree on "usable"', () => {
  it('tenant: tenantAccess() mirrors the summary for every Tenant.status', () => {
    for (const status of ['PENDING_PROVISION', 'PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELLED']) {
      const e = computeTenantEntitlement(tenantIn({ tenantStatus: status }), NOW);
      expect(e.usable).toBe(tenantAccess(status) === 'FULL');
      expect(e.billingOnly).toBe(tenantAccess(status) === 'BILLING_ONLY');
    }
  });

  it('module: ModuleGuard verdict === summary.usable for every install state / date combination', async () => {
    const statuses = [null, 'INSTALLED', 'TRIAL', 'DISABLED'] as const;
    const modes = [null, 'MONTHLY', 'YEARLY', 'LICENSE'] as const;
    const ends = [null, at(-10), at(2), at(40)];
    for (const isCore of [true, false]) {
      for (const status of statuses) {
        for (const billingMode of modes) {
          for (const currentPeriodEnd of ends) {
            const install = status ? { status, billingMode, currentPeriodEnd, pendingRenewalInvoiceId: null } : null;
            const summary = computeModuleEntitlement(mod(install, { isCore }), [], true, NOW);
            const controlDb = {
              moduleDefinition: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', code: 'crm', name: 'CRM', isCore, dependsOn: [] }]) },
              tenantModule: { findMany: vi.fn().mockResolvedValue(install ? [{ id: 'r1', moduleId: 'm1', status }] : []) },
            };
            const guard = new ModuleGuard({} as never, controlDb as never);
            const reason = await guard.moduleUnavailableReason('t1', 'crm');
            expect({ combo: [isCore, status, billingMode, String(currentPeriodEnd)], usable: reason === null }).toEqual({ combo: [isCore, status, billingMode, String(currentPeriodEnd)], usable: summary.usable });
            expect(isModuleRowUsable(install, isCore)).toBe(summary.usable);
          }
        }
      }
    }
  });

  it('a licensed (ACTIVE-tenant) customer is never shown EXPIRED while enforcement lets them in', () => {
    const combos: TenantEntitlementInput[] = [
      tenantIn({ subscription: sub({ status: 'PAST_DUE', currentPeriodEnd: at(-40) }) }),
      tenantIn({ subscription: sub({ status: 'TRIAL', currentPeriodEnd: at(-1) }) }),
      tenantIn({ subscription: sub({ lifetime: true, currentPeriodEnd: at(-1) }) }),
      tenantIn({ subscription: null }),
    ];
    for (const c of combos) {
      const e = computeTenantEntitlement(c, NOW);
      if (tenantAccess(c.tenantStatus) === 'FULL') {
        expect(e.usable).toBe(true);
        expect(e.state).not.toBe('EXPIRED');
      }
    }
  });
});
