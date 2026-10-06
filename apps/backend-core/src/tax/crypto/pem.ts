import { X509Certificate, createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export type ParsedPrivateKey = { key: KeyObject; fingerprint: string; modulusLength: number };

const MIN_MODULUS = 2048;

/** SHA-256 از DER کلید عمومی (SPKI) — «اثرانگشت» نمایشی؛ خود کلید هرگز نمایش داده نمی‌شود. */
export function publicKeyFingerprint(pub: KeyObject): string {
  return createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').toUpperCase().replace(/(.{2})(?=.)/g, '$1:');
}

/** کلید خصوصی RSA را واقعاً با node:crypto پارس و اعتبارسنجی می‌کند (PKCS#8 یا PKCS#1، بدون رمز). */
export function parsePrivateKeyPem(pem: string): ParsedPrivateKey {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem.trim(), format: 'pem' });
  } catch {
    throw new BadRequestException('کلید خصوصی نامعتبر است (PEM بدون رمز با قالب PKCS#8 یا PKCS#1 لازم است)');
  }
  if (key.asymmetricKeyType !== 'rsa') throw new BadRequestException('فقط کلید RSA پذیرفته می‌شود');
  const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (modulusLength < MIN_MODULUS) throw new BadRequestException('طول کلید RSA باید دست‌کم ۲۰۴۸ بیت باشد');
  return { key, fingerprint: publicKeyFingerprint(createPublicKey(key)), modulusLength };
}

export type ParsedCertificate = { fingerprint: string; validTo: Date; validFrom: Date; subject: string; publicKey: KeyObject };

export function parseCertificatePem(pem: string): ParsedCertificate {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem.trim());
  } catch {
    throw new BadRequestException('گواهی نامعتبر است (PEM گواهی X.509 لازم است)');
  }
  return {
    fingerprint: cert.fingerprint256,
    validFrom: new Date(cert.validFrom),
    validTo: new Date(cert.validTo),
    subject: cert.subject.replace(/\n/g, ', '),
    publicKey: cert.publicKey,
  };
}

/** کلید عمومی سازمان از GET_SERVER_INFORMATION: base64 خام DER(SPKI) یا PEM. */
export function parseServerPublicKey(keyText: string): KeyObject {
  const t = keyText.trim();
  try {
    if (t.includes('BEGIN')) return createPublicKey({ key: t, format: 'pem' });
    return createPublicKey({ key: Buffer.from(t.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new BadRequestException('کلید عمومی سازمان نامعتبر است');
  }
}

export function sameKeyPair(priv: KeyObject, pub: KeyObject): boolean {
  return createPublicKey(priv).export({ type: 'spki', format: 'der' }).equals(pub.export({ type: 'spki', format: 'der' }));
}
