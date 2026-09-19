-- دسترسی دستی اختصاصی هر کاربر روی هر ماژول (جایگزین اتحاد نقش‌ها در همان ماژول).
CREATE TABLE "user_module_permissions" (
    "userId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "canViewAll" BOOLEAN NOT NULL DEFAULT false,
    "canViewOwn" BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "user_module_permissions_pkey" PRIMARY KEY ("userId","moduleCode")
);
ALTER TABLE "user_module_permissions" ADD CONSTRAINT "user_module_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
