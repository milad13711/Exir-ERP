-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "lastCheckInAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckInIp" TEXT;
