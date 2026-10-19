import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * لایه‌ی رمزنگاری سیستم لایسنس (بدون وابستگی به Nest — توسط اسکریپت‌های CLI و تست‌ها هم استفاده می‌شود).
 *
 * - امضا: Ed25519 نامتقارن. کلید خصوصی فقط روی سرور لایسنس (env / فایل راز، ترجیحاً رمزگذاری‌شده با passphrase)؛
 *   محصول مشتری فقط کلید(های) عمومی را دارد (keyring بر اساس kid) — پس چیزی که قابل استخراج باشد، امکان جعل نمی‌دهد.
 * - kid = ۱۶ نویسه‌ی اول SHA-256 از DER کلید عمومی؛ برای چرخش کلید.
 * - فرمت توکن: base64url(JSON) + "." + base64url(امضا روی همان بایت‌ها). kid داخل payload است (خوانده می‌شود تا کلید درست انتخاب شود
 *   و فقط پس از راستی‌آزمایی امضا به محتوا اعتماد می‌شود).
 */

export class LicenseCryptoError extends Error {
  constructor(
    message: string,
    readonly code: 'malformed' | 'bad_signature' | 'unknown_kid' | 'bad_payload' | 'key_error',
  ) {
    super(message);
  }
}

export type TokenIntegrityPolicy = 'WARN' | 'LOCK';

export type ActivationTokenPayload = {
  v: 2;
  kid: string;
  jti: string;
  licenseId: string;
  licenseKey: string;
  orgName: string;
  product: string;
  edition: string | null;
  /** شناسه‌ی نصب (installationId) که توکن به آن گره خورده */
  installationId: string;
  /** هش (SHA-256) مؤلفه‌های اثرانگشت هنگام فعال‌سازی؛ null = بدون اتصال به اثرانگشت (توکن آفلاین عمومی) */
  fp: string | null;
  modules: string[];
  maxUsers: number;
  issuedAt: string;
  notBefore: string;
  /** انقضای خود لایسنس؛ null = دائمی */
  expiresAt: string | null;
  /** حق به‌روزرسانی تا این تاریخ؛ null = نامحدود */
  updatesUntil: string | null;
  graceDays: number;
  /** عمر همین توکن — پیش از آن باید با check-in تمدید شود */
  tokenExpiresAt: string;
  /** nonce ارسالیِ کلاینت (ضد replay)؛ null برای توکن آفلاین */
  nonce: string | null;
  serverTime: string;
  integrityPolicy: TokenIntegrityPolicy;
  crlVersion: number;
};

export type CrlDocument = {
  v: 1;
  kid: string;
  version: number;
  issuedAt: string;
  /** SHA-256 (۱۶ نویسه‌ی اول، hex) کلیدهای لایسنسِ لغو/معلق‌شده */
  revoked: string[];
  /** kid کلیدهای امضای ازکارافتاده */
  revokedKids: string[];
};

export const LICENSE_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ── کلیدها ───────────────────────────────────────────────────────────────

