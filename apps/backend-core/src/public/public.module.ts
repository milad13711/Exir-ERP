import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { PublicSignupService } from './public-signup.service.js';
import { PublicSignupController } from './public-signup.controller.js';
import { PublicCatalogController } from './public-catalog.controller.js';

@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [PublicSignupController, PublicCatalogController],
  providers: [PublicSignupService],
})
export class PublicModule {}
