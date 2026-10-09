import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import pg from 'pg';
import { buildTenantClusterUrl } from '../prisma/build-postgres-url.js';
import { isAppSecretsKeyConfigured } from '../security/app-secrets.js';
import { generatePassword, provisionRoleAndDatabase, dropTenantRole, reownTenantDatabase, tenantRoleName } from './tenant-db-roles.js';

const execFileAsync = promisify(execFile);

/**
 * Everything that requires talking to the Postgres CLUSTER rather than a
 * single database: creating/dropping a tenant's database, and running the
 * tenant schema's migrations against it. This is the only place in the
 * codebase that issues `CREATE DATABASE` or shells out to Prisma.
 */
@Injectable()
export class TenantDbAdminService {
  private readonly logger = new Logger('TenantDbAdminService');

  /**
   * TENANT_DB_ISOLATION: `auto` (default) = give NEW tenants their own Postgres role when APP_SECRETS_KEY is
   * configured, else legacy; `required` = refuse to provision without it; `off` = always legacy.
   */
  isolationMode(): 'auto' | 'required' | 'off' {
    const v = (process.env.TENANT_DB_ISOLATION ?? 'auto').toLowerCase();
    return v === 'required' || v === 'off' ? v : 'auto';
  }

  /** Whether a new tenant DB should be created with its own role (throws in `required` mode when impossible). */
  wantsRole(): boolean {
    const mode = this.isolationMode();
    if (mode === 'off') return false;
    if (isAppSecretsKeyConfigured()) return true;
    if (mode === 'required') {
      throw new InternalServerErrorException('TENANT_DB_ISOLATION=required but APP_SECRETS_KEY is not configured');
    }
    this.logger.warn('APP_SECRETS_KEY not configured: new tenant database is created with the legacy shared credentials (S-14)');
    return false;
  }

  /**
   * Creates the tenant's role and its database (owned by that role, closed to PUBLIC). Returns the clear
   * password ONCE — the caller must seal it (sealTenantDbPassword) and never log it.
   */
  async createDatabaseWithRole(host: string, port: number, dbName: string, slug: string): Promise<{ user: string; password: string }> {
    this.assertSafeDbName(dbName);
    const user = tenantRoleName(slug);
    const password = generatePassword();
    try {
      await provisionRoleAndDatabase({ host, port }, dbName, user, password);
    } catch (err) {
      await dropTenantRole({ host, port }, user).catch(() => undefined);
      throw new InternalServerErrorException(`ساخت نقش و دیتابیس تننت با خطا مواجه شد (${(err as { code?: string }).code ?? 'unknown'})`);
    }
    return { user, password };
  }

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

  async dropDatabase(host: string, port: number, dbName: string, role?: string | null): Promise<void> {
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
    if (role) await dropTenantRole({ host, port }, role).catch((e) => this.logger.warn(`could not drop tenant role: ${(e as { code?: string }).code ?? 'error'}`));
  }

  /**
   * Applies every pending tenant migration (prisma/tenant/migrations). Always runs with the PRIVILEGED
   * connection (DDL, extensions); when the tenant has its own role (`role`), ownership of whatever the
   * migration created is handed to that role afterwards so the app (which connects as the role) can use it.
   */
  async applyTenantSchema(host: string, port: number, dbName: string, role?: string | null): Promise<void> {
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
    if (role) {
      try {
        await reownTenantDatabase({ host, port }, dbName, role);
      } catch (err) {
        throw new InternalServerErrorException(`انتقال مالکیت اشیای دیتابیس تننت به نقش اختصاصی ناموفق بود (${(err as { code?: string }).code ?? 'unknown'})`);
      }
    }
  }
}
