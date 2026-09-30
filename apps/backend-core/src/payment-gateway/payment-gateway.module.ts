import { Module } from '@nestjs/common';
import { PaymentGatewayController } from './payment-gateway.controller.js';
import { PaymentGatewaySettingsService } from './payment-gateway-settings.service.js';
import { PaymentGatewayService } from './payment-gateway.service.js';
import { ZarinpalGatewayProvider } from './providers/zarinpal.provider.js';
import { BitpayGatewayProvider } from './providers/bitpay.provider.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';

/**
 * زیرساخت عمومی «درگاه پرداخت» — هر ماژول دیگری که نیاز به گرفتن پول آنلاین
 * دارد (رزرو/نوبت‌دهی، فاکتور فروش، فروشگاه آنلاین، بلیت رویداد، منتورینگ...)
 * این ماژول را import می‌کند و از PaymentGatewayService (export شده در پایین)
 * استفاده می‌کند — نه از ZarinpalService سطح کنترل‌پلین. مهاجرت مصرف‌کننده‌های
 * فعلی (که هرکدام پیاده‌سازی مستقل خودشان را دارند) عمداً خارج از دامنه‌ی این تغییر است.
 */
@Module({
  imports: [ModuleGuardModule],
  controllers: [PaymentGatewayController],
  providers: [PaymentGatewaySettingsService, PaymentGatewayService, ZarinpalGatewayProvider, BitpayGatewayProvider],
  exports: [PaymentGatewaySettingsService, PaymentGatewayService],
})
export class PaymentGatewayModule {}
