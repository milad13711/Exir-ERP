import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/tenant-client/index.js';
import { buildTenantClusterUrl } from './build-postgres-url.js';

export type TenantConnection = {
  dbHost: string;
  dbPort: number;
  dbName: string;
};

/**
 * Database-per-tenant means one PrismaClient (one connection pool) per
 * tenant database. Clients are created lazily on first use and cached for
 * the lifetime of the process — there is no per-request instantiation cost
 * after the first request for a given tenant.
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();

  forTenant(conn: TenantConnection): PrismaClient {
    const existing = this.clients.get(conn.dbName);
    if (existing) return existing;

    const client = new PrismaClient({
      datasources: { db: { url: buildTenantClusterUrl(conn.dbHost, conn.dbPort, conn.dbName) } },
    });
    this.clients.set(conn.dbName, client);
    return client;
  }

  /** Drops the cached client for a tenant (e.g. after suspension/deletion). */
  async evict(dbName: string): Promise<void> {
    const client = this.clients.get(dbName);
    if (!client) return;
    await client.$disconnect();
    this.clients.delete(dbName);
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map((c) => c.$disconnect()));
  }
}
