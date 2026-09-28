-- HR: تاریخ تولد پرسنل — nullable، افزودنی (سوابق موجود بدون تغییر می‌مانند).
ALTER TABLE "hr_employees" ADD COLUMN "birthDate" TIMESTAMP(3);
