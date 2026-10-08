import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/**
 * محافظ SSRF برای هر درخواست خروجی با URL که کاربر/تننت تعیین کرده (وب‌هوک، تریگر تماس VoIP، ...).
 *
 * سه لایه:
 *  1) اعتبارسنجی نحوی URL (فقط http/https، بدون user:pass).
 *  2) هر آدرس IP حاصل از DNS باید عمومی باشد (loopback/خصوصی/link-local/متادیتای ابری/CGNAT/multicast مسدود).
 *  3) ضد DNS-rebinding: اتصال واقعی با تابع `lookup` سفارشی انجام می‌شود که همان لحظه‌ی connect اعتبارسنجی می‌کند
 *     (نه یک resolve جدا و بعد یک resolve دیگر). ریدایرکت دنبال نمی‌شود (یک 3xx می‌توانست به شبکه‌ی داخلی برود).
 *
 * برای استقرار on-premise که وب‌هوک به سرویس LAN دارد: WEBHOOK_ALLOW_PRIVATE_NETWORKS=true (پیش‌فرض خاموش).
 */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function allowPrivate(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === 'true';
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** IPv6 → آرایه‌ی ۸ تایی ۱۶‌بیتی (پشتیبانی از :: و v4 تعبیه‌شده). */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail];
  const nums = all.map((h) => parseInt(h, 16));
  return nums.length === 8 && nums.every((x) => Number.isFinite(x) && x >= 0 && x <= 0xffff) ? nums : null;
}

export function isPrivateIp(ipRaw: string): boolean {
  const kind = isIP(ipRaw);
  if (kind === 4) return isPrivateV4(ipRaw);
  if (kind === 6) {
    const g = parseV6(ipRaw);
    if (!g) return true;
    const [a, b, c, d, e, f, g6, h] = g;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && h === 1) return true; // ::1
    if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((a & 0xff00) === 0xff00) return true; // multicast
    if (a === 0x2001 && b === 0x0db8) return true; // documentation
    const embeddedV4 = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`;
    if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPrivateV4(embeddedV4); // ::ffff:a.b.c.d
    if (a === 0x64 && b === 0xff9b) return isPrivateV4(embeddedV4); // NAT64
    if (a === 0x2002) return isPrivateV4(`${b >> 8}.${b & 255}.${c >> 8}.${c & 255}`); // 6to4
    return false;
  }
  return true; // نه IPv4 نه IPv6 → مشکوک
}

export function parseSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfBlockedError('آدرس نامعتبر است');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SsrfBlockedError('فقط آدرس http/https مجاز است');
  if (u.username || u.password) throw new SsrfBlockedError('آدرس نباید شامل نام‌کاربری/رمز باشد');
  if (!u.hostname) throw new SsrfBlockedError('آدرس نامعتبر است');
  return u;
}

function hostIsBlockedLiteral(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (isIP(h)) return isPrivateIp(h);
  return false;
}

/** اعتبارسنجی هنگام ذخیره‌ی URL (پیش‌بررسی؛ دفاع اصلی در لحظه‌ی اتصال است). DNS هم resolve می‌شود. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const u = parseSafeUrl(raw);
  if (allowPrivate()) return u;
  if (hostIsBlockedLiteral(u.hostname)) throw new SsrfBlockedError('آدرس‌های داخلی/خصوصی مجاز نیستند');
  if (!isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
    const addrs = await new Promise<LookupAddress[]>((resolve, reject) =>
      dnsLookup(u.hostname, { all: true }, (err, a) => (err ? reject(err) : resolve(a))),
    ).catch(() => {
      throw new SsrfBlockedError('نام دامنه resolve نشد');
    });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      throw new SsrfBlockedError('این دامنه به آدرس داخلی/خصوصی اشاره می‌کند');
    }
  }
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;

/** lookup سفارشی: همان آدرسی که اعتبارسنجی می‌شود همان آدرسی است که سوکت به آن وصل می‌شود → rebinding ممکن نیست. */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number | undefined, cb: LookupCb): void {
  const opts = typeof options === 'object' && options ? options : {};
  dnsLookup(hostname, { all: true, family: opts.family }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => !allowPrivate() && isPrivateIp(a.address));
    if (bad || addrs.length === 0) {
      const e = new SsrfBlockedError('مقصد به آدرس داخلی/خصوصی resolve شد') as NodeJS.ErrnoException;
      e.code = 'ESSRF';
      return cb(e);
    }
    if (opts.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

export type SafeRequestOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type SafeResponse = { status: number; ok: boolean; text: string };

/** معادل fetch با محافظ SSRF: بدون ریدایرکت، با سقف زمان و حجم پاسخ. */
export async function safeHttpRequest(rawUrl: string, opts: SafeRequestOptions = {}): Promise<SafeResponse> {
  const u = parseSafeUrl(rawUrl);
  if (!allowPrivate() && hostIsBlockedLiteral(u.hostname)) throw new SsrfBlockedError('آدرس‌های داخلی/خصوصی مجاز نیستند');
  const lib = u.protocol === 'https:' ? https : http;
  const max = opts.maxResponseBytes ?? 256 * 1024;
  return new Promise<SafeResponse>((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: opts.method ?? 'POST',
        headers: { ...(opts.headers ?? {}), ...(opts.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}) },
        lookup: guardedLookup as never,
        timeout: opts.timeoutMs ?? 8_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= max) chunks.push(c);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, text: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
