/*
  Warnings:

  - A unique constraint covering the columns `[publicToken]` on the table `appointments` will be added. If there are existing duplicate values, this will fail.
  - The required column `publicToken` was added to the `appointments` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- CreateEnum
CREATE TYPE "AppointmentPaymentStatus" AS ENUM ('NONE', 'PENDING', 'PAID');

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_COORDINATION';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "coordinationRespondedAt" TIMESTAMP(3),
ADD COLUMN     "depositAmount" INTEGER,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentRefId" INTEGER,
ADD COLUMN     "paymentStatus" "AppointmentPaymentStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "publicToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN     "zarinpalAuthority" TEXT;

ALTER TABLE "appointments" ALTER COLUMN "publicToken" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_types" ADD COLUMN     "depositAmount" INTEGER,
ADD COLUMN     "requiresCoordination" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresDeposit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "staff_availability_slots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_availability_slots_userId_weekday_idx" ON "staff_availability_slots"("userId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_publicToken_key" ON "appointments"("publicToken");

-- AddForeignKey
ALTER TABLE "staff_availability_slots" ADD CONSTRAINT "staff_availability_slots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
