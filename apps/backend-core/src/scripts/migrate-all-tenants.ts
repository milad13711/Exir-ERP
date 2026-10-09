/**
 * Runs on every container start (see docker-entrypoint.sh), right after the
 * Control Plane migration/seed step. Applies any pending `prisma/tenant`
 * migrations to every tenant's own database.
 *
 * Why this exists: `TenantDbAdminService.applyTenantSchema` was previously
 * only ever called once, at tenant-creation time — a schema change added
 * after a tenant already existed had to be applied by hand (a manual
 * `prisma migrate deploy` per tenant, run over SSH). That's fine with one
 * tenant; it does not scale, and it's easy to forget. `migrate deploy` is
 * idempotent (only applies migrations not yet recorded for that database),
 * so running it here against every tenant on every boot is always safe.
 *
 * Same "compile with tsc, run as plain JS" constraint as
 * bootstrap-on-premise.ts — see that file's docstring for why (esbuild/tsx
 * breaks NestJS constructor injection here).
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantDbAdminService } from '../tenants/tenant-db-admin.service.js';

const logger = new Logger('MigrateAllTenants');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const controlDb = app.get(ControlPrismaService);
    const dbAdmin = app.get(TenantDbAdminService);

    const tenants = await controlDb.tenant.findMany({
      select: { id: true, slug: true, dbHost: true, dbPort: true, dbName: true, dbUser: true },
    });
    if (tenants.length === 0) {
      logger.log('No tenants yet — nothing to migrate.');
      return;
    }

    logger.log(`Applying pending tenant migrations to ${tenants.length} tenant(s)...`);
    let failed = 0;
    for (const tenant of tenants) {
      try {
        await dbAdmin.applyTenantSchema(tenant.dbHost, tenant.dbPort, tenant.dbName, tenant.dbUser);
      } catch (err) {
        failed += 1;
        // One tenant's DB being unreachable/broken must not block the rest,
        // or the server, from starting — log it loudly and move on.
        logger.error(`Migration failed for tenant "${tenant.slug}" (${tenant.id}): ${(err as Error).message}`);
      }
    }
    logger.log(`Tenant migrations done: ${tenants.length - failed} succeeded, ${failed} failed.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('migrate-all-tenants failed', err as Error);
  process.exit(1);
});
