-- ماژول فروش و فاکتور از حسابداری مستقل شد (حسابداری فقط در صورت نصب سند می‌گیرد).
-- seed هم همین را اعمال می‌کند؛ این مایگریشن برای محیط‌هایی است که seed را اجرا نمی‌کنند.
UPDATE "module_definitions" SET "dependsOn" = ARRAY['crm']::TEXT[] WHERE "code" = 'sales';
-- چک سندش را در دفتر کل می‌زند؛ وابستگی که قبلاً از مسیر فروش انتقالی تأمین می‌شد صریح شد.
UPDATE "module_definitions" SET "dependsOn" = ARRAY['crm', 'sales', 'accounting']::TEXT[] WHERE "code" = 'checks';
