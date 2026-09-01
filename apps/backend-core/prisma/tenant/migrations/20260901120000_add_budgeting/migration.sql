-- CreateTable
CREATE TABLE "accounting_budgets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_budgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounting_budgets_periodStart_idx" ON "accounting_budgets"("periodStart");

ALTER TABLE "accounting_budgets" ADD CONSTRAINT "accounting_budgets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "accounting_budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "accounting_budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_budget_lines_budgetId_accountId_key" ON "accounting_budget_lines"("budgetId", "accountId");

ALTER TABLE "accounting_budget_lines" ADD CONSTRAINT "accounting_budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "accounting_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_budget_lines" ADD CONSTRAINT "accounting_budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
