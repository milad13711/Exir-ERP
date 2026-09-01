-- AlterTable
ALTER TABLE "module_definitions" ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[];
