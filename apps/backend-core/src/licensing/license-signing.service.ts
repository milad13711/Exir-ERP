import { Injectable, Logger } from '@nestjs/common';
import {
  loadSigningKeyFromEnv,
  responseSigningString,
  signPayload,
  signString,
  type ActivationTokenPayload,
  type CrlDocument,
  type SigningKey,
} from './license-crypto.js';
import { createPublicKey } from 'node:crypto';
import { buildActivationToken, type TokenInput } from './license-token-builder.js';

/** نگه‌دارنده‌ی کلید خصوصی امضا (فقط در حافظه‌ی سرور لایسنس؛ از env/فایل راز خوانده می‌شود، هرگز در DB/لاگ). */
@Injectable()
export class LicenseSigningService {
  private readonly logger = new Logger('LicenseSigning');
  private key: SigningKey | null | undefined;

  private load(): SigningKey | null {
    if (this.key !== undefined) return this.key;
    try {
      this.key = loadSigningKeyFromEnv();
    } catch (err) {
      this.logger.error(`signing key could not be loaded: ${(err as Error).message}`);
      this.key = null;
    }
    return this.key;
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  requireKey(): SigningKey {
    const k = this.load();
    if (!k) throw new Error('LICENSE_SIGNING_KEY_NOT_CONFIGURED');
    return k;
  }

  get kid(): string | null {
    return this.load()?.kid ?? null;
  }

  publicKeyPem(): string | null {
    const k = this.load();
    return k ? createPublicKey(k.privateKey).export({ type: 'spki', format: 'pem' }).toString() : null;
  }

  buildToken(input: TokenInput): { token: string; payload: ActivationTokenPayload } {
    return buildActivationToken(this.requireKey(), input);
  }

  signResponse(r: { success: boolean; code: string; license_key: string; identifier: string; timestamp: number; nonce: string; crlHash?: string }) {
    const key = this.load();
    if (!key) return { kid: '', signature: '' };
    return { kid: key.kid, signature: signString(responseSigningString({ ...r, kid: key.kid }), key) };
  }

  signCrl(doc: Omit<CrlDocument, 'kid' | 'v'>): string | null {
    const key = this.load();
    return key ? signPayload({ v: 1, kid: key.kid, ...doc } satisfies CrlDocument, key) : null;
  }
}