export function computeKid(publicKey: KeyObject | string): string {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export type SigningKey = { privateKey: KeyObject; kid: string };

const ENVELOPE_TAG = 'exirkey1';
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** رمزنگاری PEM با scrypt (N=2^16) + AES-256-GCM؛ خروجی JSON تک‌خطی. (PBKDF2 پیش‌فرض PKCS#8 در Node ضعیف‌تر است.) */
export function encryptPrivateKeyPem(pem: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(pem, 'utf8'), c.final()]);
  return JSON.stringify({ v: ENVELOPE_TAG, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') });
}

function decryptPrivateKeyPem(envelope: string, passphrase: string): string {
  const e = JSON.parse(envelope) as { N: number; r: number; p: number; salt: string; iv: string; tag: string; ct: string };
  const key = scryptSync(passphrase, Buffer.from(e.salt, 'base64'), 32, { N: e.N, r: e.r, p: e.p, maxmem: SCRYPT.maxmem });
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString('utf8');
}

/** کلید خصوصی (PEM ساده، PEM رمزگذاری‌شده‌ی PKCS#8 قدیمی، یا envelope جدید scrypt) را می‌خواند و kid را از کلید عمومیِ مشتق‌شده می‌سازد. */
export function loadSigningKey(pem: string, passphrase?: string): SigningKey {
  try {
    let text = pem.trim();
    if (text.startsWith('{') && text.includes(ENVELOPE_TAG)) {
      if (!passphrase) throw new Error('passphrase required');
      text = decryptPrivateKeyPem(text, passphrase);
      passphrase = undefined;
    }
    const privateKey = createPrivateKey({ key: text.replace(/\\n/g, '\n'), ...(passphrase ? { passphrase } : {}) });
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return { privateKey, kid: computeKid(createPublicKey(privateKey)) };
  } catch {
    // پیام عمداً کلی است؛ جزئیات (و هرگز خود کلید) لاگ نمی‌شود.
    throw new LicenseCryptoError('کلید امضای لایسنس نامعتبر است یا passphrase اشتباه است', 'key_error');
  }
}

/**
 * کلید امضای سرور را از محیط می‌خواند (به‌ترتیب):
 *   LICENSE_SIGNING_PRIVATE_KEY_FILE (مسیر فایل راز — توصیه‌شده)  یا  LICENSE_SIGNING_PRIVATE_KEY_PEM
 *   passphrase: LICENSE_SIGNING_KEY_PASSPHRASE_FILE یا LICENSE_SIGNING_KEY_PASSPHRASE
 * null = پیکربندی نشده.
 */
export function loadSigningKeyFromEnv(env: NodeJS.ProcessEnv = process.env): SigningKey | null {
  const readFileTrim = (p: string) => readFileSync(p, 'utf8').trim();
  let pem: string | undefined;
  if (env.LICENSE_SIGNING_PRIVATE_KEY_FILE) pem = readFileSync(env.LICENSE_SIGNING_PRIVATE_KEY_FILE, 'utf8');
  else if (env.LICENSE_SIGNING_PRIVATE_KEY_PEM) pem = env.LICENSE_SIGNING_PRIVATE_KEY_PEM;
  if (!pem) return null;
  if (env.NODE_ENV === 'production' && env.LICENSE_SIGNING_KEY_PASSPHRASE && !env.LICENSE_SIGNING_KEY_PASSPHRASE_FILE) {
    // passphrase در env مستقیم در /proc و docker inspect دیده می‌شود
    throw new LicenseCryptoError('در production فقط LICENSE_SIGNING_KEY_PASSPHRASE_FILE پذیرفته می‌شود', 'key_error');
  }
  const passphrase = env.LICENSE_SIGNING_KEY_PASSPHRASE_FILE
    ? readFileTrim(env.LICENSE_SIGNING_KEY_PASSPHRASE_FILE)
    : env.LICENSE_SIGNING_KEY_PASSPHRASE;
  return loadSigningKey(pem, passphrase || undefined);
}

/** جفت‌کلید جدید؛ اگر passphrase داده شود کلید خصوصی در envelope رمزگذاری‌شده‌ی scrypt+AES-GCM صادر می‌شود. */
export function generateKeypair(passphrase?: string): { privateKeyPem: string; publicKeyPem: string; kid: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    privateKeyPem: passphrase ? encryptPrivateKeyPem(pem, passphrase) : pem,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    kid: computeKid(publicKey),
  };
}

export type PublicKeyring = Map<string, KeyObject>;

/** چند بلوک PEM عمومی پشت‌سرهم (چرخش کلید) → keyring بر اساس kid. */
export function parsePublicKeyring(text: string | undefined | null): PublicKeyring {
  const ring: PublicKeyring = new Map();
  if (!text) return ring;
  const blocks = text.replace(/\\n/g, '\n').match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) ?? [];
  for (const b of blocks) {
    try {
      const k = createPublicKey(b);
      if (k.asymmetricKeyType === 'ed25519') ring.set(computeKid(k), k);
    } catch {
      /* بلوک خراب نادیده گرفته می‌شود */
    }
  }
  return ring;
}

/** keyring محصول: LICENSE_PUBLIC_KEY_PEM (یک یا چند بلوک) + فایل اختیاری LICENSE_PUBLIC_KEY_FILE. */
export function loadPublicKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): PublicKeyring {
  let text = env.LICENSE_PUBLIC_KEY_PEM ?? '';
  if (env.LICENSE_PUBLIC_KEY_FILE) {
    try {
      text += `\n${readFileSync(env.LICENSE_PUBLIC_KEY_FILE, 'utf8')}`;
    } catch {
      /* فایل نبود */
    }
  }
  return parsePublicKeyring(text);
}

// ── توکن ─────────────────────────────────────────────────────────────────

export function signPayload(payload: object, key: SigningKey): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, body, key.privateKey);
  return `${body.toString('base64url')}.${signature.toString('base64url')}`;
}

/**
 * امضا را با keyring راستی‌آزمایی و payload را برمی‌گرداند. توکن بدون kid (نسخه‌ی قدیمی) با همه‌ی کلیدها امتحان می‌شود.
 * انقضا/وضعیت اینجا بررسی نمی‌شود (evaluateToken).
 */
