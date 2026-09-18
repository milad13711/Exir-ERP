import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { UsersModule } from '../users/users.module.js';
import { ResellersController } from './resellers.controller.js';
import { ResellersService } from './resellers.service.js';
import { ResellerSelfController } from './reseller-self.controller.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, UsersModule],
  controllers: [ResellersController, ResellerSelfController],
  providers: [ResellersService],
  exports: [ResellersService],
})
export class ReferralMarketingModule {}
