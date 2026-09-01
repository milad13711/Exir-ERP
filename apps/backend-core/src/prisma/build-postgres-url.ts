/**
 * Builds a Postgres connection string for the shared tenant cluster.
 * TENANT_DB_ADMIN_PASSWORD is optional so local dev clusters can keep
 * running on trust auth — an on-premise or cloud deployment must set it
 * (see docker-compose.on-premise.yml / .env.on-premise.example).
 */
export function buildTenantClusterUrl(host: string, port: number, dbName: string): string {
  const user = process.env.TENANT_DB_ADMIN_USER ?? 'postgres';
  const password = process.env.TENANT_DB_ADMIN_PASSWORD;
  const auth = password ? `${user}:${encodeURIComponent(password)}` : user;
  return `postgresql://${auth}@${host}:${port}/${dbName}?schema=public`;
}
