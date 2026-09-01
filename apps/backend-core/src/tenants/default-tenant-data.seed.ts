import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const MODULE_PERMISSIONS: Array<{ code: string; moduleCode: string; description: string }> = [
  { code: 'crm.manage', moduleCode: 'crm', description: 'مدیریت مشتریان و فرصت‌های فروش' },
  { code: 'warehouse.manage', moduleCode: 'warehouse', description: 'مدیریت انبار و موجودی' },
  { code: 'accounting.manage', moduleCode: 'accounting', description: 'مدیریت اسناد حسابداری' },
  { code: 'hr.manage', moduleCode: 'hr', description: 'مدیریت منابع انسانی' },
  { code: 'tasks.manage', moduleCode: 'tasks', description: 'مدیریت وظایف و یادآوری‌ها' },
  { code: 'settings.users.manage', moduleCode: 'settings', description: 'مدیریت کاربران و نقش‌ها' },
  { code: 'settings.billing.manage', moduleCode: 'settings', description: 'مدیریت اشتراک و صورتحساب' },
];

const SYSTEM_ROLES: Array<{ name: string; permissionCodes: string[] }> = [
  { name: 'مدیر سیستم', permissionCodes: MODULE_PERMISSIONS.map((p) => p.code) },
  { name: 'کارشناس فروش', permissionCodes: ['crm.manage', 'tasks.manage'] },
  { name: 'حسابدار', permissionCodes: ['accounting.manage', 'warehouse.manage'] },
  { name: 'انباردار', permissionCodes: ['warehouse.manage'] },
];

type ModuleMatrix = {
  canViewAll: boolean;
  canViewOwn: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

const FULL_ACCESS: ModuleMatrix = { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: true };
const OWN_CONTRIBUTOR: ModuleMatrix = { canViewAll: false, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false };

// Default access matrix per system role, per module — an admin can
// reconfigure this later from Settings → Roles; these are just the
// sensible starting point a fresh tenant gets.
const DEFAULT_MODULE_PERMISSIONS: Record<string, Record<string, ModuleMatrix>> = {
  'مدیر سیستم': {
    crm: FULL_ACCESS,
    accounting: FULL_ACCESS,
    warehouse: FULL_ACCESS,
    hr: FULL_ACCESS,
    tasks: FULL_ACCESS,
    sales: FULL_ACCESS,
    purchasing: FULL_ACCESS,
  },
  'کارشناس فروش': {
    crm: { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false },
    tasks: OWN_CONTRIBUTOR,
    sales: { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false },
    // View-only: needed to browse the product catalog when picking line items for an invoice.
    warehouse: { canViewAll: true, canViewOwn: true, canCreate: false, canEdit: false, canDelete: false },
  },
  حسابدار: {
    accounting: { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false },
    warehouse: { canViewAll: true, canViewOwn: true, canCreate: false, canEdit: false, canDelete: false },
    sales: { canViewAll: true, canViewOwn: true, canCreate: false, canEdit: true, canDelete: false },
    purchasing: { canViewAll: true, canViewOwn: true, canCreate: false, canEdit: true, canDelete: false },
    tasks: OWN_CONTRIBUTOR,
  },
  انباردار: {
    warehouse: OWN_CONTRIBUTOR,
    purchasing: { canViewAll: true, canViewOwn: true, canCreate: true, canEdit: true, canDelete: false },
    tasks: OWN_CONTRIBUTOR,
  },
};

/** Applied once, right after a tenant database is created and migrated. */
export async function seedDefaultTenantData(db: TenantPrismaClient): Promise<void> {
  for (const perm of MODULE_PERMISSIONS) {
    await db.permission.upsert({
      where: { code: perm.code },
      create: perm,
      update: {},
    });
  }

  for (const role of SYSTEM_ROLES) {
    const created = await db.role.upsert({
      where: { name: role.name },
      create: {
        name: role.name,
        isSystem: true,
        permissions: {
          create: role.permissionCodes.map((code) => ({
            permission: { connect: { code } },
          })),
        },
      },
      update: {},
    });

    const matrix = DEFAULT_MODULE_PERMISSIONS[role.name] ?? {};
    for (const [moduleCode, access] of Object.entries(matrix)) {
      await db.modulePermission.upsert({
        where: { roleId_moduleCode: { roleId: created.id, moduleCode } },
        create: { roleId: created.id, moduleCode, ...access },
        update: {},
      });
    }
  }
}

/** Returns the id of the given system role, e.g. to assign it to the tenant owner. */
export async function getSystemRoleId(db: TenantPrismaClient, name: string): Promise<string> {
  const role = await db.role.findUniqueOrThrow({ where: { name } });
  return role.id;
}
