import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from './control-prisma.service.js';
import { buildTenantClusterUrl } from './build-postgres-url.js';
import { openTenantDbCredential, type TenantDbCredential } from './tenant-db-credentials.js';

export type TenantConnection = {
  dbHost: string;
  dbPort: number;
  dbName: string;
  /** Optional: a tenant row that already carries role credentials. Otherwise the credential registry is consulted. */
  dbUser?: string | null;
  dbPasswordEnc?: string | null;
};

type CacheEntry = { client: PrismaClient; fingerprint: string };

/** How long an outgoing client (after a credential switch) keeps serving in-flight queries before it is disconnected. */
const RETIRE_GRACE_MS = 30_000;

/**
 * Database-per-tenant means one PrismaClient (one connection pool) per
 * tenant database. Clients are created lazily on first use and cached for
 * the lifetime of the process — there is no per-request instantiation cost
 * after the first request for a given tenant.
 *
 * Least privilege (S-14): when a tenant has its own Postgres role (control-plane columns
 * dbUser + dbPasswordEnc) its client connects as that role; otherwise as the legacy shared
 * account. Most callers pass only {dbHost, dbPort, dbName}, so credentials come from an
 * in-memory registry loaded from the control plane at boot and refreshed periodically
 * (TENANT_DB_CRED_REFRESH_MS, default 15 s) — a switch (rollout, rotation, rollback) therefore
 * produces a fresh client and the old one is disconnected after a short grace period.
 */
@Injectable()
export class TenantPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TenantPrismaService');
  private readonly clients = new Map<string, CacheEntry>();
  /** dbName -> credential (role tenants) | error marker (sealed value that cannot be opened: fail closed). */
  private registry = new Map<string, TenantDbCredential | { error: string }>();
  private timer?: NodeJS.Timeout;

  constructor(@Optional() private readonly controlDb?: ControlPrismaService) {}

  async onModuleInit() {
    await this.refreshCredentials();
    const ms = Number(process.env.TENANT_DB_CRED_REFRESH_MS ?? 15_000);
    if (this.controlDb && ms > 0) {
      this.timer = setInterval(() => void this.refreshCredentials(), ms);
      this.timer.unref();
    }
  }

  /** Reloads per-tenant credentials from the control plane. Never throws (a failed refresh keeps the previous registry). */
  async refreshCredentials(): Promise<void> {
    if (!this.controlDb) return;
    try {
      const rows = await this.controlDb.tenant.findMany({
        where: { dbUser: { not: null }, dbPasswordEnc: { not: null } },
        select: { dbName: true, dbUser: true, dbPasswordEnc: true },
      });
      this.setRegistry(rows);
    } catch (err) {
      this.logger.error(`tenant DB credential refresh failed: ${(err as Error).message}`);
    }
  }

  /** Test seam / explicit registration: replaces the registry from tenant rows. */
  setRegistry(rows: Array<{ dbName: string; dbUser?: string | null; dbPasswordEnc?: string | null }>): void {
    const next = new Map<string, TenantDbCredential | { error: string }>();
    for (const row of rows) {
      try {
        const cred = openTenantDbCredential(row);
        if (cred) next.set(row.dbName, cred);
      } catch {
        // Never include the cause: it could echo key material. Fail closed for this tenant only.
        next.set(row.dbName, { error: 'unreadable' });
        this.logger.error(`tenant "${row.dbName}" has DB role credentials that cannot be decrypted (APP_SECRETS_KEY missing/rotated?) - its connections are refused`);
      }
    }
    this.registry = next;
  }

  /** The credential that forTenant would use, or null for legacy shared credentials. Throws (fail closed) if sealed but unreadable. */
  resolveCredential(conn: TenantConnection): TenantDbCredential | null {
    if (conn.dbUser && conn.dbPasswordEnc) {
      try {
        return openTenantDbCredential({ dbName: conn.dbName, dbUser: conn.dbUser, dbPasswordEnc: conn.dbPasswordEnc });
      } catch {
        throw new ServiceUnavailableException('Tenant database credentials are unavailable');
      }
    }
    const entry = this.registry.get(conn.dbName);
    if (!entry) return null;
    if ('error' in entry) throw new ServiceUnavailableException('Tenant database credentials are unavailable');
    return entry;
  }

  forTenant(conn: TenantConnection): PrismaClient {
    const cred = this.resolveCredential(conn);
    const fingerprint = cred
      ? `role:${cred.user}:${createHash('sha256').update(cred.password).digest('hex').slice(0, 16)}`
      : 'legacy';
    const existing = this.clients.get(conn.dbName);
    if (existing && existing.fingerprint === fingerprint) return existing.client;

    const client = new PrismaClient({
      datasources: { db: { url: buildTenantClusterUrl(conn.dbHost, conn.dbPort, conn.dbName, cred) } },
    });
    this.clients.set(conn.dbName, { client, fingerprint });
    if (existing) this.retire(existing.client);
    return client;
  }

  private retire(client: PrismaClient): void {
    const t = setTimeout(() => void client.$disconnect().catch(() => undefined), RETIRE_GRACE_MS);
    t.unref();
  }

  /** Drops the cached client for a tenant (e.g. after suspension/deletion). */
  async evict(dbName: string): Promise<void> {
    const entry = this.clients.get(dbName);
    if (!entry) return;
    await entry.client.$disconnect();
    this.clients.delete(dbName);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.clients.values()].map((e) => e.client.$disconnect()));
  }
}
