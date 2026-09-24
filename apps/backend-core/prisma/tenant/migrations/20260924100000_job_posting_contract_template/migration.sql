ALTER TABLE "recruitment_job_postings" ADD COLUMN "contractTemplateId" TEXT;

ALTER TABLE "recruitment_job_postings" ADD CONSTRAINT "recruitment_job_postings_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
