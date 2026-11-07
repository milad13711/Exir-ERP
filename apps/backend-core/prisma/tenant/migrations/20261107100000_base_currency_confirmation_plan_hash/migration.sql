-- کد تأیید تغییر ارز پایه به یک «طرح» مشخص بسته می‌شود (افزودنی).
ALTER TABLE "base_currency_confirmations" ADD COLUMN IF NOT EXISTS "planHash" TEXT;
