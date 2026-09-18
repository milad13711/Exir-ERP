-- درخواست همکاری در فروش — از فرم عمومی eta.co.ir، بررسی و approve/reject توسط تیم مدیریت.

CREATE TYPE "ResellerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "reseller_applications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "websiteUrl" TEXT,
    "productCode" TEXT,
    "message" TEXT,
    "status" "ResellerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reseller_applications_status_idx" ON "reseller_applications"("status");

ALTER TABLE "reseller_applications" ADD CONSTRAINT "reseller_applications_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
