-- محل برگزاری خدمت (آدرس شرکت / محل مشتری / آنلاین) — additive
ALTER TABLE "service_types" ADD COLUMN "locationMode" TEXT NOT NULL DEFAULT 'OFFICE';
