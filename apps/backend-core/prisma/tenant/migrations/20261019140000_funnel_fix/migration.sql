-- اصلاح چرخه‌ی عمر قیف فروش: رد صلاحیت سرنخ (با دلیل)، زمان‌های تبدیل/واجد‌شرایط شدن،
-- و ترمیم داده‌های ناسازگار قبلی. افزودنی و idempotent؛ هیچ داده‌ای حذف نمی‌شود،
-- هیچ عبارت حساس به مالکیت (OWNER TO / GRANT) ندارد.

ALTER TYPE "CrmFunnelStage" ADD VALUE IF NOT EXISTS 'DISQUALIFIED';

ALTER TABLE "crm_contacts"
  ADD COLUMN IF NOT EXISTS "qualifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disqualifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disqualifyReason" TEXT;

DO $$
DECLARE
  n_counts integer := 0;
  n_stage integer := 0;
  n_won integer := 0;
  n_converted integer := 0;
BEGIN
  -- ۱) شمارنده‌ی خرید از روی فاکتورهای «پرداخت‌شده» (فقط بالا می‌برد، هرگز کم نمی‌کند).
  WITH paid AS (
    SELECT "contactId", COUNT(*)::int AS n,
           MIN(COALESCE("confirmedAt", "issuedAt")) AS first_at,
           MAX(COALESCE("confirmedAt", "issuedAt")) AS last_at
    FROM "sales_invoices" WHERE "status" = 'PAID' GROUP BY "contactId"
  )
  UPDATE "crm_contacts" c
  SET "purchaseCount" = p.n,
      "firstPurchaseAt" = COALESCE(c."firstPurchaseAt", p.first_at),
      "lastPurchaseAt" = COALESCE(c."lastPurchaseAt", p.last_at)
  FROM paid p
  WHERE p."contactId" = c."id" AND p.n > c."purchaseCount";
  GET DIAGNOSTICS n_counts = ROW_COUNT;

  -- ۲) سرنخ‌های دارای خرید → مشتری (۱ خرید) / خرید تکراری (≥۲ خرید)، با ثبت رویداد قیف.
  WITH todo AS (
    SELECT "id", "funnelStage" AS old_stage,
           (CASE WHEN "isBrandAmbassador" AND "purchaseCount" >= 2 THEN 'BRAND_AMBASSADOR'
                 WHEN "purchaseCount" >= 2 THEN 'REPEAT_CUSTOMER'
                 ELSE 'CUSTOMER' END)::"CrmFunnelStage" AS new_stage
    FROM "crm_contacts"
    WHERE "purchaseCount" >= 1
      AND ("funnelStage" IN ('NEW_LEAD', 'CONTACTED', 'QUALIFIED')
           OR ("funnelStage" = 'CUSTOMER' AND "purchaseCount" >= 2))
  ), upd AS (
    UPDATE "crm_contacts" c
    SET "funnelStage" = t.new_stage,
        "isCustomer" = true,
        "convertedAt" = COALESCE(c."convertedAt", c."firstPurchaseAt", c."createdAt")
    FROM todo t WHERE c."id" = t."id"
    RETURNING c."id"
  )
  INSERT INTO "crm_funnel_stage_events" ("id", "contactId", "fromStage", "toStage", "occurredAt")
  SELECT gen_random_uuid()::text, t."id", t.old_stage, t.new_stage, now()
  FROM todo t JOIN upd u ON u."id" = t."id"
  WHERE t.old_stage <> t.new_stage;
  GET DIAGNOSTICS n_stage = ROW_COUNT;

  -- ۳) سرنخ‌هایی که یک فرصت «برد شده» دارند ولی هنوز سرنخ‌اند → مشتری.
  WITH won AS (
    SELECT "contactId", MIN(COALESCE("closedAt", "createdAt")) AS won_at
    FROM "crm_deals" WHERE "stage" = 'WON' GROUP BY "contactId"
  ), todo AS (
    SELECT c."id", c."funnelStage" AS old_stage, w.won_at
    FROM "crm_contacts" c JOIN won w ON w."contactId" = c."id"
    WHERE c."funnelStage" IN ('NEW_LEAD', 'CONTACTED', 'QUALIFIED') AND c."purchaseCount" = 0
  ), upd AS (
    UPDATE "crm_contacts" c
    SET "funnelStage" = 'CUSTOMER', "isCustomer" = true,
        "convertedAt" = COALESCE(c."convertedAt", t.won_at)
    FROM todo t WHERE c."id" = t."id"
    RETURNING c."id"
  )
  INSERT INTO "crm_funnel_stage_events" ("id", "contactId", "fromStage", "toStage", "occurredAt")
  SELECT gen_random_uuid()::text, t."id", t.old_stage, 'CUSTOMER', now()
  FROM todo t JOIN upd u ON u."id" = t."id";
  GET DIAGNOSTICS n_won = ROW_COUNT;

  -- ۴) زمان تبدیل برای همه‌ی مشتریان فعلی که ندارند.
  UPDATE "crm_contacts"
  SET "convertedAt" = COALESCE("firstPurchaseAt", "createdAt")
  WHERE "convertedAt" IS NULL
    AND ("purchaseCount" >= 1 OR "funnelStage" IN ('CUSTOMER', 'REPEAT_CUSTOMER', 'BRAND_AMBASSADOR', 'CHURN_RISK', 'CHURNED'));
  GET DIAGNOSTICS n_converted = ROW_COUNT;

  -- ۵) زمان «واجد شرایط» از روی لاگ رویدادها.
  UPDATE "crm_contacts" c
  SET "qualifiedAt" = e.last_at
  FROM (SELECT "contactId", MAX("occurredAt") AS last_at FROM "crm_funnel_stage_events" WHERE "toStage" = 'QUALIFIED' GROUP BY "contactId") e
  WHERE e."contactId" = c."id" AND c."qualifiedAt" IS NULL;

  RAISE NOTICE 'funnel_fix backfill: purchaseCount raised=%, stage repaired(from purchases)=%, stage repaired(won deals)=%, convertedAt filled=%',
    n_counts, n_stage, n_won, n_converted;
END $$;
