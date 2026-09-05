-- CreateEnum
CREATE TYPE "ShipmentSourceType" AS ENUM ('MANUAL', 'STOCK_MOVEMENT', 'SALES_INVOICE');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'OFFERED', 'ACCEPTED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentOfferStatus" AS ENUM ('SCHEDULED', 'PENDING', 'ACCEPTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "fleet_drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicleType" TEXT,
    "plateNumber" TEXT,
    "capacityKg" INTEGER,
    "serviceAreas" TEXT[],
    "availableHoursNote" TEXT,
    "reliabilityNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_shipments" (
    "id" TEXT NOT NULL,
    "shipmentNo" SERIAL NOT NULL,
    "sourceType" "ShipmentSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceStockMovementId" TEXT,
    "sourceInvoiceId" TEXT,
    "contactId" TEXT,
    "cargoType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "deliveryAddress" TEXT NOT NULL,
    "region" TEXT,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "driverId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_shipment_offers" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "ShipmentOfferStatus" NOT NULL DEFAULT 'SCHEDULED',
    "publicToken" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_shipment_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_delivery_surveys" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "driverRating" INTEGER,
    "productRating" INTEGER,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_delivery_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleet_drivers_isActive_idx" ON "fleet_drivers"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_shipments_shipmentNo_key" ON "fleet_shipments"("shipmentNo");

-- CreateIndex
CREATE INDEX "fleet_shipments_status_idx" ON "fleet_shipments"("status");

-- CreateIndex
CREATE INDEX "fleet_shipments_createdAt_idx" ON "fleet_shipments"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_shipment_offers_publicToken_key" ON "fleet_shipment_offers"("publicToken");

-- CreateIndex
CREATE INDEX "fleet_shipment_offers_shipmentId_idx" ON "fleet_shipment_offers"("shipmentId");

-- CreateIndex
CREATE INDEX "fleet_shipment_offers_status_idx" ON "fleet_shipment_offers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_delivery_surveys_shipmentId_key" ON "fleet_delivery_surveys"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_delivery_surveys_publicToken_key" ON "fleet_delivery_surveys"("publicToken");

-- AddForeignKey
ALTER TABLE "fleet_shipments" ADD CONSTRAINT "fleet_shipments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_shipments" ADD CONSTRAINT "fleet_shipments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "fleet_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_shipments" ADD CONSTRAINT "fleet_shipments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_shipment_offers" ADD CONSTRAINT "fleet_shipment_offers_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_shipment_offers" ADD CONSTRAINT "fleet_shipment_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "fleet_drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_delivery_surveys" ADD CONSTRAINT "fleet_delivery_surveys_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
