import { describe, expect, it } from 'vitest';
import { normalizeJson } from './normalize.js';

describe('normalizeJson — Moodian RC_TICS.IS_V01 §6-2-1', () => {
  it('Table 1 fixture: {k2:v1,k4:v2,k3:{k1:v4,k5:v5}} → v1#v4#v5#v2', () => {
    expect(normalizeJson({ k2: 'v1', k4: 'v2', k3: { k1: 'v4', k5: 'v5' } })).toBe('v1#v4#v5#v2');
  });

  it('escapes "#" inside text as "##"', () => {
    expect(normalizeJson({ a: 'x#y', b: 'z' })).toBe('x##y#z');
  });

  it('null and "" become "#" and, with the separators, read as "###" between two values', () => {
    expect(normalizeJson({ a: 'v1', b: null, c: 'v2' })).toBe('v1###v2');
    expect(normalizeJson({ a: 'v1', b: '', c: 'v2' })).toBe('v1###v2');
    // مقدار آخر null: جداکننده‌ی آخر حذف می‌شود
    expect(normalizeJson({ a: 'v1', b: null })).toBe('v1##');
  });

  it('keeps array order, indexes them in the key, and wraps a root array into {packets}', () => {
    expect(normalizeJson([{ uid: 'b', retry: false }, { uid: 'a', retry: true }])).toBe('false#b#true#a');
    expect(normalizeJson({ list: ['z', 'a'] })).toBe('z#a');
  });

  it('serialises booleans in lower case and numbers the JS way', () => {
    expect(normalizeJson({ f: false, t: true, n: 0.09, z: 0 })).toBe('false#0.09#true#0');
  });

  it('merges headers into the body before sorting', () => {
    expect(normalizeJson({ packets: [] , x: 'b' }, { requestTraceId: 'T', timestamp: 5 })).toBe('T#5#b');
  });

  it('is independent of the key order of the input', () => {
    expect(normalizeJson({ b: 1, a: 2 })).toBe(normalizeJson({ a: 2, b: 1 }));
  });

  it('matches the body segment of the official sample invoice (§6-2-2)', () => {
    const row = {
      sstid: 2153265989636, sstt: 'پاستیل میوه ای شیبابا', mu: 96, am: 1, fee: 1000000, cfee: null, cut: null, exr: null, prdis: 1000000, dis: 0, adis: 1000000,
      vra: 0.09, vam: 90000, odt: null, odr: null, odam: null, olt: null, olr: null, olam: null, consfee: null, spro: null, bros: null, tcpbs: null,
      cop: 90000, vop: 90000, bsrn: null, tsstam: 1090000,
    };
    expect(normalizeJson({ body: [row] })).toBe(
      '1000000#1#########90000###0###1000000#96#############1000000###2153265989636#پاستیل میوه ای شیبابا###1090000#90000#90000#0.09',
    );
  });
});
