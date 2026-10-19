-- چیدمان داشبورد (شرکتی + شخصی) — فقط افزایشی؛ بدون OWNED BY / تغییر مالکیت.
CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL DEFAULT '',
  "layout" JSONB NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_layouts_scope_ownerKey_key" ON "dashboard_layouts"("scope", "ownerKey");
