import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { OnlineStoreModule } from '../online-store/online-store.module.js';
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
import { PublicFleetOfferService } from './public-fleet-offer.service.js';
import { PublicFleetOfferController } from './public-fleet-offer.controller.js';
import { PublicSurveyService } from './public-survey.service.js';
import { PublicSurveyController } from './public-survey.controller.js';
import { PublicExchangeRateService } from './public-exchange-rate.service.js';
import { PublicStoreService } from './public-store.service.js';
import { PublicStoreController } from './public-store.controller.js';
import { PublicMentoringSurveyService } from './public-mentoring-survey.service.js';
import { PublicMentoringSurveyController } from './public-mentoring-survey.controller.js';
import { EventsModule } from '../events/events.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { PublicEventsService } from './public-events.service.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublicEventsPaymentController } from './public-events-payment.controller.js';
import { PublicFormsService } from './public-forms.service.js';
import { PublicFormsController } from './public-forms.controller.js';
import { WarrantyModule } from '../warranty/warranty.module.js';
import { PublicWarrantyService } from './public-warranty.service.js';
import { PublicWarrantyController } from './public-warranty.controller.js';
import { AfterSalesModule } from '../after-sales/after-sales.module.js';
import { PublicAfterSalesService } from './public-after-sales.service.js';
import { PublicAfterSalesController } from './public-after-sales.controller.js';
import { QrCodeModule } from '../qr-code/qr-code.module.js';
import { PublicQrCodeController } from './public-qr-code.controller.js';
import { PublicRecruitmentService } from './public-recruitment.service.js';
import { PublicRecruitmentController } from './public-recruitment.controller.js';
import { HrModule } from '../hr/hr.module.js';
import { PublicCertificateService } from './public-certificate.service.js';
import { PublicCertificateController } from './public-certificate.controller.js';
import { PublicLabReviewService } from '../ration-lab/public/public-lab-review.service.js';
import { PublicLabReviewController } from '../ration-lab/public/public-lab-review.controller.js';
import { PublicRationResultService } from '../ration-lab/public/public-ration-result.service.js';
import { PublicRationResultController } from '../ration-lab/public/public-ration-result.controller.js';
import { SmsModule } from '../sms/sms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    AuthModule,
    TenantsModule,
    BookingModule,
    ContractsModule,
    FleetModule,
    OnlineStoreModule,
    EventsModule,
    BillingModule,
    AutomationModule,
    WarrantyModule,
    AfterSalesModule,
    QrCodeModule,
    HrModule,
    SmsModule,
    NotificationsModule,
  ],
  controllers: [
    PublicSignupController,
    PublicCatalogController,
    PublicBookingController,
    PublicTrackingController,
    PublicContractsController,
    PublicBookingPaymentController,
    PublicFleetOfferController,
    PublicSurveyController,
    PublicStoreController,
    PublicMentoringSurveyController,
    PublicEventsController,
    PublicEventsPaymentController,
    PublicFormsController,
    PublicWarrantyController,
    PublicAfterSalesController,
    PublicQrCodeController,
    PublicRecruitmentController,
    PublicCertificateController,
    PublicLabReviewController,
    PublicRationResultController,
  ],
  providers: [
    PublicSignupService,
    PublicBookingService,
    PublicTrackingService,
    PublicContractsService,
    PublicFleetOfferService,
    PublicSurveyService,
    PublicExchangeRateService,
    PublicStoreService,
    PublicMentoringSurveyService,
    PublicEventsService,
    PublicFormsService,
    PublicWarrantyService,
    PublicAfterSalesService,
    PublicRecruitmentService,
    PublicCertificateService,
    PublicLabReviewService,
    PublicRationResultService,
  ],
})
export class PublicModule {}
