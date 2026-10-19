-- قیمت پایه‌ی دلاری ماژول‌های تازه (منبع: src/modules-catalog/module-license-usd.ts).
-- تا امروز برای این ماژول‌ها licenseUsd در دیتابیس صفر بود و همگام‌ساز قیمت آن‌ها را نادیده می‌گرفت
-- (قیمت تومانیِ قدیمی seed می‌ماند). تومان را همگام‌ساز روی استارت از روی همین عدد و نرخ روز می‌سازد.
UPDATE "module_definitions" SET "licenseUsd" = 350 WHERE "code" = 'proposals';
UPDATE "module_definitions" SET "licenseUsd" = 450 WHERE "code" = 'tax';
UPDATE "module_definitions" SET "licenseUsd" = 290 WHERE "code" = 'messenger';
UPDATE "module_definitions" SET "licenseUsd" = 230 WHERE "code" = 'operations';
UPDATE "module_definitions" SET "licenseUsd" = 380 WHERE "code" = 'dispatch';