export function verifySignedPayload<T extends { kid?: string }>(token: string, ring: PublicKeyring): T {
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new LicenseCryptoError('قالب توکن نامعتبر است', 'malformed');
  const body = Buffer.from(parts[0], 'base64url');
  const signature = Buffer.from(parts[1], 'base64url');
  let parsed: T;
  try {
    parsed = JSON.parse(body.toString('utf8')) as T;
  } catch {
    throw new LicenseCryptoError('محتوای توکن قابل خواندن نیست', 'malformed');
  }
  if (!parsed || typeof parsed !== 'object') throw new LicenseCryptoError('محتوای توکن قابل خواندن نیست', 'malformed');

  const candidates = parsed.kid ? [ring.get(parsed.kid)].filter((k): k is KeyObject => !!k) : [...ring.values()];
  if (candidates.length === 0) {
    throw new LicenseCryptoError(parsed.kid ? 'کلید امضای این توکن شناخته‌شده نیست' : 'کلید عمومی تنظیم نشده است', 'unknown_kid');
  }
  const ok = candidates.some((k) => {
    try {
      return verify(null, body, k, signature);
    } catch {
      return false;
    }
  });
  if (!ok) throw new LicenseCryptoError('امضای توکن معتبر نیست — دستکاری شده یا اشتباه است', 'bad_signature');
  return parsed;
}

export function verifyActivationToken(token: string, ring: PublicKeyring): ActivationTokenPayload {
  const p = verifySignedPayload<ActivationTokenPayload>(token, ring);
  if (
    p.v !== 2 ||
    typeof p.licenseKey !== 'string' ||
    typeof p.installationId !== 'string' ||
    !Array.isArray(p.modules) ||
    typeof p.tokenExpiresAt !== 'string' ||
    typeof p.notBefore !== 'string'
  ) {
    throw new LicenseCryptoError('محتوای توکن ناقص است', 'bad_payload');
  }
  return p;
}

// ── امضای پاسخ API عمومی ────────────────────────────────────────────────

export function responseSigningString(r: {
  success: boolean;
  code: string;
  license_key: string;
  identifier: string;
  timestamp: number;
  nonce: string;
  kid: string;
  /** SHA-256 hex رشته‌ی crl داخل پاسخ ('' اگر نیست) — CRL هم زیر امضای پاسخ است */
  crlHash?: string;
}): string {
  return ['v2', r.success ? '1' : '0', r.code, r.license_key, r.identifier, String(r.timestamp), r.nonce, r.kid, r.crlHash ?? ''].join('|');
}

export function signString(value: string, key: SigningKey): string {
  return sign(null, Buffer.from(value, 'utf8'), key.privateKey).toString('base64url');
}

export function verifyString(value: string, signatureB64: string, publicKey: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(value, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64url'));
  } catch {
    return false;
  }
}

// ── ارزیابی توکن در محصول ───────────────────────────────────────────────

export type TokenEvaluation = {
  state: 'valid' | 'grace' | 'locked';
  /** 0 = عادی، 1 = اطلاع، 2 = هشدار، 3 = بحرانی (نزدیک قفل) */
  warningLevel: 0 | 1 | 2 | 3;
  reason:
    | 'ok'
    | 'token_renewal_due'
    | 'offline_grace'
    | 'offline_expired'
    | 'license_grace'
    | 'license_expired'
    | 'not_yet_valid'
    | 'clock_rollback'
    | 'installation_mismatch'
    | 'fingerprint_mismatch'
    | 'updates_expired'
    | 'revoked';
  /** روزهای باقی‌مانده تا مرحله‌ی بعدی (قفل یا پایان grace)؛ null = نامحدود */
  daysLeft: number | null;
  clockRollback: boolean;
  /** زمان مؤثر (حداکثر ساعت محلی و آخرین زمان دیده‌شده) */
  effectiveNow: Date;
};

export type EvaluateContext = {
  now: Date;
  /** بیشینه‌ی زمان محلی/سروریِ قبلاً دیده‌شده (persist می‌شود) */
  lastSeen?: Date | null;
  installationId?: string;
  /** هش اثرانگشت فعلی؛ فقط وقتی توکن fp دارد مقایسه می‌شود */
  currentFp?: string | null;
  /** تاریخ build نرم‌افزار (از manifest) برای قاعده‌ی updatesUntil */
  buildDate?: Date | null;
  /** CRL ذخیره‌شده */
  crl?: Pick<CrlDocument, 'revoked' | 'revokedKids'> | null;
};

const DAY = 86_400_000;
const CLOCK_SKEW_MS = 10 * 60_000;
/** بیش از این برگشت ساعت (نسبت به آخرین زمان دیده‌شده) = قفل تا check-in آنلاین */
const MAX_ROLLBACK_MS = 7 * DAY;

export function licenseKeyHash(licenseKey: string): string {
  return createHash('sha256').update(licenseKey).digest('hex').slice(0, 16);
}

