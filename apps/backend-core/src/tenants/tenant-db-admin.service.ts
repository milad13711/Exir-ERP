import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import pg from 'pg';
import { buildTenantClusterUrl } from '../prisma/build-postgres-url.js';

const execFileAsync = promisify(execFile);

/**
 * Everything that requires talking to the Postgres CLUSTER rather than a
 * single database: creating/dropping a tenant's database, and running the
 * tenant schema's migrations against it. This is the only place in the
 * codebase that issues `CREATE DATABASE` or shells out to Prisma.
 */
@Injectable()
export class TenantDbAdminService {
  private adminPool(host: string, port: number): pg.Pool {
    return new pg.Pool({
      host,
      port,
      user: process.env.TENANT_DB_ADMIN_USER ?? 'postgres',
      // Undefined (not empty string) so `pg` falls back to trust auth /
      // PGPASSWORD when unset — only local dev clusters run without one.
      password: process.env.TENANT_DB_ADMIN_PASSWORD || undefined,
      database: 'postgres', // maintenance DB — required to run CREATE/DROP DATABASE
    });
  }

  private assertSafeDbName(dbName: string): void {
    // Defence in depth against SQL injection even though callers control
    // this value today: only allow the shape we ourselves generate.
    if (!/^[a-z][a-z0-9_]{2,62}$/.test(dbName)) {
      throw new InternalServerErrorException(`نام دیتابیس نامعتبر: ${dbName}`);
    }
  }

  async createDatabase(host: string, port: number, dbName: string): Promise<void> {
    this.assertSafeDbName(dbName);
    const pool = this.adminPool(host, port);
    try {
      await pool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8'`);
    } finally {
      await pool.end();
    }
  }

  async dropDatabase(host: string, port: number, dbName: string): Promise<void> {
    this.assertSafeDbName(dbName);
    const pool = this.adminPool(host, port);
    try {
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [dbName],
      );
      await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await pool.end();
    }
  }

  /** Applies every tenant migration (prisma/tenant/migrations) to a freshly created database. */
  async applyTenantSchema(host: string, port: number, dbName: string): Promise<void> {
    const tenantUrl = buildTenantClusterUrl(host, port, dbName);
    const cwd = process.cwd();
    const schemaPath = path.join(cwd, 'prisma/tenant/schema.prisma');
    const prismaBin = path.join(cwd, 'node_modules/.bin/prisma');

    try {
      await execFileAsync(prismaBin, ['migrate', 'deploy', '--schema', schemaPath], {
        cwd,
        env: { ...process.env, TENANT_DATABASE_URL: tenantUrl },
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `اجرای مایگریشن روی دیتابیس تننت با خطا مواجه شد: ${(err as Error).message}`,
      );
    }
  }
}
