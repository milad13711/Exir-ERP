import { describe, expect, it, vi } from 'vitest';
import { PdfCache, TokenBuckets } from './token-bucket.js';
import { chromiumArgs, chromiumLaunchOptions, minimalChromiumEnv } from '../../common/chromium-launch.js';

describe('TokenBuckets', () => {
  it('allows a burst then throttles per key and refills over time', () => {
    const b = new TokenBuckets(3, 60);
    expect([1, 2, 3, 4].map(() => b.take('t1', 0))).toEqual([true, true, true, false]);
    expect(b.take('t2', 0)).toBe(true); // کلید دیگر مستقل است
    expect(b.take('t1', 1000)).toBe(true); // ۶۰ در دقیقه = ۱ در ثانیه
    expect(b.take('t1', 1000)).toBe(false);
  });
  it('bounds memory', () => {
    const b = new TokenBuckets(1, 1, 10);
    for (let i = 0; i < 100; i++) b.take(`k${i}`, 0);
    expect((b as unknown as { m: Map<string, unknown> }).m.size).toBeLessThanOrEqual(10);
  });
});

describe('PdfCache', () => {
  it('expires by TTL and evicts by count/size', () => {
    const c = new PdfCache(1000, 2, 100);
    c.set('a', Buffer.alloc(10), 0);
    expect(c.get('a', 500)?.length).toBe(10);
    expect(c.get('a', 1500)).toBeNull();
    c.set('a', Buffer.alloc(10), 0); c.set('b', Buffer.alloc(10), 0); c.set('c', Buffer.alloc(10), 0);
    expect(c.get('a', 1)).toBeNull();
    expect(c.get('c', 1)).not.toBeNull();
    c.set('big', Buffer.alloc(80), 0); // بزرگ‌تر از نصف سقف → کش نمی‌شود
    expect(c.get('big', 1)).toBeNull();
  });
});

