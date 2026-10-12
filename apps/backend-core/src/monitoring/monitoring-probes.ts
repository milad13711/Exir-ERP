import { connect } from 'node:tls';
import { statfs } from 'node:fs/promises';

/** یک تلاشِ خام. null = خطای شبکه/timeout. */
async function httpStatusOnce(url: string, timeoutMs: number): Promise<{ status: number | null; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'exir-monitor/1' } });
    void res.body?.cancel().catch(() => {});
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * HTTP GET بدون دنبال‌کردن ریدایرکت: 2xx/3xx = سالم. null = خطای شبکه/timeout.
 *
 * فقط برای «خطای شبکه» (نه پاسخ HTTP) یک‌بار بعد از `retryDelayMs` دوباره تلاش می‌شود: یک خطای گذرای اتصال سمت خودِ پروب
 * (مثل «fetch failed» که یک‌بار هشدار کاذب داد در حالی که nginx همه‌ی درخواست‌ها را ۲۰۰ ثبت کرده بود) با تلاش دوم برطرف می‌شود،
 * ولی قطع واقعی هر دو تلاش را رد می‌کند. پاسخ HTTP (مثلاً ۵۰۰) واقعی است و هرگز دوباره‌امتحان نمی‌شود.
 */
export async function httpStatus(url: string, timeoutMs = 10_000, retryDelayMs = 3_000): Promise<{ status: number | null; ms: number; error?: string }> {
  const first = await httpStatusOnce(url, timeoutMs);
  if (first.status !== null) return first;
  await new Promise((r) => setTimeout(r, retryDelayMs));
  const second = await httpStatusOnce(url, timeoutMs);
  return second.status !== null ? second : { ...second, error: second.error ?? first.error };
}

/** روزهای باقی‌مانده تا انقضای گواهی host:443 (اتصال TLS واقعی، بدون اعتماد به زنجیره — فقط تاریخ مهم است). */
export function tlsDaysLeft(host: string, port = 443, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      try {
        const cert = sock.getPeerCertificate();
        sock.end();
        if (!cert?.valid_to) return reject(new Error('گواهی دریافت نشد'));
        resolve(Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000));
      } catch (e) {
        reject(e);
      }
    });
    sock.on('timeout', () => {
      sock.destroy();
      reject(new Error('timeout'));
    });
    sock.on('error', (e) => reject(e));
  });
}

export async function diskFreePct(path: string): Promise<{ freePct: number; freeBytes: number; totalBytes: number }> {
  const fs = await statfs(path);
  const total = Number(fs.blocks) * Number(fs.bsize);
  const free = Number(fs.bavail) * Number(fs.bsize);
  return { freePct: total > 0 ? (free / total) * 100 : NaN, freeBytes: free, totalBytes: total };
}

/** فقط hostname معتبر (بدون scheme/path) برای چک TLS */
export const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
