import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, isPrivateIp, parseSafeUrl, safeHttpRequest, SsrfBlockedError } from './ssrf.js';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1',
    '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1', 'ff02::1', '2001:db8::1',
  ])('blocks %s', (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '203.0.114.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
});

describe('URL validation', () => {
  it('rejects non-http schemes and embedded credentials', () => {
    for (const u of ['file:///etc/passwd', 'gopher://x', 'ftp://x/y', 'javascript:alert(1)', 'http://user:pw@example.com/']) {
      expect(() => parseSafeUrl(u), u).toThrow(SsrfBlockedError);
    }
  });

  it('assertPublicHttpUrl rejects loopback, metadata and internal names without any DNS', async () => {
    for (const u of ['http://127.0.0.1/', 'http://localhost:8080/', 'http://169.254.169.254/latest/meta-data/', 'https://[::1]/', 'http://10.0.0.5/x', 'http://db.internal/', 'http://printer.local/']) {
      await expect(assertPublicHttpUrl(u), u).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });
});

describe('safeHttpRequest', () => {
  let server: http.Server | undefined;
  afterEach(() => {
    server?.close();
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
  });

  function listen(handler: http.RequestListener): Promise<string> {
    return new Promise((resolve) => {
      server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
    });
  }

  it('refuses to connect to a loopback server by default', async () => {
    let hit = false;
    const base = await listen((_req, res) => { hit = true; res.end('secret'); });
    await expect(safeHttpRequest(`${base}/x`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(hit).toBe(false);
  });

  it('refuses a hostname that resolves to loopback (DNS-based bypass such as localtest.me style names)', async () => {
    const base = await listen((_req, res) => res.end('secret'));
    const port = new URL(base).port;
    // "localhost" is name-blocked; a numeric-IP alias like 0x7f.1 is normalised by URL to 127.0.0.1 and blocked as literal
    await expect(safeHttpRequest(`http://0x7f.1:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeHttpRequest(`http://2130706433:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('with WEBHOOK_ALLOW_PRIVATE_NETWORKS=true it works, does NOT follow redirects, and caps the response size', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = 'true';
    const base = await listen((req, res) => {
      if (req.url === '/redir') { res.statusCode = 302; res.setHeader('Location', 'http://169.254.169.254/'); res.end(); return; }
      res.end('x'.repeat(10_000));
    });
    const redirected = await safeHttpRequest(`${base}/redir`, { method: 'GET' });
    expect(redirected.status).toBe(302);
    const big = await safeHttpRequest(`${base}/big`, { method: 'GET', maxResponseBytes: 100 });
    expect(big.ok).toBe(true);
    expect(big.text.length).toBeLessThanOrEqual(10_000);
    expect(big.text.length).toBeLessThan(10_000 + 1);
  });
});
