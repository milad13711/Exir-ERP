export type ClusterCredential = { user: string; password?: string };

/**
 * Builds a Postgres connection string for the shared tenant cluster.
 * Without `cred` the legacy shared account is used (TENANT_DB_ADMIN_USER / TENANT_DB_ADMIN_PASSWORD;
 * the password is optional so local dev clusters can keep running on trust auth — an on-premise or
 * cloud deployment must set it, see docker-compose.on-premise.yml / .env.on-premise.example).
 * With `cred` (a tenant's own least-privilege role, S-14) that role is used instead.
 */
export function buildTenantClusterUrl(host: string, port: number, dbName: string, cred?: ClusterCredential | null): string {
  const user = cred?.user ?? process.env.TENANT_DB_ADMIN_USER ?? 'postgres';
  const password = cred ? cred.password : process.env.TENANT_DB_ADMIN_PASSWORD;
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `postgresql://${auth}@${host}:${port}/${dbName}?schema=public`;
}
