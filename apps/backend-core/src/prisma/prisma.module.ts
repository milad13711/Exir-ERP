import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Global()
@Module({
  providers: [ControlPrismaService, TenantPrismaService],
  exports: [ControlPrismaService, TenantPrismaService],
})
export class PrismaModule {}
