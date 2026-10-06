import type { KeyObject } from 'node:crypto';
import { SIGNED_HEADER_NAMES } from '../mapping/moodian-field-map.js';
import { normalizeJson } from './normalize.js';
import { signString } from './packet-crypto.js';

export type RequestHeadersForSigning = { requestTraceId: string; timestamp: number | string; Authorization?: string };

function pickSignedHeaders(h: RequestHeadersForSigning): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const name of SIGNED_HEADER_NAMES) out[name] = h[name];
  return out;
}

/** امضای درخواست ناهمگام: normalize({packets}+headers). NEEDS-SANDBOX-VERIFICATION (ترکیب سرآیندها). */
export function signAsyncRequest(packets: unknown[], headers: RequestHeadersForSigning, privateKey: KeyObject): string {
  return signString(normalizeJson(packets, pickSignedHeaders(headers)), privateKey);
}

/** امضای درخواست همگام: normalize({time, packet}+headers). NEEDS-SANDBOX-VERIFICATION. */
export function signSyncRequest(body: { time: number; packet: unknown }, headers: RequestHeadersForSigning, privateKey: KeyObject): string {
  return signString(normalizeJson(body, pickSignedHeaders(headers)), privateKey);
}

/** رشته‌ی نرمال‌شده‌ای که برای امضا استفاده می‌شود (برای تست و هش منجمدسازی). */
export function normalizedAsyncRequest(packets: unknown[], headers: RequestHeadersForSigning): string {
  return normalizeJson(packets, pickSignedHeaders(headers));
}
