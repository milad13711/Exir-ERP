import { TenantPublicKeyService } from '../common/tenant-public-key.js';
import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Global()
@Module({
  providers: [ControlPrismaService, TenantPrismaService, TenantPublicKeyService],
  exports: [ControlPrismaService, TenantPrismaService, TenantPublicKeyService],
})
export class PrismaModule {}
