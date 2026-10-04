import { describe, expect, it, vi } from 'vitest';
import { DashboardCalendarService, type CalendarAccess } from './dashboard-calendar.service.js';

const ME = 'user-me';

function makeCtx() {
  const find = () => vi.fn(async () => [] as unknown[]);
  const tenantDb = {
    employee: { findMany: find() },
    crmContact: { findMany: find() },
    task: { findMany: find() },
    jobInterview: { findMany: find() },
    mentoringSession: { findMany: find() },
    salesInvoice: { findMany: find() },
    check: { findMany: find() },
    contract: { findMany: find() },
    dashboardReminder: { findMany: find() },
  };
  return { tenantDb, auth: { type: 'user', sub: 'g1', role: 'MEMBER' } } as any;
}

const allNone: CalendarAccess['scope'] = {
  'birthday-employee': 'none',
  'birthday-contact': 'none',
  task: 'none',
  interview: 'none',
  'mentoring-session': 'none',
  'invoice-due': 'none',
  'check-due': 'none',
  'contract-end': 'none',
};

describe('DashboardCalendarService.monthCalendar scoping', () => {
  const svc = new DashboardCalendarService();

  it('own scope adds the owner field to the where clause', async () => {
    const ctx = makeCtx();
    await svc.monthCalendar(ctx, 1405, 7, { userId: ME, scope: { ...allNone, task: 'own', 'invoice-due': 'own', 'mentoring-session': 'own', interview: 'own' } });
    expect(ctx.tenantDb.task.findMany.mock.calls[0][0].where).toMatchObject({ assignedUserId: ME });
    expect(ctx.tenantDb.salesInvoice.findMany.mock.calls[0][0].where).toMatchObject({ createdByUserId: ME });
    expect(ctx.tenantDb.mentoringSession.findMany.mock.calls[0][0].where).toMatchObject({ engagement: { advisorUserId: ME } });
    expect(ctx.tenantDb.jobInterview.findMany.mock.calls[0][0].where).toMatchObject({ interviewerUserId: ME });
  });

  it('all scope adds no owner restriction', async () => {
    const ctx = makeCtx();
    await svc.monthCalendar(ctx, 1405, 7, { userId: ME, scope: { ...allNone, task: 'all' } });
    expect(ctx.tenantDb.task.findMany.mock.calls[0][0].where).not.toHaveProperty('assignedUserId');
  });

  it('none scope never queries the table', async () => {
    const ctx = makeCtx();
    await svc.monthCalendar(ctx, 1405, 7, { userId: ME, scope: allNone });
    for (const model of ['employee', 'crmContact', 'task', 'jobInterview', 'mentoringSession', 'salesInvoice', 'check', 'contract'] as const) {
      expect(ctx.tenantDb[model].findMany).not.toHaveBeenCalled();
    }
  });

  it('own scope without a local user id returns nothing and does not query', async () => {
    const ctx = makeCtx();
    await svc.monthCalendar(ctx, 1405, 7, { userId: null, scope: { ...allNone, task: 'own' } });
    expect(ctx.tenantDb.task.findMany).not.toHaveBeenCalled();
  });

  it('reminders are always filtered to the creator, even for all-scope users', async () => {
    const ctx = makeCtx();
    await svc.monthCalendar(ctx, 1405, 7, { userId: ME, scope: { ...allNone, task: 'all' } });
    expect(ctx.tenantDb.dashboardReminder.findMany.mock.calls[0][0].where).toMatchObject({ createdByUserId: ME });
  });
});
