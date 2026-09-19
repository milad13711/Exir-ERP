ALTER TABLE "recruitment_job_postings" ADD COLUMN "contractId" TEXT;
ALTER TABLE "recruitment_job_postings" ADD CONSTRAINT "recruitment_job_postings_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "module_approvers" (
  "moduleCode" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "module_approvers_pkey" PRIMARY KEY ("moduleCode")
);
ALTER TABLE "module_approvers" ADD CONSTRAINT "module_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
