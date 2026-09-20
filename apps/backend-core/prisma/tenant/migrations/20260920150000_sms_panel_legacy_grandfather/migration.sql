-- تننت‌هایی که از قبل کاربر دارند تا وقتی پنل پیامکی خودشان را انتخاب نکرده‌اند مثل گذشته
-- از پنل اصلی ارسال می‌کنند (LEGACY). تننت تازه (بدون کاربر در لحظه‌ی مایگریشن) این ردیف را نمی‌گیرد.
INSERT INTO "module_settings" ("id", "moduleCode", "key", "value", "updatedAt")
SELECT gen_random_uuid()::text, 'sms-panel', 'connection', '{"mode":"LEGACY"}'::jsonb, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users")
  AND NOT EXISTS (SELECT 1 FROM "module_settings" WHERE "moduleCode" = 'sms-panel' AND "key" = 'connection');
