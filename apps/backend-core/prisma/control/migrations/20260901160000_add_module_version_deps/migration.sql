-- AlterTable
ALTER TABLE "module_definitions" ADD COLUMN "version" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[];
