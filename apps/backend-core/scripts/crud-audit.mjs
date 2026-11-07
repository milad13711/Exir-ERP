// Generates the CRUD/permission audit matrix data: node scripts/crud-audit.mjs > /tmp/crud-audit.json
// Backend: every controller route (scripts/route-guard-scan.mjs). UI: apiFetch call sites in web-panel (api clients + component-local calls).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './route-guard-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web-panel/src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const norm = (p) => '/' + p.replace(/([^/])\$\{[^}]*\}$/, '$1').replace(/\?.*$/, '').replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z]\w*/g, ':p').split('/').filter(Boolean).join('/');

export function uiCalls() {
  const files = walk(WEB);
  const calls = []; // {method, path, file, fn, used}
  const texts = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const re = /(?:apiFetch|apiUpload|apiFetchBlob|apiDownload)\w*(?:<[^>]*>)?\(\s*([`"'])((?:\\.|(?!\1).)*)\1\s*(?:,\s*\{([^}]*)\})?/gs;
  for (const [f, t] of texts) {
    let m;
    const consts = Object.fromEntries([...t.matchAll(/const\s+([A-Z_]\w*)\s*=\s*([`"'])((?:(?!\2).)*)\2/g)].map((x) => [x[1], x[3]]));
    while ((m = re.exec(t))) {
      const tail = t.slice(m.index + m[0].length - (m[3] ?? '').length, m.index + m[0].length + 120);
      const method = (/method:\s*(?:["'](\w+)["']|[^,}]*?["'](\w+)["'][^,}]*)/.exec(m[3] ?? '') ?? /^\s*,?\s*\w*\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']/.exec(t.slice(m.index + m[0].length, m.index + m[0].length + 60)) ?? [])[1]?.toUpperCase() ?? 'GET';
      void tail;
      // enclosing exported function name (nearest preceding `export function X`)
      const before = t.slice(0, m.index);
      const fn = [...before.matchAll(/export (?:async )?function (\w+)/g)].pop()?.[1] ?? null;
      calls.push({ method, path: norm(m[2].replace(/\$\{([A-Z_]\w*)\}/g, (_, k) => consts[k] ?? '${' + k + '}')), file: path.relative(WEB, f), fn });
    }
  }
  const all = [...texts.values()].join('\n');
  for (const c of calls) {
    if (!c.fn) { c.used = true; continue; }
    const uses = (all.match(new RegExp(`\\b${c.fn}\\b`, 'g')) ?? []).length;
    c.used = uses > 1;
  }
  return calls;
}

export function audit() {
  const routes = scan().filter((r) => !r.prefix.startsWith('admin') && !r.prefix.startsWith('public') && !r.prefix.startsWith('internal') && !r.prefix.startsWith('license'));
  const ui = uiCalls();
  const out = routes.map((r) => {
    const bp = norm('/' + r.prefix + '/' + r.path);
    const verb = r.verb.toUpperCase();
    const hit = ui.filter((c) => c.method === verb && c.path === bp);
    return { ...r, norm: bp, ui: hit.length > 0, uiUsed: hit.some((h) => h.used) };
  });
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(JSON.stringify(audit(), null, 1));
}
