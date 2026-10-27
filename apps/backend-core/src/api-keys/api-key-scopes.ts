import { BlockList, isIP } from 'node:net';

/**
 * دامنه‌ی دسترسی کلید API — منطق خالص (بدون وابستگی به Nest/Prisma) تا هم گارد، هم MCP و هم تست‌ها از یک تعریف استفاده کنند.
 *
 * واژگان scopes:
 *  - `read`            خواندن (GET/HEAD و ابزارهای READ در MCP)
 *  - `propose`         ثبت «درخواست نیازمند تأیید» از طریق MCP (ابزارهای write هیچ‌وقت مستقیم اجرا نمی‌شوند)
 *  - `write`           نوشتن مستقیم در REST (POST/PUT/PATCH/DELETE)؛ شامل propose هم هست
 *  - `module:<code>`   محدودسازی به ماژول‌های فهرست‌شده (اگر هیچ module: نباشد = همه‌ی ماژول‌ها)
 *  - `mcp:tools:<name>` فهرست مجاز ابزارهای MCP (اگر هیچ‌کدام نباشد = همه‌ی ابزارهای مجاز با بقیه‌ی دامنه‌ها)
 *
 * scopes خالی/نامشخص = «کلید قدیمی – دسترسی کامل» (رفتار پیش از معرفی دامنه‌ها).
 */
export type KeyScopes = readonly string[] | null | undefined;

export const MODULE_SCOPE_PREFIX = 'module:';
export const MCP_TOOL_SCOPE_PREFIX = 'mcp:tools:';

export const KEY_PRESETS = {
  read_only: ['read'],
  read_propose: ['read', 'propose'],
  full: ['read', 'propose', 'write'],
} as const;
export type KeyPreset = keyof typeof KEY_PRESETS;
export const KEY_PRESET_NAMES = Object.keys(KEY_PRESETS) as KeyPreset[];

const MODULE_CODE_RE = /^[a-z][a-z0-9-]{0,48}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const isModuleCode = (v: unknown): v is string => typeof v === 'string' && MODULE_CODE_RE.test(v);
export const isToolName = (v: unknown): v is string => typeof v === 'string' && TOOL_NAME_RE.test(v);

export function buildScopes(preset: KeyPreset, modules: readonly string[] = [], tools: readonly string[] = []): string[] {
  const set = new Set<string>(KEY_PRESETS[preset]);
  for (const m of modules) if (isModuleCode(m)) set.add(MODULE_SCOPE_PREFIX + m);
  for (const t of tools) if (isToolName(t)) set.add(MCP_TOOL_SCOPE_PREFIX + t);
  return [...set];
}

export const isLegacyKey = (scopes: KeyScopes): boolean => !scopes || scopes.length === 0;

export function canWrite(scopes: KeyScopes): boolean {
  return isLegacyKey(scopes) || scopes!.includes('write');
}

/** ثبت درخواست تأیید (ابزارهای write در MCP): با `propose` یا `write`. */
export function canPropose(scopes: KeyScopes): boolean {
  return isLegacyKey(scopes) || scopes!.includes('propose') || scopes!.includes('write');
}

export function canRead(scopes: KeyScopes): boolean {
  return isLegacyKey(scopes) || scopes!.includes('read') || scopes!.includes('write') || scopes!.includes('propose');
}

export function scopedModules(scopes: KeyScopes): string[] {
  return (scopes ?? []).filter((s) => s.startsWith(MODULE_SCOPE_PREFIX)).map((s) => s.slice(MODULE_SCOPE_PREFIX.length));
}

export function scopedTools(scopes: KeyScopes): string[] {
  return (scopes ?? []).filter((s) => s.startsWith(MCP_TOOL_SCOPE_PREFIX)).map((s) => s.slice(MCP_TOOL_SCOPE_PREFIX.length));
}

/** آیا این کلید به این ماژول دسترسی دارد؟ بدون محدودیت ماژولی = همه. */
export function moduleAllowed(scopes: KeyScopes, moduleCode: string): boolean {
  const mods = scopedModules(scopes);
  return mods.length === 0 || mods.includes(moduleCode);
}

export function hasModuleRestriction(scopes: KeyScopes): boolean {
  return scopedModules(scopes).length > 0;
}

export const REST_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const isRestWriteMethod = (method: string | undefined): boolean => REST_WRITE_METHODS.has((method ?? 'GET').toUpperCase());

export type McpToolMeta = { name: string; module: string; kind: 'read' | 'write' };

/** ابزار MCP برای این دامنه‌ها قابل‌دیدن/اجراست؟ (هم برای tools/list و هم برای tools/call) */
export function toolAllowed(scopes: KeyScopes, tool: McpToolMeta): boolean {
  if (isLegacyKey(scopes)) return true;
  if (tool.kind === 'write' ? !canPropose(scopes) : !canRead(scopes)) return false;
  if (!moduleAllowed(scopes, tool.module)) return false;
  const allow = scopedTools(scopes);
  return allow.length === 0 || allow.includes(tool.name);
}

// ── IP allowlist ─────────────────────────────────────────────────────────

/** ورودی معتبر: IPv4/IPv6 تکی یا CIDR. */
export function parseIpEntry(raw: string): { net: string; prefix: number | null; family: 'ipv4' | 'ipv6' } | null {
  const v = raw.trim();
  if (!v) return null;
  const [net, p, ...rest] = v.split('/');
  if (rest.length) return null;
  const ver = isIP(net);
  if (!ver) return null;
  const max = ver === 4 ? 32 : 128;
  if (p === undefined) return { net, prefix: null, family: ver === 4 ? 'ipv4' : 'ipv6' };
  if (!/^\d{1,3}$/.test(p)) return null;
  const prefix = Number(p);
  if (prefix < 0 || prefix > max) return null;
  return { net, prefix, family: ver === 4 ? 'ipv4' : 'ipv6' };
}

export function ipAllowed(ip: string | undefined, allowlist: readonly string[] | null | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/i, '');
  const fam = isIP(addr);
  if (!fam) return false;
  const bl = new BlockList();
  for (const entry of allowlist) {
    const e = parseIpEntry(entry);
    if (!e) continue;
    if (e.prefix === null) bl.addAddress(e.net, e.family);
    else bl.addSubnet(e.net, e.prefix, e.family);
  }
  return bl.check(addr, fam === 4 ? 'ipv4' : 'ipv6');
}
