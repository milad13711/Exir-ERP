/**
 * Runs once, before the app starts serving, inside every on-premise
 * container (see docker-entrypoint.sh). Idempotent: does nothing once a
 * tenant already exists locally, so it's safe to run on every restart.
 *
 * Turns a bare license + a few env vars into a fully working, single-tenant
 * instance: provisions the local tenant database, seeds default roles, and
 * grants exactly the modules the license allows — with no manual admin API
 * calls required on the customer's server.
 *
 * IMPORTANT: this file must be compiled by `nest build` (tsc) and run as
 * plain compiled JS (`node dist/scripts/bootstrap-on-premise.js`), never via
 * tsx/esbuild — esbuild's `emitDecoratorMetadata` support is incomplete and
 * silently breaks NestJS's constructor-injection (it resolved
 * TenantsService's ControlPrismaService dependency as `undefined` under tsx
 * during testing, with no error until first use). tsc does not have this
 * problem, which is why this script lives under src/, not scripts/.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { LicenseRuntimeService } from '../licensing/license-runtime.service.js';

const logger = new Logger('BootstrapOnPremise');

async function main() {
  if (process.env.DEPLOYMENT_MODE !== 'ON_PREMISE') {
    logger.log('DEPLOYMENT_MODE is not ON_PREMISE — nothing to bootstrap, exiting.');
    return;
  }

  if (!process.env.LICENSE_KEY || !process.env.LICENSE_PUBLIC_KEY_PEM) {
    logger.error('LICENSE_KEY / LICENSE_PUBLIC_KEY_PEM missing — cannot bootstrap without a valid license.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const controlDb = app.get(ControlPrismaService);
    const tenants = app.get(TenantsService);


    const existingCount = await controlDb.tenant.count();
    if (existingCount > 0) {
      logger.log('A tenant already exists in this deployment — skipping bootstrap.');
      return;
    }

    // مجوز از روی توکن امضاشده (فعال‌سازی آنلاین یا توکن آفلاین) گرفته می‌شود؛ بدون لایسنس معتبر هیچ تننتی ساخته نمی‌شود.
    const licenseRuntime = app.get(LicenseRuntimeService);
    await licenseRuntime.ready();
    const licensedModules = licenseRuntime.licensedModules();
    const licensedOrg = licenseRuntime.licensedOrgName();
    if (licenseRuntime.isBlocked() || !licensedModules || !licensedOrg) {
      logger.error(`License is not valid, refusing to bootstrap: ${JSON.stringify(licenseRuntime.getStatus())}`);
      process.exit(1);
    }
    const license = { modules: licensedModules, orgName: licensedOrg };

    const ownerPhone = process.env.ON_PREM_OWNER_PHONE;
    const ownerName = process.env.ON_PREM_OWNER_NAME;
    if (!ownerPhone || !ownerName) {
      logger.error(
        'ON_PREM_OWNER_PHONE and ON_PREM_OWNER_NAME must be set to bootstrap the first admin account.',
      );
      process.exit(1);
    }

    const slug = (process.env.ON_PREM_ORG_SLUG ?? 'local').toLowerCase();
    const orgName = process.env.ON_PREM_ORG_NAME ?? license.orgName;

    logger.log(`Provisioning on-premise tenant "${orgName}" (${slug}) for ${ownerName}...`);
    const admin = await controlDb.adminUser.findFirst({ orderBy: { createdAt: 'asc' } });
    const tenant = await tenants.createTenant(
      { name: orgName, slug, ownerPhone, ownerName, planCode: 'on_premise' },
      admin ? { type: 'admin_user', id: admin.id } : { type: 'system', id: null },
    );

    const moduleDefs = await controlDb.moduleDefinition.findMany({
      where: { code: { in: license.modules } },
    });
    await controlDb.tenantModule.createMany({
      data: moduleDefs.map((m) => ({ tenantId: tenant.id, moduleId: m.id, status: 'INSTALLED' })),
      skipDuplicates: true,
    });

    logger.log(
      `Bootstrap complete: tenant "${orgName}" ready with ${moduleDefs.length} licensed module(s): ${license.modules.join(', ')}.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  logger.error('Bootstrap failed', err as Error);
  process.exit(1);
});
