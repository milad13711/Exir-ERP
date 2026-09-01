-- CreateTable
CREATE TABLE "module_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "canViewAll" BOOLEAN NOT NULL DEFAULT false,
    "canViewOwn" BOOLEAN NOT NULL DEFAULT true,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "module_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "module_permissions_roleId_moduleCode_key" ON "module_permissions"("roleId", "moduleCode");

-- AddForeignKey
ALTER TABLE "module_permissions" ADD CONSTRAINT "module_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
