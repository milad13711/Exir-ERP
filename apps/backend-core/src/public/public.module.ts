import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { PublicSignupService } from './public-signup.service.js';
import { PublicSignupController } from './public-signup.controller.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicBookingService } from './public-booking.service.js';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicTrackingService } from './public-tracking.service.js';
import { PublicTrackingController } from './public-tracking.controller.js';
import { PublicContractsService } from './public-contracts.service.js';
import { PublicContractsController } from './public-contracts.controller.js';
import { PublicBookingPaymentController } from './public-booking-payment.controller.js';

@Module({
  imports: [AuthModule, TenantsModule, BookingModule, ContractsModule],
  controllers: [
    PublicSignupController,
    PublicCatalogController,
    PublicBookingController,
    PublicTrackingController,
    PublicContractsController,
    PublicBookingPaymentController,
  ],
  providers: [PublicSignupService, PublicBookingService, PublicTrackingService, PublicContractsService],
})
export class PublicModule {}
