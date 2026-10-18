import type { TenantRequestContext } from '../common/request-context.js';

/**
 * Walks the manager chain upward from `employeeId` and returns true if
 * `candidateManagerEmployeeId` appears anywhere above it — i.e. is the
 * employee's direct manager OR any manager further up the org chart, not
 * just the immediate one. Bounded to a sane depth as a guard against a
 * corrupted/cyclic managerId chain.
 */
export async function isInManagerChain(
  tenantDb: TenantRequestContext['tenantDb'],
  employeeId: string,
  candidateManagerEmployeeId: string,
): Promise<boolean> {
  let currentId: string | null = employeeId;
  for (let depth = 0; depth < 20 && currentId; depth++) {
    const current: { managerId: string | null } | null = await tenantDb.employee.findUnique({
      where: { id: currentId },
      select: { managerId: true },
    });
    if (!current?.managerId) return false;
    if (current.managerId === candidateManagerEmployeeId) return true;
    currentId = current.managerId;
  }
  return false;
}

/**
 * Which Employee rows `currentEmployeeId` is allowed to see the full
 * personnel file (documents included) of, when their role only grants
 * `canViewOwn` on the "hr" module (canViewAll is checked by the caller
 * BEFORE calling this — a null return here means "no filter needed").
 *
 * Two independent paths grant visibility, matching how the business
 * actually works: (1) every descendant in the management chain, at any
 * depth, not just direct reports — an upper manager sees everyone below
 * them; (2) every employee in a Department this employee is the
 * designated manager of, regardless of whether they're also in that
 * employee's direct reporting chain (a unit manager oversees the whole
 * unit's files, org-chart position aside).
 */
export async function getVisibleEmployeeIds(
  tenantDb: TenantRequestContext['tenantDb'],
  currentEmployeeId: string,
): Promise<Set<string>> {
  const visible = new Set<string>([currentEmployeeId]);

  // (1) BFS downward through directReports, all generations.
  let frontier = [currentEmployeeId];
  for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
    const reports = await tenantDb.employee.findMany({
      where: { managerId: { in: frontier } },
      select: { id: true },
    });
    frontier = reports.map((r) => r.id).filter((id) => !visible.has(id));
    frontier.forEach((id) => visible.add(id));
  }

  // (2) Every member of a department this employee manages.
  const managedDepartments = await tenantDb.department.findMany({
    where: { managerId: currentEmployeeId },
    select: { employees: { select: { id: true } } },
  });
  for (const dept of managedDepartments) {
    for (const emp of dept.employees) visible.add(emp.id);
  }

  return visible;
}

/**
 * Employee ids ABOVE `employeeId` in the management chain (direct manager,
 * their manager, ...). Bounded like the other walkers against cyclic data.
 */
export async function getAncestorEmployeeIds(
  tenantDb: TenantRequestContext['tenantDb'],
  employeeId: string,
): Promise<Set<string>> {
  const ancestors = new Set<string>();
  let currentId: string | null = employeeId;
  for (let depth = 0; depth < 20 && currentId; depth++) {
    const current: { managerId: string | null } | null = await tenantDb.employee.findUnique({
      where: { id: currentId },
      select: { managerId: true },
    });
    const next: string | null = current?.managerId ?? null;
    if (!next || next === employeeId || ancestors.has(next)) break;
    ancestors.add(next);
    currentId = next;
  }
  return ancestors;
}

/**
 * Tenant-User ids of everyone BELOW the given user in the organisation:
 * all generations of direct reports plus members of departments the user
 * heads (see getVisibleEmployeeIds). The user themself is excluded, and so is
 * anyone who is also ABOVE them in the chain (a corrupted/odd setup where a
 * department head is the user's own boss must never reveal the boss's data).
 * A user without a linked Employee record has no subordinates.
 * Used for the hierarchical «مشاهده‌ی همه» of the reports module.
 */
export async function getSubordinateUserIds(
  tenantDb: TenantRequestContext['tenantDb'],
  userId: string,
): Promise<string[]> {
  const self = await tenantDb.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!self) return [];
  const [visible, ancestors] = await Promise.all([getVisibleEmployeeIds(tenantDb, self.id), getAncestorEmployeeIds(tenantDb, self.id)]);
  visible.delete(self.id);
  for (const a of ancestors) visible.delete(a);
  if (visible.size === 0) return [];
  const rows = await tenantDb.employee.findMany({ where: { id: { in: [...visible] }, userId: { not: null } }, select: { userId: true } });
  return rows.map((r) => r.userId as string).filter((id) => id !== userId);
}
