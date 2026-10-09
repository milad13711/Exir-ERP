import { openSecret, sealSecret } from '../security/app-secrets.js';

/**
 * Per-tenant Postgres credentials (finding S-14). The password lives in the control plane sealed with
 * APP_SECRETS_KEY (AES-256-GCM, same primitive as the other app secrets). The AAD binds the ciphertext
 * to the database name, so a sealed value copied onto another tenant's row does not decrypt.
 *
 * NEVER log or return the plaintext; callers get it only to build a connection string.
 */
export type TenantDbCredential = { user: string; password: string };

const aad = (dbName: string) => `tenantdb:${dbName}`;

/** Throws AppSecretsKeyMissingError when APP_SECRETS_KEY is missing/invalid (fail closed; nothing is stored in clear). */
export function sealTenantDbPassword(password: string, dbName: string): string {
  if (!password) throw new Error('empty tenant DB password');
  const sealed = sealSecret(password, aad(dbName));
  if (!sealed) throw new Error('sealing produced an empty value');
  return sealed;
}

/** Returns null when the row has no role credentials (legacy tenant). Throws when sealed data cannot be opened. */
export function openTenantDbCredential(
  row: { dbName: string; dbUser?: string | null; dbPasswordEnc?: string | null },
): TenantDbCredential | null {
  if (!row.dbUser || !row.dbPasswordEnc) return null;
  const { value, legacy } = openSecret(row.dbPasswordEnc, aad(row.dbName));
  // A value without the enc1: prefix would be plaintext at rest — refuse it instead of using it.
  if (legacy || !value) throw new Error('tenant DB password is not sealed');
  return { user: row.dbUser, password: value };
}
