import { describe, expect, it } from 'vitest';
import { formatTaskCode, parseTaskNumber, sanitizeTaskPrefix } from './task-number.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('task numbering', () => {
  it('formats TASK-000125 with a configurable prefix', () => {
    expect(formatTaskCode('TASK', 125)).toBe('TASK-000125');
    expect(formatTaskCode('ops', 7)).toBe('OPS-000007');
    expect(formatTaskCode('', 1_234_567)).toBe('TASK-1234567');
  });

  it('sanitizes unsafe prefixes', () => {
    expect(sanitizeTaskPrefix('کار!')).toBe('TASK');
    expect(sanitizeTaskPrefix('a-b c')).toBe('ABC');
    expect(sanitizeTaskPrefix('x'.repeat(30))).toHaveLength(10);
    expect(sanitizeTaskPrefix(undefined)).toBe('TASK');
  });

  it('parses a search query into a number', () => {
    expect(parseTaskNumber('TASK-000125')).toBe(125);
    expect(parseTaskNumber('125')).toBe(125);
    expect(parseTaskNumber('000125')).toBe(125);
    expect(parseTaskNumber('گزارش')).toBeNull();
    expect(parseTaskNumber('ab 12')).toBeNull();
  });

  it('the number is drawn from an atomic DB sequence (schema default + migration), not from application code', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/tenant/schema.prisma'), 'utf8');
    expect(schema).toMatch(/number\s+Int\s+@unique\s+@default\(autoincrement\(\)\)/);
    const sql = readFileSync(join(process.cwd(), 'prisma/tenant/migrations/20261012100000_tasks_workflow/migration.sql'), 'utf8');
    expect(sql).toContain('CREATE SEQUENCE "tasks_number_seq"');
    expect(sql).toContain('nextval(');
    expect(sql).toContain('CREATE UNIQUE INDEX "tasks_number_key"');
  });
});
