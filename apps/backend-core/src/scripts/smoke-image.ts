/**
 * PRE-DEPLOY IMAGE SMOKE TEST — runs INSIDE the freshly built runtime image, in a throwaway container, before the
 * live container is touched (scripts/deploy-remote.sh):
 *   docker compose run --rm --no-deps --entrypoint node backend dist/scripts/smoke-image.js
 *
 * It never connects to a database. It exists because on 2026-10-19 the control seed imported a file from src/ (absent in the
 * runtime image: only dist/ + prisma/ ship) and crash-looped production; build and DI tests passed because they run on a full checkout.
 *
 * Checks (cheap but strong): required runtime files exist; every relative import of prisma/control/seed.ts resolves
 * INSIDE this image (a src/ path is accepted only if its dist/ twin exists = the seed's dynamic-import fallback); the seed's
 * dist-side dependency actually imports; generated prisma clients load; tsx/prisma CLIs the entrypoint uses are present;
 * and the whole AppModule graph imports (catches ERR_MODULE_NOT_FOUND anywhere in dist) without bootstrapping Nest.
 *
 * Exit 0 = all pass, 1 = any failure (each failing check printed as `FAIL <name>: <detail>`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SmokeResult = { name: string; ok: boolean; detail: string };

const REQUIRED_FILES = [
  'dist/main.js',
  'dist/app.module.js',
  'dist/scripts/migrate-all-tenants.js',
  'dist/scripts/bootstrap-on-premise.js',
  'dist/modules-catalog/module-license-usd.js',
  'prisma/control/schema.prisma',
  'prisma/control/seed.ts',
  'prisma/tenant/schema.prisma',
  'generated/control-client/index.js',
  'generated/tenant-client/index.js',
  'docker-entrypoint.sh',
  'package.json',
  'node_modules/.bin/tsx',
  'node_modules/.bin/prisma',
];
const REQUIRED_DIRS = ['prisma/control/migrations', 'prisma/tenant/migrations'];

/** Relative module specifiers ('./x', '../y') appearing in quotes in a source file (static imports, import(), path constants). */
export function relativeSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/['"`](\.{1,2}\/[^'"`\s]+)['"`]/g)) out.add(m[1]);
  return [...out];
}

/** A specifier resolves if the file exists, or (ESM TS convention) its .js is backed by a .ts sibling. */
export function resolvesInImage(fromDir: string, spec: string): boolean {
  const abs = resolve(fromDir, spec);
  return existsSync(abs) || (abs.endsWith('.js') && existsSync(abs.slice(0, -3) + '.ts'));
}

export function checkSeedImports(root: string): SmokeResult {
  const seed = join(root, 'prisma/control/seed.ts');
  if (!existsSync(seed)) return { name: 'seed-imports', ok: false, detail: 'prisma/control/seed.ts missing' };
  const dir = dirname(seed);
  const missing: string[] = [];
  const specs = relativeSpecifiers(readFileSync(seed, 'utf8'));
  for (const spec of specs) {
    if (resolvesInImage(dir, spec)) continue;
    // Documented fallback pair: '<...>/src/X' is only a dev fallback — fine iff the '<...>/dist/X' twin ships in the image.
    const twin = spec.includes('/src/') ? spec.replace('/src/', '/dist/') : null;
    if (twin && resolvesInImage(dir, twin)) continue;
    missing.push(spec);
  }
  return missing.length
    ? { name: 'seed-imports', ok: false, detail: `unresolvable in image: ${missing.join(', ')}` }
    : { name: 'seed-imports', ok: true, detail: `${specs.length} relative specifier(s) resolve` };
}

export function checkFiles(root: string): SmokeResult[] {
  const res: SmokeResult[] = [];
  for (const f of REQUIRED_FILES) res.push({ name: `file:${f}`, ok: existsSync(join(root, f)), detail: existsSync(join(root, f)) ? 'present' : 'MISSING' });
  for (const d of REQUIRED_DIRS) {
    const ok = existsSync(join(root, d)) && statSync(join(root, d)).isDirectory();
    res.push({ name: `dir:${d}`, ok, detail: ok ? 'present' : 'MISSING' });
  }
  return res;
}

async function tryImport(name: string, path: string): Promise<SmokeResult> {
  try {
    await import(pathToFileURL(path).href);
    return { name, ok: true, detail: 'imported' };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { name, ok: false, detail: `${err.code ?? 'ERROR'}: ${(err.message ?? String(e)).split('\n')[0].slice(0, 300)}` };
  }
}

export async function runSmoke(root: string): Promise<SmokeResult[]> {
  const results = [...checkFiles(root), checkSeedImports(root)];
  // Harmless dummies ONLY when unset (compose run passes the real env). Nothing here opens a DB connection.
  process.env.JWT_SECRET ||= 'smoke-image-check-'.padEnd(40, 'x');
  process.env.CONTROL_DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/none';
  results.push(await tryImport('import:seed-dist-dependency', join(root, 'dist/modules-catalog/module-license-usd.js')));
  results.push(await tryImport('import:generated/control-client', join(root, 'generated/control-client/index.js')));
  results.push(await tryImport('import:generated/tenant-client', join(root, 'generated/tenant-client/index.js')));
  results.push(await tryImport('import:AppModule-graph', join(root, 'dist/app.module.js')));
  return results;
}

async function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const results = await runSmoke(root);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`[smoke-image] FAILED ${failed.length}/${results.length}: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`[smoke-image] PASS ${results.length}/${results.length}`);
  // Importing the app graph can leave handles (timers/clients) open - exit explicitly.
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[smoke-image] crashed:', e);
    process.exit(1);
  });
}
