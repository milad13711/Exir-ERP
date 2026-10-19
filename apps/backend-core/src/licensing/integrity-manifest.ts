import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { signPayload, verifySignedPayload, type PublicKeyring, type SigningKey } from './license-crypto.js';

/**
 * مانیفست یکپارچگی بیلد: SHA-256 هر فایل dist، امضاشده با Ed25519 در زمان release.
 * در زمان اجرا با کلید عمومی (که ماشین مشتری دارد) راستی‌آزمایی می‌شود؛ مانیفست قابل جعل نیست، ولی خودِ کد راستی‌آزما قابل patch است
 * (docs/licensing/threat-model.md) — این لایه «تشخیص و گزارش» است نه مانع مطلق.
 */
export const MANIFEST_FILE = 'integrity.manifest';
const INCLUDE = /\.(js|mjs|cjs|json)$/;

export type IntegrityManifest = {
  v: 1;
  kid: string;
  version: string;
  builtAt: string;
  files: Record<string, string>;
};

export type IntegrityResult = {
  status: 'ok' | 'tampered' | 'manifest_missing' | 'manifest_invalid' | 'disabled';
  modified: string[];
  added: string[];
  missing: string[];
  builtAt: string | null;
  version: string | null;
  checkedAt: string;
};

async function walk(dir: string, root: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out);
    else if (INCLUDE.test(e.name) && e.name !== MANIFEST_FILE) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

const sha = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

export async function buildManifest(distDir: string, key: SigningKey, version: string): Promise<{ token: string; manifest: IntegrityManifest }> {
  const files: Record<string, string> = {};
  for (const rel of (await walk(distDir, distDir)).sort()) files[rel] = await sha(path.join(distDir, rel));
  const manifest: IntegrityManifest = { v: 1, kid: key.kid, version, builtAt: new Date().toISOString(), files };
  return { token: signPayload(manifest, key), manifest };
}

export async function verifyManifestDir(distDir: string, ring: PublicKeyring): Promise<IntegrityResult> {
  const base = { modified: [], added: [], missing: [], builtAt: null, version: null, checkedAt: new Date().toISOString() };
  let raw: string;
  try {
    raw = await readFile(path.join(distDir, MANIFEST_FILE), 'utf8');
  } catch {
    return { ...base, status: 'manifest_missing' };
  }
  let m: IntegrityManifest;
  try {
    m = verifySignedPayload<IntegrityManifest>(raw, ring);
    if (m.v !== 1 || typeof m.files !== 'object' || !m.files) throw new Error('shape');
  } catch {
    return { ...base, status: 'manifest_invalid' };
  }
  const modified: string[] = [];
  const missing: string[] = [];
  for (const [rel, hash] of Object.entries(m.files)) {
    // جلوگیری از path traversal در مانیفست (که امضاشده است ولی دفاع در عمق)
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    try {
      if ((await sha(path.join(distDir, rel))) !== hash) modified.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  const known = new Set(Object.keys(m.files));
  const added = (await walk(distDir, distDir)).filter((f) => !known.has(f));
  const tampered = modified.length + missing.length + added.length > 0;
  return {
    status: tampered ? 'tampered' : 'ok',
    modified: modified.slice(0, 50),
    added: added.slice(0, 50),
    missing: missing.slice(0, 50),
    builtAt: m.builtAt,
    version: m.version,
    checkedAt: base.checkedAt,
  };
}
