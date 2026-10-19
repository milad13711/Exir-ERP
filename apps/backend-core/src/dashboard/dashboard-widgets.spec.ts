import { describe, expect, it } from 'vitest';
import {
  WIDGET_REGISTRY,
  availableWidgets,
  effectiveCompanyItems,
  parseStoredCompanyLayout,
  permits,
  resolveLayout,
  validateCompanyLayoutInput,
  validateUserLayoutInput,
  type AclLike,
  type CompanyLayout,
  type UserLayout,
} from './dashboard-widgets.js';

const ALL_MODULES = new Set(WIDGET_REGISTRY.map((d) => d.moduleCode).filter((c): c is string => !!c));
const manager: AclLike = { manager: true, modules: {} };
const m = (canViewAll: boolean, canViewOwn = false) => ({ canViewAll, canViewOwn });
const keys = (l: { key: string }[]) => l.map((x) => x.key);

describe('registry integrity', () => {
  it('has unique keys, valid defaults and unique orders', () => {
    expect(new Set(WIDGET_REGISTRY.map((d) => d.key)).size).toBe(WIDGET_REGISTRY.length);
    expect(new Set(WIDGET_REGISTRY.map((d) => d.order)).size).toBe(WIDGET_REGISTRY.length);
    for (const d of WIDGET_REGISTRY) {
      expect(d.sizes).toContain(d.defaultSize);
      expect(d.variants).toContain(d.defaultVariant);
    }
  });
});

describe('availableWidgets (module + permission filtering)', () => {
  it('manager sees every widget of installed modules; core widgets always', () => {
    expect(keys(availableWidgets(ALL_MODULES, manager))).toHaveLength(WIDGET_REGISTRY.length);
    const onlyCore = keys(availableWidgets(new Set(), manager));
    expect(onlyCore).toEqual(expect.arrayContaining(['calendar', 'approvals', 'recent-activity']));
    expect(onlyCore).not.toContain('kpi-cash');
  });

  it('hides widgets of modules that are not installed', () => {
    const k = keys(availableWidgets(new Set(['sales']), manager));
    expect(k).toContain('sales-trend');
    expect(k).not.toContain('projects-progress');
    expect(k).not.toContain('kpi-low-stock');
  });

  it('own-only user does not get company-wide summary widgets but gets own-scoped ones', () => {
    const acl: AclLike = { manager: false, modules: { sales: m(false, true), tasks: m(false, true), accounting: m(false, true) } };
    const k = keys(availableWidgets(ALL_MODULES, acl));
    expect(k).toContain('tasks');
    expect(k).not.toContain('kpi-month-invoices');
    expect(k).not.toContain('due-invoices');
    expect(k).not.toContain('kpi-cash');
    expect(k).toContain('calendar');
  });

  it('view-all grants summary widgets; multi-module perms accept either module', () => {
    const acl: AclLike = { manager: false, modules: { crm: m(true) } };
    const k = keys(availableWidgets(ALL_MODULES, acl));
    // customer-followups needs sales OR crm (viewAll) but module "sales" must be installed
    expect(k).toContain('customer-followups');
    expect(k).not.toContain('kpi-overdue');
  });

  it('user with no module access sees only no-permission widgets', () => {
    const k = keys(availableWidgets(ALL_MODULES, { manager: false, modules: {} }));
    expect(k.sort()).toEqual(['approvals', 'calendar', 'messenger-unread', 'recent-activity']);
  });

  it('permits(): null perm is open, missing module denies', () => {
    expect(permits(null, { manager: false, modules: {} })).toBe(true);
    expect(permits({ modules: ['x'], level: 'any' }, { manager: false, modules: {} })).toBe(false);
  });
});

