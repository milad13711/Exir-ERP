/**
 * Run once when setting up licensing on a fresh environment:
 *   npm run license:keygen
 *
 * Writes the keypair to keys/ (gitignored — the private key must never be
 * committed or leave the control plane). Prints the values to paste into
 * .env (LICENSE_SIGNING_PRIVATE_KEY_PEM) and into the on-premise deployment
 * bundle's .env (LICENSE_PUBLIC_KEY_PEM).
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateLicenseKeypair } from '../src/licensing/license-token.js';

const keysDir = path.join(process.cwd(), 'keys');
const privatePath = path.join(keysDir, 'license-signing-private.pem');
const publicPath = path.join(keysDir, 'license-signing-public.pem');

if (existsSync(privatePath)) {
  console.error(
    `کلید امضای لایسنس از قبل در ${privatePath} وجود دارد — برای جلوگیری از باطل شدن لایسنس‌های صادرشده، این اسکریپت آن را بازنویسی نمی‌کند.`,
  );
  process.exit(1);
}

mkdirSync(keysDir, { recursive: true });
const { privateKeyPem, publicKeyPem } = generateLicenseKeypair();
writeFileSync(privatePath, privateKeyPem, { mode: 0o600 });
writeFileSync(publicPath, publicKeyPem, { mode: 0o644 });

console.log(`کلید خصوصی نوشته شد: ${privatePath} (هرگز commit نشود)`);
console.log(`کلید عمومی نوشته شد: ${publicPath}\n`);
console.log('در .env هسته‌ی ابری (Control Plane) قرار بده:');
console.log(`LICENSE_SIGNING_PRIVATE_KEY_PEM="${privateKeyPem.replace(/\n/g, '\\n')}"\n`);
console.log('در .env بسته‌ی استقرار on-premise هر مشتری قرار بده:');
console.log(`LICENSE_PUBLIC_KEY_PEM="${publicKeyPem.replace(/\n/g, '\\n')}"`);
