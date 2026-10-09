import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/control-client/index.js';

/**
 * Single shared PrismaClient for the Control Plane database — the one
 * database that exists before any tenant database can even be located.
 */
@Injectable()
export class ControlPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: { url: process.env.CONTROL_DATABASE_URL },
      },
      // S-14: the sealed per-tenant DB password never leaves the data layer by accident (admin
      // list/detail endpoints return Tenant rows). TenantPrismaService reads it via an explicit `select`.
      omit: { tenant: { dbPasswordEnc: true } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
