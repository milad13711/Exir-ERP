-- CreateEnum
CREATE TYPE "ProjectStageStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'DONE', 'REJECTED');

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "project_stage_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_stage_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_stage_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "project_stage_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_stages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ProjectStageStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3),
    "requestedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "rejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_stage_template_items_templateId_idx" ON "project_stage_template_items"("templateId");

-- CreateIndex
CREATE INDEX "project_stages_projectId_idx" ON "project_stages"("projectId");

-- CreateIndex
CREATE INDEX "sales_invoices_projectId_idx" ON "sales_invoices"("projectId");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stage_template_items" ADD CONSTRAINT "project_stage_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_stage_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
