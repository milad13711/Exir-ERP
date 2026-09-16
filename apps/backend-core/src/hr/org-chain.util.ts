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
