/** سطل توکن ساده (شارژ پیوسته) با اندازه‌ی سخت — برای سهم هر تننت/کاربر از موتور PDF. */
export class TokenBuckets {
  private readonly m = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly perMinute: number, private readonly maxKeys = 10_000) {}

  take(key: string, now = Date.now()): boolean {
    let b = this.m.get(key);
    if (!b) {
      if (this.m.size >= this.maxKeys) {
        let n = Math.ceil(this.maxKeys * 0.1);
        for (const k of this.m.keys()) { this.m.delete(k); if (--n <= 0) break; }
      }
      b = { tokens: this.capacity, at: now };
      this.m.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** کش کوچک با TTL و سقف تعداد/حجم برای PDFهای زنده (کلید شامل شناسه+نسخه+گزینه‌هاست). */
export class PdfCache {
  private readonly m = new Map<string, { buf: Buffer; exp: number }>();
  private bytes = 0;
  constructor(private readonly ttlMs = 60_000, private readonly maxEntries = 30, private readonly maxBytes = 30 * 1024 * 1024) {}

  get(key: string, now = Date.now()): Buffer | null {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp <= now) {
      this.drop(key);
      return null;
    }
    return e.buf;
  }

  set(key: string, buf: Buffer, now = Date.now()): void {
    if (buf.length > this.maxBytes / 2) return;
    this.drop(key);
    this.m.set(key, { buf, exp: now + this.ttlMs });
    this.bytes += buf.length;
    for (const k of [...this.m.keys()]) {
      if (this.m.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      this.drop(k);
    }
  }

  private drop(key: string) {
    const e = this.m.get(key);
    if (e) { this.bytes -= e.buf.length; this.m.delete(key); }
  }
}
