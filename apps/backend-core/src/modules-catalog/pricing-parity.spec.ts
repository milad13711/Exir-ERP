import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_LICENSE_USD, deriveModulePrices } from './module-license-usd.js';
import { moduleLicensePrice, moduleYearlyPrice } from './module-pricing.js';

describe('module pricing', () => {
  it('backend USD table equals the marketing-site table (single source of truth)', () => {
    const src = readFileSync(join(__dirname, '../../../marketing-site/src/lib/pricing.ts'), 'utf8');
    const block = /MODULE_LICENSE_WEIGHTS_USD: Record<string, number> = \{([\s\S]*?)\n\};/.exec(src)![1];
    const marketing = Object.fromEntries([...block.matchAll(/"?([\w-]+)"?:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(marketing).toEqual(MODULE_LICENSE_USD);
  });

  it('monthly, yearly and license are consistent (×5, ×6) for every module', () => {
    for (const usd of Object.values(MODULE_LICENSE_USD).filter((v) => v > 0)) {
      const p = deriveModulePrices(usd, 231_800);
      expect(p.yearly).toBe(p.monthly * 5);
      expect(p.license).toBe(p.yearly * 6);
      expect(moduleYearlyPrice({ priceMonthly: p.monthly, priceYearly: p.yearly })).toBe(p.yearly);
      expect(moduleLicensePrice({ priceMonthly: p.monthly, priceYearly: p.yearly })).toBe(p.license);
    }
  });

  it('a factory ERP with ~12 modules costs about one billion Toman as a license', () => {
    const factory = ['production', 'warehouse', 'accounting', 'purchasing', 'sales', 'crm', 'hr', 'quality-control', 'checks', 'reports', 'contracts', 'projects'];
    const total = factory.reduce((sum, code) => sum + deriveModulePrices(MODULE_LICENSE_USD[code], 231_800).license, 0);
    expect(total).toBeGreaterThan(900_000_000);
    expect(total).toBeLessThan(1_250_000_000);
  });

  it('tasks stays free', () => {
    expect(deriveModulePrices(MODULE_LICENSE_USD.tasks, 231_800)).toEqual({ monthly: 0, yearly: 0, license: 0 });
  });
});
