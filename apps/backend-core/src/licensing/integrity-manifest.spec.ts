import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeypair, loadSigningKey, parsePublicKeyring } from './license-crypto.js';
import { MANIFEST_FILE, buildManifest, verifyManifestDir } from './integrity-manifest.js';
import { IntegrityService } from './integrity.service.js';

let dir: string;
const kp = generateKeypair();
const key = loadSigningKey(kp.privateKeyPem);
const ring = parsePublicKeyring(kp.publicKeyPem);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dist-'));
  mkdirSync(path.join(dir, 'sub'));
  writeFileSync(path.join(dir, 'main.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'sub', 'a.js'), 'export const a = 1');
  writeFileSync(path.join(dir, 'main.js.map'), '{}'); // maps are ignored
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function sign() {
  const { token, manifest } = await buildManifest(dir, key, '1.0.0');
  writeFileSync(path.join(dir, MANIFEST_FILE), token);
  return manifest;
}

describe('integrity manifest', () => {
  it('builds a sorted manifest and verifies clean output', async () => {
    const m = await sign();
    expect(Object.keys(m.files)).toEqual(['main.js', 'sub/a.js']);
    expect(await verifyManifestDir(dir, ring)).toMatchObject({ status: 'ok', version: '1.0.0', modified: [], added: [], missing: [] });
  });

  it('detects modified, added and missing files', async () => {
    await sign();
    writeFileSync(path.join(dir, 'main.js'), 'console.log("patched licence check")');
    writeFileSync(path.join(dir, 'sub', 'evil.js'), 'x');
    rmSync(path.join(dir, 'sub', 'a.js'));
    const r = await verifyManifestDir(dir, ring);
    expect(r.status).toBe('tampered');
    expect(r.modified).toEqual(['main.js']);
    expect(r.added).toEqual(['sub/evil.js']);
    expect(r.missing).toEqual(['sub/a.js']);
  });

  it('rejects a manifest re-signed with a foreign key or edited by hand', async () => {
    await sign();
    const foreign = loadSigningKey(generateKeypair().privateKeyPem);
    const { token } = await buildManifest(dir, foreign, '9.9.9');
    writeFileSync(path.join(dir, MANIFEST_FILE), token);
    expect((await verifyManifestDir(dir, ring)).status).toBe('manifest_invalid');
    writeFileSync(path.join(dir, MANIFEST_FILE), 'e30.AAAA');
    expect((await verifyManifestDir(dir, ring)).status).toBe('manifest_invalid');
  });

  it('reports a missing manifest', async () => {
    expect((await verifyManifestDir(dir, ring)).status).toBe('manifest_missing');
  });
});

describe('IntegrityService', () => {
  it('is disabled outside on-premise unless INTEGRITY_VERIFY=true, and flags tamper when enabled', async () => {
    await sign();
    const svc = new IntegrityService();
    delete process.env.DEPLOYMENT_MODE;
    expect(svc.enabled).toBe(false);
    process.env.INTEGRITY_VERIFY = 'true';
    process.env.INTEGRITY_DIST_DIR = dir;
    process.env.LICENSE_PUBLIC_KEY_PEM = kp.publicKeyPem;
    try {
      expect(svc.enabled).toBe(true);
      expect((await svc.check()).status).toBe('ok');
      expect(svc.isTampered()).toBe(false);
      writeFileSync(path.join(dir, 'main.js'), 'tampered');
      expect((await svc.check()).status).toBe('tampered');
      expect(svc.isTampered()).toBe(true);
    } finally {
      delete process.env.INTEGRITY_VERIFY;
      delete process.env.INTEGRITY_DIST_DIR;
      delete process.env.LICENSE_PUBLIC_KEY_PEM;
    }
  });
});
