-- Recruitment offer: کد ملی و تصویر کارت ملی متقاضی — هنگام پذیرش شرایط همکاری
-- در فرم عمومی ثبت می‌شود. تصویر به‌صورت data URL (base64) ذخیره می‌شود، مطابق
-- الگوی موجود CompanyStampService (بدون فضای ذخیره‌سازی فایل جداگانه در این کدبیس).
-- افزودنی و nullable — سوابق موجود بدون تغییر می‌مانند.
ALTER TABLE "recruitment_offers" ADD COLUMN "nationalId" TEXT;
ALTER TABLE "recruitment_offers" ADD COLUMN "idCardImage" TEXT;
