import { describe, expect, it } from 'vitest';
import { CONFIDENTIALITIES } from './correspondence.constants.js';
import { canSeeLetter, letterVisibilityWhere, mineWhere, notificationText, type ScopeActor } from './letter-scope.js';
import { combineWhere } from './letter-search.js';

const actor = (over: Partial<ScopeActor>): ScopeActor => ({ userId: 'u1', isOwner: false, isAdmin: false, viewAll: false, viewOwn: false, ...over });
const base = { createdByUserId: 'creator', ownerUserId: 'creator', signerUserId: null, status: 'ISSUED' };

describe('letterVisibilityWhere', () => {
  it('OWNER sees everything', () => expect(letterVisibilityWhere(actor({ isOwner: true }))).toEqual({}));
  it('no matrix access → null', () => expect(letterVisibilityWhere(actor({}))).toBeNull());
  it('viewOwn → only my letters', () => expect(letterVisibilityWhere(actor({ viewOwn: true }))).toEqual(mineWhere('u1')));
  it('viewOwn without a tenant userId (API key) → nothing', () => expect(letterVisibilityWhere(actor({ viewOwn: true, userId: null }))).toBeNull());
  it('viewAll sees NORMAL non-draft or mine', () => {
    const w = letterVisibilityWhere(actor({ viewAll: true })) as { OR: unknown[] };
    expect(w.OR).toHaveLength(2);
    expect(JSON.stringify(w)).toContain('"confidentiality":"NORMAL"');
    expect(JSON.stringify(w)).toContain('"status":{"not":"DRAFT"}');
  });
  it('ADMIN excludes SECRET and foreign drafts', () => {
    const s = JSON.stringify(letterVisibilityWhere(actor({ isAdmin: true })));
    expect(s).toContain('"confidentiality":{"not":"SECRET"}');
    expect(s).toContain('"status":{"not":"DRAFT"}');
  });
  it('user filters cannot escape the scope (scope is AND-ed)', () => {
    const scope = letterVisibilityWhere(actor({ viewOwn: true }))!;
    const w = combineWhere(scope, { OR: [{ confidentiality: 'SECRET' }] });
    expect(w).toEqual({ AND: [scope, { OR: [{ confidentiality: 'SECRET' }] }] });
    expect(combineWhere({}, {})).toEqual({});
  });
});

describe('canSeeLetter matrix (each confidentiality level)', () => {
  const cases: Array<[string, Partial<ScopeActor>, boolean[]]> = [
    // NORMAL, CONFIDENTIAL, VERY_CONFIDENTIAL, SECRET — غیرمشارکت‌کننده
    ['owner', { isOwner: true }, [true, true, true, true]],
    ['admin', { isAdmin: true }, [true, true, true, false]],
    ['viewAll', { viewAll: true }, [true, false, false, false]],
    ['viewOwn', { viewOwn: true }, [false, false, false, false]],
    ['none', {}, [false, false, false, false]],
  ];
  for (const [name, a, expected] of cases) {
    it(`non-participant ${name}`, () => {
      CONFIDENTIALITIES.forEach((c, i) => expect(canSeeLetter(actor(a), { ...base, confidentiality: c }, []), `${name}/${c}`).toBe(expected[i]));
    });
  }
  it('participants (any role) see every level when they have at least view-own', () => {
    for (const c of CONFIDENTIALITIES) {
      expect(canSeeLetter(actor({ viewOwn: true }), { ...base, confidentiality: c }, ['u1'])).toBe(true);
      expect(canSeeLetter(actor({ viewOwn: true }), { ...base, confidentiality: c, signerUserId: 'u1' }, [])).toBe(true);
      expect(canSeeLetter(actor({ viewOwn: true }), { ...base, confidentiality: c, ownerUserId: 'u1' }, [])).toBe(true);
    }
  });
  it('a participant with NO module permission still cannot see it', () => {
    expect(canSeeLetter(actor({}), { ...base, confidentiality: 'NORMAL' }, ['u1'])).toBe(false);
  });
  it('foreign drafts are hidden from admin/viewAll but not from the creator', () => {
    const d = { ...base, status: 'DRAFT', confidentiality: 'NORMAL' };
    expect(canSeeLetter(actor({ isAdmin: true }), d, [])).toBe(false);
    expect(canSeeLetter(actor({ viewAll: true }), d, [])).toBe(false);
    expect(canSeeLetter(actor({ viewOwn: true, userId: 'creator' }), d, [])).toBe(true);
    expect(canSeeLetter(actor({ isOwner: true }), d, [])).toBe(true);
  });
  it('manager hierarchy gives no automatic visibility into subordinates letters (documented default)', () => {
    expect(canSeeLetter(actor({ viewOwn: true, userId: 'manager' }), { ...base, confidentiality: 'NORMAL' }, [])).toBe(false);
  });
});

describe('notificationText', () => {
  const l = { subject: 'قرارداد محرمانه با شرکت X', letterNumber: 'ص/1405/00007' };
  it('never leaks subject/number for confidential letters', () => {
    for (const c of ['CONFIDENTIAL', 'VERY_CONFIDENTIAL', 'SECRET']) {
      const t = notificationText('ارجاع', { ...l, confidentiality: c });
      expect(JSON.stringify(t)).not.toContain('قرارداد');
      expect(JSON.stringify(t)).not.toContain('00007');
    }
  });
  it('includes subject and number for NORMAL letters', () => {
    const t = notificationText('ارجاع', { ...l, confidentiality: 'NORMAL' });
    expect(t.body).toContain('قرارداد');
    expect(t.body).toContain('00007');
  });
});
