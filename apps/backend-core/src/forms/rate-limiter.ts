/** محدودکننده‌ی ساده‌ی پنجره‌ی لغزان در حافظه (برای هر پردازه) — برای endpointهای عمومی بدون ورود. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** true = اجازه داده شد (و شمرده شد)؛ false = از حد گذشته. */
  take(key: string): boolean {
    const t = this.now();
    this.sweep(t);
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }

  private sweep(t: number) {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [k, arr] of this.hits) {
      if (arr.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
    }
  }
}
