import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Offline-verifiable license tokens for on-premise deployments.
 *
 * Format: base64url(JSON payload) + "." + base64url(Ed25519 signature over the
 * JSON bytes). Ed25519 signing hashes internally, so no digest algorithm is
 * passed to sign()/verify() — that's correct, not an omission.
 *
 * The private key never leaves the control plane (it signs licenses when the
 * management team issues one). The public key ships inside every on-premise
 * deployment so it can verify a license completely offline, with no call home.
 */

export type LicensePayload = {
  licenseId: string;
  orgName: string;
  modules: string[];
  seats: number;
  issuedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
};

export class InvalidLicenseError extends Error {}

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(null, body, key);
  return `${body.toString('base64url')}.${signature.toString('base64url')}`;
}

/** Verifies the signature and shape only — does NOT check expiry (see isExpired). */
export function verifyLicenseToken(token: string, publicKeyPem: string): LicensePayload {
  const parts = token.trim().split('.');
  if (parts.length !== 2) throw new InvalidLicenseError('قالب کد لایسنس نامعتبر است');
  const [bodyB64, signatureB64] = parts;

  let body: Buffer;
  let signature: Buffer;
  try {
    body = Buffer.from(bodyB64, 'base64url');
    signature = Buffer.from(signatureB64, 'base64url');
  } catch {
    throw new InvalidLicenseError('قالب کد لایسنس نامعتبر است');
  }

  const key = createPublicKey(publicKeyPem);
  const valid = verify(null, body, key, signature);
  if (!valid) throw new InvalidLicenseError('امضای لایسنس معتبر نیست — کد دستکاری شده یا اشتباه است');

  let payload: LicensePayload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    throw new InvalidLicenseError('محتوای لایسنس قابل خواندن نیست');
  }
  if (!payload.licenseId || !payload.expiresAt || !Array.isArray(payload.modules)) {
    throw new InvalidLicenseError('محتوای لایسنس ناقص است');
  }
  return payload;
}

export function isExpired(payload: LicensePayload, at: Date = new Date()): boolean {
  return at.getTime() > new Date(payload.expiresAt).getTime();
}

/** Generates a fresh Ed25519 keypair as PEM strings — run once when setting up licensing. */
export function generateLicenseKeypair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
