import { describe, expect, it } from 'vitest';
import { buildScopes, canPropose, canRead, canWrite, ipAllowed, isLegacyKey, isRestWriteMethod, moduleAllowed, parseIpEntry, toolAllowed } from './api-key-scopes.js';

const read = buildScopes('read_only');
const propose = buildScopes('read_propose');
const full = buildScopes('full');

describe('api-key-scopes', () => {
  it('legacy keys (empty/undefined scopes) keep full access', () => {
    for (const s of [undefined, null, []]) {
      expect(isLegacyKey(s)).toBe(true);
      expect(canWrite(s) && canPropose(s) && canRead(s)).toBe(true);
      expect(moduleAllowed(s, 'anything')).toBe(true);
      expect(toolAllowed(s, { name: 'create_task', module: 'tasks', kind: 'write' })).toBe(true);
    }
  });

  it('presets map to the least-privilege ladder', () => {
    expect(read).toEqual(['read']);
    expect(canWrite(read)).toBe(false);
    expect(canPropose(read)).toBe(false);
    expect(canPropose(propose)).toBe(true);
    expect(canWrite(propose)).toBe(false);
    expect(canWrite(full)).toBe(true);
  });

  it('module scopes restrict, and tool allowlist restricts further', () => {
    const s = buildScopes('read_propose', ['tasks', 'crm'], ['search_tasks']);
    expect(moduleAllowed(s, 'tasks')).toBe(true);
    expect(moduleAllowed(s, 'sales')).toBe(false);
    expect(toolAllowed(s, { name: 'search_tasks', module: 'tasks', kind: 'read' })).toBe(true);
    expect(toolAllowed(s, { name: 'get_task', module: 'tasks', kind: 'read' })).toBe(false); // not in allowlist
    expect(toolAllowed(s, { name: 'list_sales_invoices', module: 'sales', kind: 'read' })).toBe(false); // module
  });

  it('read-only keys never see write tools; propose keys do', () => {
    const w = { name: 'create_task', module: 'tasks', kind: 'write' as const };
    expect(toolAllowed(read, w)).toBe(false);
    expect(toolAllowed(propose, w)).toBe(true);
    expect(toolAllowed(read, { name: 'search_tasks', module: 'tasks', kind: 'read' })).toBe(true);
  });

  it('rejects malformed module/tool names when building scopes', () => {
    expect(buildScopes('read_only', ['Bad Code!', 'ok-mod'], ['x y', 'good_tool'])).toEqual(['read', 'module:ok-mod', 'mcp:tools:good_tool']);
  });

  it('classifies REST methods', () => {
    expect(isRestWriteMethod('POST') && isRestWriteMethod('delete') && isRestWriteMethod('PATCH') && isRestWriteMethod('PUT')).toBe(true);
    expect(isRestWriteMethod('GET') || isRestWriteMethod('HEAD') || isRestWriteMethod(undefined)).toBe(false);
  });

  it('IP allowlist: empty = open, exact, CIDR v4/v6, mapped v4, garbage rejected', () => {
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
    expect(ipAllowed(undefined, ['1.2.3.4'])).toBe(false);
    expect(ipAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
    expect(ipAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
    expect(ipAllowed('10.1.2.200', ['10.1.2.0/24'])).toBe(true);
    expect(ipAllowed('10.1.3.1', ['10.1.2.0/24'])).toBe(false);
    expect(ipAllowed('::ffff:10.1.2.9', ['10.1.2.0/24'])).toBe(true);
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:dc8::1', ['2001:db8::/32'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['1.2.3.4'])).toBe(false);
    expect(parseIpEntry('1.2.3.4/33')).toBeNull();
    expect(parseIpEntry('abc')).toBeNull();
    expect(parseIpEntry('1.2.3.4/24/1')).toBeNull();
    expect(parseIpEntry('::1')).not.toBeNull();
  });
});