describe('layout validation', () => {
  it('accepts a valid company layout and fills defaults', () => {
    const l = validateCompanyLayoutInput({ items: [{ key: 'tasks', enabled: false }, { key: 'kpi-cash', enabled: true, size: 'M', variant: 'compact' }] });
    expect(l.items[0]).toMatchObject({ key: 'tasks', enabled: false, size: 'M', variant: 'list' });
    expect(l.items[1]).toMatchObject({ size: 'M', variant: 'compact' });
  });

  it.each([
    [{}],
    [{ items: 'x' }],
    [{ items: [{ key: 'nope', enabled: true }] }],
    [{ items: [{ key: 'tasks', enabled: true }, { key: 'tasks', enabled: true }] }],
    [{ items: [{ key: 'tasks', enabled: 'yes' }] }],
    [{ items: [{ key: 'kpi-cash', enabled: true, size: 'FULL' }] }],
    [{ items: [{ key: 'kpi-cash', enabled: true, variant: 'chart' }] }],
    [{ items: [null] }],
  ])('rejects invalid company layout %j', (raw) => {
    expect(() => validateCompanyLayoutInput(raw)).toThrow();
  });

  it('rejects invalid user layouts', () => {
    expect(() => validateUserLayoutInput({ items: [{ key: 'zzz', hidden: true }] })).toThrow();
    expect(() => validateUserLayoutInput({ items: [{ key: 'tasks' }] })).toThrow();
    expect(validateUserLayoutInput({ items: [{ key: 'tasks', hidden: true }] }).items).toHaveLength(1);
  });

  it('stored layout parsing drops stale keys and repairs stale sizes', () => {
    const l = parseStoredCompanyLayout({ items: [{ key: 'gone', enabled: true }, { key: 'kpi-cash', enabled: true, size: 'FULL', variant: 'x' }, 7] })!;
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ size: 'S', variant: 'card' });
    expect(parseStoredCompanyLayout('garbage')).toBeNull();
  });
});

describe('resolveLayout (company + user merge)', () => {
  const acl: AclLike = { manager: false, modules: { tasks: m(true), sales: m(true), accounting: m(true) } };
  const allowed = availableWidgets(ALL_MODULES, acl);

  it('defaults follow registry order and defaultEnabled', () => {
    const r = resolveLayout(allowed, null, null);
    expect(keys(r)).not.toContain('messenger-unread'); // defaultEnabled=false
    const orders = keys(r).map((k) => WIDGET_REGISTRY.find((d) => d.key === k)!.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('company disable/reorder/size/variant apply; new widgets append in default order', () => {
    const company: CompanyLayout = {
      version: 1,
      items: [
        { key: 'tasks', enabled: true, size: 'FULL', variant: 'compact' },
        { key: 'calendar', enabled: false, size: 'FULL', variant: 'default' },
      ],
    };
    const r = resolveLayout(allowed, company, null);
    expect(r[0]).toEqual({ key: 'tasks', size: 'FULL', variant: 'compact' });
    expect(keys(r)).not.toContain('calendar');
    expect(keys(r)).toContain('kpi-cash'); // not mentioned => default enabled
  });

  it('user can hide and reorder but never add widgets disabled by company or not permitted', () => {
    const company: CompanyLayout = { version: 1, items: [{ key: 'tasks', enabled: true, size: 'M', variant: 'list' }, { key: 'calendar', enabled: false, size: 'FULL', variant: 'default' }, { key: 'approvals', enabled: true, size: 'FULL', variant: 'list' }] };
    const user: UserLayout = {
      version: 1,
      items: [
        { key: 'approvals', hidden: false },
        { key: 'calendar', hidden: false }, // company disabled -> must stay hidden
        { key: 'projects-progress', hidden: false }, // not permitted / not allowed -> must not appear
        { key: 'tasks', hidden: true },
      ],
    };
    const r = keys(resolveLayout(allowed, company, user));
    expect(r[0]).toBe('approvals');
    expect(r).not.toContain('calendar');
    expect(r).not.toContain('projects-progress');
    expect(r).not.toContain('tasks');
  });

  it('widgets absent from the user layout keep company order after the user-ordered ones', () => {
    const user: UserLayout = { version: 1, items: [{ key: 'recent-activity', hidden: false }] };
    const r = keys(resolveLayout(allowed, null, user));
    expect(r[0]).toBe('recent-activity');
    expect(r).toHaveLength(keys(resolveLayout(allowed, null, null)).length);
  });

  it('effectiveCompanyItems keeps size/variant of the company entry', () => {
    const items = effectiveCompanyItems({ version: 1, items: [{ key: 'tasks', enabled: false, size: 'L', variant: 'compact' }] }, allowed);
    expect(items[0]).toEqual({ key: 'tasks', enabled: false, size: 'L', variant: 'compact' });
  });
});
