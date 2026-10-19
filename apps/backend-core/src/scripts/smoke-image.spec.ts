import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFiles, checkSeedImports, relativeSpecifiers } from './smoke-image.js';

let root: string;
const put = (rel: string, body = '') => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const SEED = `const D = '../../dist/modules-catalog/x.js';\nconst S = '../../src/modules-catalog/x.js';\nimport('../../generated/control-client/index.js');`;

beforeEach(() => void (root = mkdtempSync(join(tmpdir(), 'smoke-'))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('smoke-image', () => {
  it('extracts relative specifiers only', () => {
    expect(relativeSpecifiers(`import a from 'bcryptjs'; import('./a.js'); const x = "../b/c.js";`).sort()).toEqual(['./a.js', '../b/c.js'].sort());
  });
  it('seed passes when dist twin exists even though src is absent (the 2026-10-19 layout)', () => {
    put('prisma/control/seed.ts', SEED);
    put('dist/modules-catalog/x.js');
    put('generated/control-client/index.js');
    expect(checkSeedImports(root)).toMatchObject({ ok: true });
  });
  it('seed fails when only src exists / neither exists', () => {
    put('prisma/control/seed.ts', SEED);
    put('generated/control-client/index.js');
    put('src/modules-catalog/x.js');
    const r = checkSeedImports(root);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('dist/modules-catalog');
  });
  it('seed fails when a hard (non-fallback) import is missing', () => {
    put('prisma/control/seed.ts', `import('../../generated/control-client/index.js');`);
    expect(checkSeedImports(root).ok).toBe(false);
  });
  it('flags missing required files', () => {
    const bad = checkFiles(root).filter((r) => !r.ok);
    expect(bad.map((b) => b.name)).toContain('file:dist/main.js');
  });
});
