-- شهر و محصول نماینده — برای نقشه‌ی نمایندگان در eta.co.ir (فقط تننت رجیستری پلتفرم استفاده می‌کند).

CREATE TYPE "ResellerProductCode" AS ENUM ('ERP', 'REAL_ESTATE', 'SMS_GATEWAY', 'OTHER');

ALTER TABLE "reseller_profiles" ADD COLUMN "city" TEXT;
ALTER TABLE "reseller_profiles" ADD COLUMN "productCode" "ResellerProductCode";
