import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * نگهبان «اتصال خودکار»: هر ماژولی که با approvals.request(...) سندی را به کارتابل می‌فرستد
 * باید برای همان entityType یک registerHandler هم داشته باشد، وگرنه مدیر نمی‌تواند از کارتابل تأییدش کند.
 */
describe('approvals wiring', () => {
  const files = sourceFiles(join(__dirname, '..'));
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  const requested = new Set([...all.matchAll(/entityType:\s*'([A-Z_]+)'/g)].map((m) => m[1]));
  const registered = new Set([...all.matchAll(/registerHandler\(\s*'([A-Z_]+)'/g)].map((m) => m[1]));

  it('registers a handler for every entityType sent to the cartable', () => {
    expect(requested.size).toBeGreaterThan(0);
    for (const type of requested) expect(registered, `missing handler for ${type}`).toContain(type);
  });
});
