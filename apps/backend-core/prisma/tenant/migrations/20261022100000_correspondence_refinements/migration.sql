-- مکاتبات: بلوک امضای قابل‌ویرایش (سمت/شرکت/نام/پیشوند/نمایش تاریخ) — فقط افزایشی، بدون تغییر مالکیت.
ALTER TABLE "corr_letters" ADD COLUMN IF NOT EXISTS "signatureBlock" JSONB;
