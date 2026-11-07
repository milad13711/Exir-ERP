// Static scanner: enumerates every NestJS controller route and decides whether it is permission-guarded
// (directly in the controller, or transitively in the services it calls, depth <= 3).
// Used by src/permissions/route-guard.spec.ts and by `node scripts/route-guard-scan.mjs [--md]` (feeds docs/crud-audit.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(here, '../src');

const GUARD_RE =
  /permissions?\.(?:assert\w+|getEffective|viewScope|effectiveMatrix)\(|\.getEffective\(|\bassert(?:View|ViewAll|Create|Edit|Delete|Manager|Access|Admin|CanManage|CanUse)\w*\(|\.requireAccess\(|requireManager\(|assertManager\(|\b(?:assert|require)\w*(?:InScope|Visible|Access|Owner|Participant|Member|Manager)\w*\(|\bfindVisible\(|isManager\(|role === 'OWNER'|role !== 'OWNER'|\['OWNER', 'ADMIN'\]|runOrRequest\(|resolveTenantUserId\(|ctx\.auth\.(?:role|userId)|\.actor\(|\b\w+Scope\(|\bcan(?:View|Edit|Delete|Create)\w*\(/;
const CLASS_GUARD_RE = /@Roles\(|RolesGuard|AdminJwtAuthGuard|PlatformOwnerGuard|SuperAdminGuard|AdminTeamsGuard|ApiKeyGuard|@Public\(|@SkipAuth|@HumanOnly/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function methodBodies(src) {
  // crude: map methodName -> body text (from its declaration to next method declaration at 2-space indent)
  const map = new Map();
  const re = /^ {2}(?:public |private |protected |async |static |readonly )*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\(/gm;
  const hits = [];
  let m;
  while ((m = re.exec(src))) if (!['constructor', 'if', 'for', 'while', 'switch', 'return'].includes(m[1])) hits.push({ name: m[1], i: m.index });
  hits.forEach((h, k) => {
    const body = src.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : src.length);
    map.set(h.name, (map.get(h.name) ?? '') + '\n' + body);
  });
  return map;
}

export function scan() {
  const all = walk(SRC);
  const classIndex = new Map(); // className -> {file, methods, src}
  for (const f of all) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/export (?:abstract )?class (\w+)/g)) {
      classIndex.set(m[1], { file: f, src, methods: methodBodies(src) });
    }
  }
  const guardCache = new Map();
  function methodGuarded(cls, method, depth, seen) {
    const key = `${cls}.${method}`;
    if (guardCache.has(key)) return guardCache.get(key);
    if (depth < 0 || seen.has(key)) return false;
    seen.add(key);
    const info = classIndex.get(cls);
    const body = info?.methods.get(method);
    if (!body) return false;
    let ok = GUARD_RE.test(body);
    if (!ok) {
      const props = ctorProps(info.src);
      for (const c of body.matchAll(/this\.(\w+)\.(\w+)\(/g)) {
        const t = props.get(c[1]);
        if (t && methodGuarded(t, c[2], depth - 1, seen)) { ok = true; break; }
      }
      if (!ok) for (const c of body.matchAll(/this\.(\w+)\(/g)) if (methodGuarded(cls, c[1], depth - 1, seen)) { ok = true; break; }
    }
    guardCache.set(key, ok);
    return ok;
  }
  function ctorProps(src) {
    const m = new Map();
    for (const x of src.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)/g)) m.set(x[1], x[2]);
    return m;
  }

  const routes = [];
  for (const f of all.filter((p) => p.endsWith('.controller.ts'))) {
    const src = fs.readFileSync(f, 'utf8');
    const cm = src.match(/@Controller\(([^)]*)\)/);
    const prefix = cm ? cm[1].replace(/['"`\s]/g, '') : '';
    const head = src.slice(0, src.indexOf('export class'));
    const clsName = (src.match(/export class (\w+)/) ?? [])[1];
    const classGuarded = CLASS_GUARD_RE.test(head);
    const auth = /JwtAuthGuard|ApiKeyGuard/.test(head) || classGuarded;
    const requireModule = (head.match(/@RequireModule\('([\w-]+)'\)/) ?? [])[1] ?? null;
    const props = ctorProps(src);
    const re = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g;
    const idx = [];
    let m;
    while ((m = re.exec(src))) idx.push({ v: m[1], p: m[2].replace(/['"`]/g, ''), i: m.index });
    idx.forEach((r, k) => {
      const body = src.slice(r.i, k + 1 < idx.length ? idx[k + 1].i : src.length);
      const methodMatch = body.match(/\)\s*\n\s*(?:async\s+)?(\w+)\s*\(/);
      let direct = GUARD_RE.test(body) || CLASS_GUARD_RE.test(body);
      let viaService = false;
      if (!direct) {
        for (const c of body.matchAll(/this\.(\w+)\.(\w+)\(/g)) {
          const t = props.get(c[1]);
          if (t && methodGuarded(t, c[2], 3, new Set())) { viaService = true; break; }
        }
      }
      if (!direct && !viaService && clsName) {
        for (const c of body.matchAll(/this\.(\w+)\(/g)) if (methodGuarded(clsName, c[1], 3, new Set())) { viaService = true; break; }
      }
      const mods = new Set();
      const actions = new Set();
      for (const a of body.matchAll(/assert(View|ViewAll|Create|Edit|Delete)\(\s*[\w.]+\s*,\s*'([\w-]+)'/g)) { mods.add(a[2]); actions.add(a[1]); }
      routes.push({
        file: path.relative(SRC, f), controller: clsName, prefix, verb: r.v, path: r.p, method: methodMatch?.[1] ?? '?',
        auth, classGuarded, requireModule, guarded: direct || viaService || classGuarded, direct, viaService,
        modules: [...mods], actions: [...actions],
      });
    });
  }
  return routes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const routes = scan();
  const bad = routes.filter((r) => r.auth && !r.guarded);
  console.log(JSON.stringify({ total: routes.length, unguarded: bad.length, routes: process.argv.includes('--all') ? routes : bad }, null, 1));
}
