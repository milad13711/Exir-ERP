/**
 * در زمان release (بعد از `npm run build`) اجرا می‌شود:
 *   LICENSE_SIGNING_PRIVATE_KEY_FILE=... [LICENSE_SIGNING_KEY_PASSPHRASE_FILE=...] npm run build:manifest
 * فایل dist/integrity.manifest را می‌سازد (SHA-256 همه‌ی فایل‌های dist، امضاشده با Ed25519).
 * کلید خصوصی را چاپ یا ذخیره نمی‌کند. بدون کلید، با کد خروج 0 رد می‌شود (بیلد dev) مگر MANIFEST_REQUIRED=true.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadSigningKeyFromEnv } from '../src/licensing/license-crypto.js';
import { buildManifest, MANIFEST_FILE } from '../src/licensing/integrity-manifest.js';

const dist = path.resolve(process.argv[2] ?? 'dist');
if (!existsSync(dist)) {
  console.error(`dist not found: ${dist} — run npm run build first`);
  process.exit(1);
}
const key = loadSigningKeyFromEnv();
if (!key) {
  const msg = 'LICENSE_SIGNING_PRIVATE_KEY_FILE/PEM not set — integrity manifest NOT generated';
  if (process.env.MANIFEST_REQUIRED === 'true') {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}
const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string };
const version = process.env.APP_VERSION ?? pkg.version ?? '0.0.0';
const { token, manifest } = await buildManifest(dist, key, version);
writeFileSync(path.join(dist, MANIFEST_FILE), token, { mode: 0o644 });
console.log(`integrity manifest written: ${Object.keys(manifest.files).length} files, kid=${key.kid}, version=${version}`);
