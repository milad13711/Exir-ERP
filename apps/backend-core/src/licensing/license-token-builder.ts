import { randomUUID } from 'node:crypto';
import { fingerprintDigest, signPayload, type ActivationTokenPayload, type SigningKey } from './license-crypto.js';

export type TokenInput = {
  license: {
    id: string;
    licenseKey: string;
    orgName: string;
    productName: string;
    edition: string | null;
    allowedModules: string[];
    seats: number;
    expiresAt: Date | null;
    updatesUntil: Date | null;
    graceDays: number;
    integrityPolicy: string;
  };
  installationId: string;
  fingerprint: string[] | null;
  nonce: string | null;
  validityDays: number;
  crlVersion: number;
  now?: Date;
};

/** سازنده‌ی خالص توکن فعال‌سازی (مشترک بین سرویس Nest و CLI). */
export function buildActivationToken(key: SigningKey, input: TokenInput): { token: string; payload: ActivationTokenPayload } {
  const now = input.now ?? new Date();
  const l = input.license;
  const payload: ActivationTokenPayload = {
    v: 2,
    kid: key.kid,
    jti: randomUUID(),
    licenseId: l.id,
    licenseKey: l.licenseKey,
    orgName: l.orgName,
    product: l.productName,
    edition: l.edition,
    installationId: input.installationId,
    fp: input.fingerprint?.length ? fingerprintDigest(input.fingerprint) : null,
    modules: [...l.allowedModules],
    maxUsers: l.seats,
    issuedAt: now.toISOString(),
    notBefore: now.toISOString(),
    expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
    updatesUntil: l.updatesUntil ? l.updatesUntil.toISOString() : null,
    graceDays: l.graceDays,
    tokenExpiresAt: new Date(now.getTime() + input.validityDays * 86_400_000).toISOString(),
    nonce: input.nonce,
    serverTime: now.toISOString(),
    integrityPolicy: l.integrityPolicy === 'LOCK' ? 'LOCK' : 'WARN',
    crlVersion: input.crlVersion,
  };
  return { token: signPayload(payload, key), payload };
}