describe('chromium launch options', () => {
  it('passes only PATH/HOME/LANG — no secrets', () => {
    const env = minimalChromiumEnv({ PATH: '/bin', HOME: '/home/exir', DATABASE_URL: 'postgres://x', JWT_SECRET: 's', APP_SECRETS_KEY: 'k', LANG: 'fa_IR.UTF-8' } as never);
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH']);
    expect(minimalChromiumEnv({ PATH: '/bin' } as never).LANG).toBe('C.UTF-8');
  });
  it('hardening flags are present; sandbox is opt-in via CHROMIUM_SANDBOX=1', () => {
    const a = chromiumArgs({} as never);
    for (const f of ['--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--js-flags=--jitless']) expect(a).toContain(f);
    expect(a).toContain('--no-sandbox');
    expect(chromiumArgs({ CHROMIUM_SANDBOX: '1' } as never)).not.toContain('--no-sandbox');
    const o = chromiumLaunchOptions({ PATH: '/bin', PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser', SECRET: 'x' } as never);
    expect(o.executablePath).toBe('/usr/bin/chromium-browser');
    expect(o.env).toEqual({ PATH: '/bin', LANG: 'C.UTF-8' });
  });
});

// ── موتور واقعی با puppeteer ساختگی ─────────────────────────────────────────
function fakePuppeteer(opts: { hang?: boolean } = {}) {
  const closed: string[] = [];
  let ctxSeq = 0;
  const makePage = (cid: number) => ({
    setJavaScriptEnabled: async () => undefined,
    setRequestInterception: async () => undefined,
    on: () => undefined,
    setContent: async () => { if (opts.hang) await new Promise(() => undefined); },
    pdf: async () => Buffer.from('%PDF-1.4'),
    close: async () => { closed.push(`page${cid}`); },
  });
  const browser = {
    connected: true,
    createBrowserContext: async () => {
      const id = ++ctxSeq;
      return { newPage: async () => makePage(id), close: async () => { closed.push(`ctx${id}`); } };
    },
    close: async () => { closed.push('browser'); },
  };
  return { browser, closed, launches: vi.fn() };
}

describe('LetterPdfService governor', () => {
  async function load(opts: { hang?: boolean } = {}) {
    vi.resetModules();
    const fake = fakePuppeteer(opts);
    vi.doMock('puppeteer', () => ({ default: { launch: async (o: unknown) => { fake.launches(o); return fake.browser; } } }));
    const mod = await import('./letter-pdf.service.js');
    return { ...mod, fake };
  }
  const slipInput = { orgName: 'x', secretariatNumber: '1', registeredAtText: 'x', externalNumber: null, externalDateText: null, senderName: 's', subject: 's', pageCount: 1, attachmentsText: null, registrarName: 'r', qr: null };

  it('launches Chromium with minimal env, a fresh context per render and closes it afterwards', async () => {
    const { LetterPdfService, fake } = await load();
    const svc = new LetterPdfService();
    await svc.renderIncomingSlip(slipInput, { tenantId: 't', userId: 'u' });
    await svc.renderIncomingSlip(slipInput, { tenantId: 't', userId: 'u' });
    const launchOpts = fake.launches.mock.calls[0][0] as { env: Record<string, string>; args: string[] };
    expect(Object.keys(launchOpts.env).every((k) => ['PATH', 'HOME', 'LANG'].includes(k))).toBe(true);
    expect(launchOpts.args).toContain('--js-flags=--jitless');
    expect(fake.launches).toHaveBeenCalledTimes(1);
    expect(fake.closed.filter((c) => c.startsWith('ctx'))).toEqual(['ctx1', 'ctx2']);
  });

  it('recycles the browser after N renders', async () => {
    const { LetterPdfService, fake } = await load();
    const svc = new LetterPdfService() as unknown as { recycleAfter: number; renderIncomingSlip: (i: unknown, o: unknown) => Promise<Buffer> };
    (svc as { recycleAfter: number }).recycleAfter = 2;
    for (let i = 0; i < 3; i++) await svc.renderIncomingSlip(slipInput, { tenantId: 't', userId: `u${i}` });
    expect(fake.launches).toHaveBeenCalledTimes(2);
    expect(fake.closed).toContain('browser');
  });

  it('per-user and per-tenant quotas return 429, but the signing path is exempt', async () => {
    const { LetterPdfService } = await load();
    const svc = new LetterPdfService();
    const call = (o: Record<string, unknown>) => svc.renderIncomingSlip(slipInput, o as never);
    let denied = 0;
    for (let i = 0; i < 12; i++) await call({ tenantId: 't', userId: 'same' }).catch((e) => { if (e.status === 429) denied++; });
    expect(denied).toBeGreaterThan(0);
    const priority = (svc as unknown as { run: (o: unknown, f: () => Promise<number>) => Promise<number> });
    for (let i = 0; i < 30; i++) expect(await priority.run({ tenantId: 't', userId: 'same', priority: true }, async () => 1)).toBe(1);
  });

  it('queue overflow → 503 for normal jobs while the reserved slot still serves the signing path', async () => {
    const { LetterPdfService } = await load();
    const svc = new LetterPdfService();
    const gate: Array<() => void> = [];
    const run = (svc as unknown as { run: (o: unknown, f: () => Promise<number>) => Promise<number> }).run.bind(svc);
    const blocker = () => new Promise<number>((r) => gate.push(() => r(1)));
    const normal = Array.from({ length: svc.maxConcurrency }, (_, i) => run({ tenantId: 'tn', userId: `n${i}` }, blocker));
    // صف عادی را پر می‌کنیم
    const queued = Array.from({ length: svc.maxQueue }, (_, i) => run({ tenantId: 'tq', userId: `q${i}`, priority: false }, async () => 2).catch((e) => e));
    await expect(run({ tenantId: 'to', userId: 'over' }, async () => 3)).rejects.toMatchObject({ status: 503 });
    // مسیر امضا از slot رزرو استفاده می‌کند و منتظر صف عادی نمی‌ماند
    await expect(run({ tenantId: 'ts', userId: 'sign', priority: true }, async () => 4)).resolves.toBe(4);
    gate.forEach((g) => g());
    await Promise.all([...normal, ...queued]);
  });

  it('on timeout the in-flight pages are closed so the slot is truly released', async () => {
    process.env.LETTER_PDF_TIMEOUT_MS = '5000';
    const { LetterPdfService, fake } = await load({ hang: true });
    const svc = new LetterPdfService();
    (svc as unknown as { timeoutMs: number }).timeoutMs = 50;
    await expect(svc.renderIncomingSlip(slipInput, { tenantId: 't', userId: 'u' })).rejects.toMatchObject({ status: 503 });
    expect(fake.closed).toEqual(expect.arrayContaining(['page1', 'ctx1']));
    expect((svc as unknown as { active: number }).active).toBe(0);
    delete process.env.LETTER_PDF_TIMEOUT_MS;
  });
});
