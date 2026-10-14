import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { loadSecretsKey } from '../../tax/crypto/secret-box.js';
import { APP_SECRETS_ENV } from '../../security/app-secrets.js';

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** JSON پایدار (کلیدها مرتب) — ترتیب کلیدهای jsonb در Postgres حفظ نمی‌شود، پس هش باید به ترتیب وابسته نباشد. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** هش SHA-256 از «عکس لحظه‌ای» سند/محتوای امضاشده (هر مقدار JSON‌پذیر). */
export const hashContent = (snapshot: unknown): string => sha256Hex(stableStringify(snapshot));

/** هش تصویر امضا (data URL یا هر رشته). */
export const hashSignature = (signatureData: string | undefined | null): string | undefined => (signatureData ? sha256Hex(signatureData) : undefined);

export type ParsedUserAgent = {
  browser: string;
  browserVersion?: string;
  os: string;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
};

export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  const s = (ua ?? '').slice(0, 512);
  if (!s) return { browser: 'unknown', os: 'unknown', deviceType: 'unknown' };
  let os = 'unknown';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  const rules: Array<[string, RegExp]> = [
    ['Edge', /(?:Edg|EdgA|EdgiOS|Edge)\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  let browser = 'unknown';
  let browserVersion: string | undefined;
  for (const [name, re] of rules) {
    const m = re.exec(s);
    if (m) {
      browser = name;
      browserVersion = m[1];
      break;
    }
  }
  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/bot|crawl|spider|curl|wget|python-requests/i.test(s)) deviceType = 'bot';
  else if (/iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) deviceType = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/i.test(s)) deviceType = 'mobile';
  return { browser, browserVersion, os, deviceType };
}

/** زمان به‌وقت تهران، مثل «2026-10-14 15:20:33 (Asia/Tehran)». */
export function formatTehran(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} (Asia/Tehran)`;
}

/** فیلدهای ثابت و مرتبی که هش یکپارچگی روی آن‌ها بسته می‌شود. */
export type EvidenceIntegrityFields = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  signerName?: string | null;
  signerPhone?: string | null;
  signerUserId?: string | null;
  signerRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  device?: unknown;
  geoStatus: string;
  lat?: number | null;
  lng?: number | null;
  geoAccuracy?: number | null;
  clientTime?: Date | string | null;
  serverTime: Date | string;
  contentHash?: string | null;
  signatureHash?: string | null;
};

function canonicalEvidence(r: EvidenceIntegrityFields): string {
  const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
  return stableStringify({
    v: 1,
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    signerName: r.signerName ?? null,
    signerPhone: r.signerPhone ?? null,
    signerUserId: r.signerUserId ?? null,
    signerRole: r.signerRole ?? null,
    ip: r.ip ?? null,
    userAgent: r.userAgent ?? null,
    device: r.device ?? null,
    geoStatus: r.geoStatus,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    geoAccuracy: r.geoAccuracy ?? null,
    clientTime: iso(r.clientTime),
    serverTime: iso(r.serverTime),
    contentHash: r.contentHash ?? null,
    signatureHash: r.signatureHash ?? null,
  });
}

function evidenceKey(): Buffer | null {
  try {
    const k = loadSecretsKey(process.env[APP_SECRETS_ENV]);
    // جداسازی دامنه: همان کلید اصلی مستقیم برای HMAC استفاده نمی‌شود.
    return createHmac('sha256', k).update('signature-evidence:v1').digest();
  } catch {
    return null;
  }
}

/**
 * «hmac:<hex>» با کلید APP_SECRETS_KEY؛ اگر کلید تنظیم نباشد «sha256:<hex>» (بدون کلید — ضد دستکاری ضعیف‌تر
 * ولی امضا هرگز به خاطر نبود کلید بلاک نمی‌شود).
 */
export function computeIntegrityHash(r: EvidenceIntegrityFields): string {
  const canon = canonicalEvidence(r);
  const key = evidenceKey();
  return key ? `hmac:${createHmac('sha256', key).update(canon).digest('hex')}` : `sha256:${sha256Hex(canon)}`;
}

/** درستی هش یکپارچگی؛ نبود کلید برای رکورد hmac یعنی «قابل‌تأیید نیست» = false. */
export function verifyIntegrity(r: EvidenceIntegrityFields & { integrityHash: string }): boolean {
  const stored = r.integrityHash ?? '';
  const [kind] = stored.split(':');
  let expected: string;
  if (kind === 'hmac') {
    const key = evidenceKey();
    if (!key) return false;
    expected = `hmac:${createHmac('sha256', key).update(canonicalEvidence(r)).digest('hex')}`;
  } else if (kind === 'sha256') {
    expected = `sha256:${sha256Hex(canonicalEvidence(r))}`;
  } else return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
