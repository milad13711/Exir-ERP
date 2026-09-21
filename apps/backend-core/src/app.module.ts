import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { AuthModule } from './auth/auth.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { AdminModule } from './admin/admin.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';
import { ProductionModule } from './production/production.module.js';
import { QualityControlModule } from './quality-control/quality-control.module.js';
import { RationLabModule } from './ration-lab/ration-lab.module.js';
import { BillingModule } from './billing/billing.module.js';
import { ModulesCatalogModule } from './modules-catalog/modules-catalog.module.js';
import { UsersModule } from './users/users.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { SupportModule } from './support/support.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { CrmModule } from './crm/crm.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { WarehouseModule } from './warehouse/warehouse.module.js';
import { HrModule } from './hr/hr.module.js';
import { LicensingModule } from './licensing/licensing.module.js';
import { LicenseGuard } from './licensing/license.guard.js';
import { SettingsModule } from './settings/settings.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SalesModule } from './sales/sales.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { ChecksModule } from './checks/checks.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { VoipModule } from './voip/voip.module.js';
import { PublicModule } from './public/public.module.js';
import { BookingModule } from './booking/booking.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { OnlineStoreModule } from './online-store/online-store.module.js';
import { MarketingModule } from './marketing/marketing.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { MentoringModule } from './mentoring/mentoring.module.js';
import { EventsModule } from './events/events.module.js';
import { FormsModule } from './forms/forms.module.js';
import { WarrantyModule } from './warranty/warranty.module.js';
import { AfterSalesModule } from './after-sales/after-sales.module.js';
import { QrCodeModule } from './qr-code/qr-code.module.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { RecruitmentModule } from './recruitment/recruitment.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReferralMarketingModule } from './referral-marketing/referral-marketing.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 604800) },
    }),
    PrismaModule,
    AuthModule,
    TenantsModule,
    PublicModule,
    BookingModule,
    ContractsModule,
    ProjectsModule,
    FleetModule,
    OnlineStoreModule,
    MarketingModule,
    OnboardingModule,
    MentoringModule,
    EventsModule,
    FormsModule,
    WarrantyModule,
    AfterSalesModule,
    QrCodeModule,
    ApprovalsModule,
    RecruitmentModule,
    ReportsModule,
    ReferralMarketingModule,
    AdminModule,
    WorkspaceModule,
    ProductionModule,
    QualityControlModule,
    RationLabModule,
    AutomationModule,
    VoipModule,
    BillingModule,
    ModulesCatalogModule,
    UsersModule,
    TasksModule,
    SupportModule,
    ActivityModule,
    CrmModule,
    AccountingModule,
    WarehouseModule,
    HrModule,
    LicensingModule,
    SettingsModule,
    ApiKeysModule,
    WebhooksModule,
    McpModule,
    NotificationsModule,
    SalesModule,
    PurchasingModule,
    ChecksModule,
    DashboardModule,
    AttachmentsModule,
    ExchangeRatesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
