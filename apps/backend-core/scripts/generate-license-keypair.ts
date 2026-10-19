/**
 * یک‌بار هنگام راه‌اندازی سرور لایسنس (کنترل‌پلین):
 *   LICENSE_KEY_PASSPHRASE='...' npm run license:keygen          (توصیه‌شده: کلید خصوصی رمزگذاری‌شده)
 *   npm run license:keygen -- --no-passphrase                     (فقط dev)
 *
 * - کلید خصوصی در keys/ (gitignore) با mode 0600 نوشته می‌شود؛ هرگز چاپ نمی‌شود.
 * - فقط kid و کلید عمومی چاپ می‌شود (برای .env بسته‌ی مشتری: LICENSE_PUBLIC_KEY_PEM).
 * - نام فایل‌ها با kid مشخص می‌شود؛ برای چرخش کلید دوباره اجرا کنید (فایل قبلی بازنویسی نمی‌شود).
 * راهنمای کامل: docs/licensing/README.md
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateKeypair } from '../src/licensing/license-crypto.js';

const noPass = process.argv.includes('--no-passphrase');
const passphrase = process.env.LICENSE_KEY_PASSPHRASE;
if (!noPass && (!passphrase || passphrase.length < 16)) {
  console.error('LICENSE_KEY_PASSPHRASE (حداقل ۱۶ نویسه) را در محیط ست کنید تا کلید خصوصی رمزگذاری شود، یا برای dev از --no-passphrase استفاده کنید.');
  process.exit(1);
}

const { privateKeyPem, publicKeyPem, kid } = generateKeypair(noPass ? undefined : passphrase);
const dir = path.join(process.cwd(), 'keys');
const privatePath = path.join(dir, `license-signing-${kid}.private.pem`);
const publicPath = path.join(dir, `license-signing-${kid}.public.pem`);
if (existsSync(privatePath)) {
  console.error(`${privatePath} از قبل وجود دارد`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(privatePath, privateKeyPem, { mode: 0o600 });
chmodSync(privatePath, 0o600);
writeFileSync(publicPath, publicKeyPem, { mode: 0o644 });

console.log(`kid:           ${kid}`);
console.log(`کلید خصوصی:   ${privatePath}  (رمزگذاری scrypt+AES-GCM: ${noPass ? 'خیر' : 'بله'}) — هرگز commit/ارسال نشود؛ یک نسخه‌ی آفلاین امن نگه دارید`);
console.log(`کلید عمومی:   ${publicPath}\n`);
console.log('روی سرور لایسنس (env یا secret file):');
console.log(`  LICENSE_SIGNING_PRIVATE_KEY_FILE=${privatePath}`);
if (!noPass) console.log('  LICENSE_SIGNING_KEY_PASSPHRASE_FILE=<مسیر فایل حاوی passphrase>   (یا LICENSE_SIGNING_KEY_PASSPHRASE)');
console.log('\nدر .env بسته‌ی مشتری (چند بلوک PEM برای چرخش کلید ممکن است):');
console.log(`  LICENSE_PUBLIC_KEY_PEM="${publicKeyPem.replace(/\n/g, '\\n')}"`);