export function evaluateToken(p: ActivationTokenPayload, ctx: EvaluateContext): TokenEvaluation {
  const lastSeen = ctx.lastSeen ?? null;
  const rolledBack = !!lastSeen && ctx.now.getTime() + CLOCK_SKEW_MS < lastSeen.getTime();
  // بازگرداندن ساعت هیچ مزیتی نمی‌دهد: همیشه با max(now, lastSeen) محاسبه می‌شود.
  const effectiveNow = lastSeen && lastSeen > ctx.now ? lastSeen : ctx.now;
  const out = (
    state: TokenEvaluation['state'],
    reason: TokenEvaluation['reason'],
    warningLevel: TokenEvaluation['warningLevel'],
    daysLeft: number | null,
  ): TokenEvaluation => ({ state, reason, warningLevel, daysLeft, clockRollback: rolledBack, effectiveNow });

  if (ctx.crl) {
    if (ctx.crl.revoked.includes(licenseKeyHash(p.licenseKey)) || ctx.crl.revokedKids.includes(p.kid)) {
      return out('locked', 'revoked', 3, 0);
    }
  }
  if (ctx.installationId !== undefined && ctx.installationId !== p.installationId) {
    return out('locked', 'installation_mismatch', 3, 0);
  }
  if (p.fp && ctx.currentFp !== undefined && ctx.currentFp !== null && p.fp !== ctx.currentFp) {
    return out('locked', 'fingerprint_mismatch', 3, 0);
  }
  if (rolledBack && lastSeen && lastSeen.getTime() - ctx.now.getTime() > MAX_ROLLBACK_MS) {
    return out('locked', 'clock_rollback', 3, 0);
  }
  if (new Date(p.notBefore).getTime() - CLOCK_SKEW_MS > effectiveNow.getTime()) {
    return out('locked', 'not_yet_valid', 3, 0);
  }
  if (p.updatesUntil && ctx.buildDate && ctx.buildDate.getTime() > new Date(p.updatesUntil).getTime() + DAY) {
    return out('locked', 'updates_expired', 3, 0);
  }

  const graceMs = Math.max(0, p.graceDays) * DAY;
  const left = (end: number) => Math.max(0, Math.ceil((end - effectiveNow.getTime()) / DAY));

  // انقضای خود لایسنس (دائمی = expiresAt null → هرگز)
  if (p.expiresAt) {
    const exp = new Date(p.expiresAt).getTime();
    if (effectiveNow.getTime() > exp) {
      const graceEnd = exp + graceMs;
      if (effectiveNow.getTime() > graceEnd) return out('locked', 'license_expired', 3, 0);
      const d = left(graceEnd);
      return out('grace', 'license_grace', d <= 3 ? 3 : 2, d);
    }
  }
  // عمر توکن (تمدید خودکار با check-in) — آفلاین بودن طولانی
  const tokExp = new Date(p.tokenExpiresAt).getTime();
  if (effectiveNow.getTime() > tokExp) {
    const graceEnd = tokExp + graceMs;
    if (effectiveNow.getTime() > graceEnd) return out('locked', 'offline_expired', 3, 0);
    const d = left(graceEnd);
    return out('grace', 'offline_grace', d <= 3 ? 3 : 2, d);
  }
  const tokLeft = left(tokExp);
  if (tokLeft <= 3) return out('valid', 'token_renewal_due', 1, tokLeft);
  return out('valid', 'ok', rolledBack ? 1 : 0, null);
}

// ── ابزارها ──────────────────────────────────────────────────────────────

export function randomNonce(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** اثرانگشت یکتا از مؤلفه‌های هش‌شده (ترتیب مهم است). */
export function fingerprintDigest(components: string[]): string {
  return sha256Hex(`fp1|${components.join('|')}`);
}

export const FP_EMPTY = '0000000000000000';

/**
 * مقایسه‌ی تحمل‌پذیر مؤلفه‌ها: تغییر محدود (مثلاً hostname/MAC با بازسازی کانتینر) مجاز، تغییر عمده خیر.
 * - مؤلفه‌ی 0 = machine-id میزبان. اگر در هر دو سمت موجود باشد و فرق کند → همیشه عدم تطابق (نصب روی ماشین دیگر).
 * - در غیر این صورت حداقل ceil(n/2) مؤلفه باید برابر باشد.
 */
export function fingerprintMatches(stored: string[], current: string[]): boolean {
  if (stored.length === 0 || current.length === 0) return true; // ثبت نشده؛ بازرسی انجام نمی‌شود
  if (stored[0] !== FP_EMPTY && current[0] !== FP_EMPTY && stored[0] !== current[0]) return false;
  const n = Math.min(stored.length, current.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (stored[i] === current[i]) same++;
  return same >= Math.ceil(n / 2);
}
