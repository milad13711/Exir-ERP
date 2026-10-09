import { describe, expect, it } from 'vitest';
import { pickRotatingTenants, staleVerifications, type RestoreCandidate } from './restore-schedule.js';

const NOW = Date.UTC(2026, 9, 9);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const mk = (n: number, verifiedDaysAgo?: (i: number) => number | undefined): RestoreCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ slug: `t${String(i).padStart(2, '0')}`, verifiedAt: verifiedDaysAgo?.(i) === undefined ? undefined : daysAgo(verifiedDaysAgo(i)!), sinceIso: daysAgo(100) }));

describe('pickRotatingTenants', () => {
  it('covers every tenant within 4 weekly runs (never-verified first), excluding already-tested', () => {
    let cands = mk(10);
    const seen = new Set<string>();
    for (let week = 0; week < 4; week++) {
      const now = NOW + week * 7 * 86_400_000;
      const picked = pickRotatingTenants(cands, now);
      expect(picked.length).toBeLessThanOrEqual(3); // ceil(10/4)
      expect(picked.length).toBeGreaterThan(0);
      picked.forEach((s) => seen.add(s));
      cands = cands.map((c) => (picked.includes(c.slug) ? { ...c, verifiedAt: new Date(now).toISOString() } : c));
    }
    expect(seen.size).toBe(10);
  });
  it('skips tenants verified recently and excluded ones', () => {
    const cands = mk(4, (i) => (i === 0 ? 1 : undefined));
    const picked = pickRotatingTenants(cands, NOW, new Set(['t01']));
    expect(picked).not.toContain('t00');
    expect(picked).not.toContain('t01');
  });
  it('picks the oldest verification first', () => {
    const cands = mk(2, (i) => (i === 0 ? 30 : 60));
    expect(pickRotatingTenants(cands, NOW, new Set(), { maxPerRun: 1 })).toEqual(['t01']);
  });
  it('returns nothing when everything is fresh', () => {
    expect(pickRotatingTenants(mk(5, () => 3), NOW)).toEqual([]);
  });
});

describe('staleVerifications (>35 days)', () => {
  it('flags old and never-verified-since-creation, not young tenants', () => {
    const c: RestoreCandidate[] = [
      { slug: 'fresh', verifiedAt: daysAgo(10), sinceIso: daysAgo(200) },
      { slug: 'old', verifiedAt: daysAgo(40), sinceIso: daysAgo(200) },
      { slug: 'never', sinceIso: daysAgo(50) },
      { slug: 'new', sinceIso: daysAgo(5) },
    ];
    const r = staleVerifications(c, NOW);
    expect(r.map((x) => x.slug).sort()).toEqual(['never', 'old']);
    expect(r.find((x) => x.slug === 'never')!.neverVerified).toBe(true);
  });
});
