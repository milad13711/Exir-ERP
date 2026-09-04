-- CreateTable
CREATE TABLE "voip_provider_config" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voip_provider_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voip_extensions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extension" TEXT NOT NULL,

    CONSTRAINT "voip_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voip_extensions_userId_key" ON "voip_extensions"("userId");

-- AddForeignKey
ALTER TABLE "voip_extensions" ADD CONSTRAINT "voip_extensions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
