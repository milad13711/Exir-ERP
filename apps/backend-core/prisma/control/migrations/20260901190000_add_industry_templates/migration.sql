-- CreateTable
CREATE TABLE "industry_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roles" JSONB NOT NULL,
    "chartOfAccounts" JSONB NOT NULL,
    "productCategories" JSONB NOT NULL,
    "orgChart" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "industry_templates_code_key" ON "industry_templates"("code");
