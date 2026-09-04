import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { PublicSignupService } from './public-signup.service.js';
import { PublicSignupController } from './public-signup.controller.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicBookingService } from './public-booking.service.js';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicTrackingService } from './public-tracking.service.js';
import { PublicTrackingController } from './public-tracking.controller.js';

@Module({
  imports: [AuthModule, TenantsModule, BookingModule],
  controllers: [
    PublicSignupController,
    PublicCatalogController,
    PublicBookingController,
    PublicTrackingController,
  ],
  providers: [PublicSignupService, PublicBookingService, PublicTrackingService],
})
export class PublicModule {}
