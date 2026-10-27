import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import type { ArchiveAccess } from './user-activity-access.js';
import {
  CORR_EVENT_EXCLUDED,
  CORR_EVENT_LABELS,
  REVISION_ENTITY_TYPES_BY_MODULE,
  TASK_EVENT_EXCLUDED,
  TASK_EVENT_LABELS,
  decodeCursor,
  eventTypesForAction,
  mapActivity,
  mapCorrEvent,
  mapOffboarding,
  mapRevision,
  mapShipmentEvent,
  mapSignature,
  mapTaskEvent,
  mergeTimelines,
  type TimelineFilters,
  type TimelineItem,
} from './user-activity.logic.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

type Where = Record<string, unknown>;

/** ماژولی که هر منبع به آن تعلق دارد (برای فیلتر «ماژول»). */
const SOURCE_MODULE = { task: 'tasks', correspondence: 'correspondence', dispatch: 'dispatch', signature: 'signature', offboarding: 'users' } as const;

/**
 * ادغام لاگ فعالیت + جدول‌های رویداد (TaskEvent، CorrEvent، ShipmentEvent، DocumentRevision، SignatureEvidence،
 * UserOffboardingRun) در یک جریان زمانیِ نزولی برای یک کاربر.
 *
 * کران‌ها: هر منبع حداکثر limit+1 ردیف (فقط ستون‌های ایمن، بدون metadata/before/after/note) با ایندکس‌های:
 *  activity_logs(userId,createdAt) و (userId,moduleCode,createdAt)، task_events(actorUserId,createdAt)،
 *  dispatch_shipment_events(actorUserId)، signature_evidences(entityType,entityId) [signerUserId بدون ایندکس — حجم کم]،
 *  document_revisions [userId بدون ایندکس — حجم کم]، corr_events [actorUserId بدون ایندکس — بررسی در گزارش].
 */
@Injectable()
export class ActivityTimelineService {
  private readonly logger = new Logger('ActivityTimeline');

  constructor(private readonly permissions: PermissionsService) {}

  static clampLimit(raw: string | number | undefined, def = DEFAULT_LIMIT, max = MAX_LIMIT): number {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
  }

  async query(
    ctx: TenantRequestContext,
    access: ArchiveAccess,
    userId: string,
    f: TimelineFilters,
    opts: { cursor?: string; limit?: number; maxLimit?: number },
  ): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
    const limit = ActivityTimelineService.clampLimit(opts.limit, DEFAULT_LIMIT, opts.maxLimit ?? MAX_LIMIT);
    const cursor = decodeCursor(opts.cursor);
    const db = ctx.tenantDb;
    const take = limit + 1;
    const created = this.createdRange(f, cursor?.at);

    const tasks: Array<Promise<TimelineItem[]>> = [this.fromActivity(db, userId, f, created, take)];
    if (this.sourceWanted(f, SOURCE_MODULE.task)) tasks.push(this.fromTaskEvents(db, userId, f, created, take));
    if (this.sourceWanted(f, SOURCE_MODULE.correspondence)) tasks.push(this.fromCorrEvents(db, userId, f, created, take));
    if (this.sourceWanted(f, SOURCE_MODULE.dispatch)) tasks.push(this.fromShipmentEvents(db, userId, f, created, take));
    tasks.push(this.fromRevisions(db, userId, f, created, take));
    if (this.sourceWanted(f, SOURCE_MODULE.signature) && (!f.actionType || f.actionType === 'sign') && !f.q) tasks.push(this.fromSignatures(db, userId, f, created, take));
    if (this.sourceWanted(f, SOURCE_MODULE.offboarding) && (!f.actionType || f.actionType === 'status' || f.actionType === 'other') && !f.entityType && !f.entityId) {
      tasks.push(this.fromOffboarding(db, userId, f, created, take));
    }

    const lists = await Promise.all(tasks);
    const anySourceFull = lists.some((l) => l.length >= take);
    const merged = mergeTimelines(lists, { limit, cursor, anySourceFull });
    let items = merged.items;

    if (!access.canSeeNetwork) items = items.map((i) => ({ ...i, ip: null, device: null }));
    items = await this.attachLabels(db, access, items);
    items = await this.attachLinks(ctx, access, items);
    return { items, nextCursor: merged.nextCursor };
  }

  // ── فیلترهای مشترک ────────────────────────────────────────────────────

  private sourceWanted(f: TimelineFilters, moduleCode: string): boolean {
    return !f.module || f.module === moduleCode;
  }

  private createdRange(f: TimelineFilters, cursorAt?: number): Where | undefined {
    const range: Record<string, Date> = {};
    if (f.from) range.gte = f.from;
    const upper = [f.to?.getTime(), cursorAt].filter((x): x is number => typeof x === 'number');
    if (upper.length) range.lte = new Date(Math.min(...upper));
    return Object.keys(range).length ? range : undefined;
  }

  private async guard(name: string, run: () => Promise<TimelineItem[]>): Promise<TimelineItem[]> {
    try {
      return await run();
    } catch (err) {
      this.logger.warn(`timeline source "${name}" failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  // ── منابع ─────────────────────────────────────────────────────────────

  private fromActivity(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('activity', async () => {
      const and: Where[] = [{ userId }];
      if (created) and.push({ createdAt: created });
      if (f.module) and.push({ OR: [{ moduleCode: f.module }, { moduleCode: null, action: { startsWith: `${f.module}.` } }] });
      if (f.actionType === 'sign') and.push({ OR: [{ actionType: 'sign' }, { action: { contains: 'sign' } }] });
      else if (f.actionType) and.push({ actionType: f.actionType });
      if (f.q) and.push({ OR: [{ summary: { contains: f.q, mode: 'insensitive' } }, { action: { contains: f.q, mode: 'insensitive' } }, { entityId: f.q }] });
      if (f.entityType) and.push({ entityType: f.entityType });
      if (f.entityId) and.push({ entityId: f.entityId });
      const rows = await db.activityLog.findMany({
        where: { AND: and },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // عمداً بدون metadata
        select: { id: true, action: true, actorType: true, moduleCode: true, actionType: true, summary: true, entityType: true, entityId: true, ip: true, createdAt: true },
      });
      return rows.map(mapActivity);
    });
  }

  /** انتخاب نوع رویدادها بر اساس actionType و جست‌وجوی متنی روی برچسب فارسی. */
  private typeFilter(labels: Record<string, { label: string; actionType: string }>, excluded: readonly string[], f: TimelineFilters): { skip: boolean; where: Where } {
    const and: Where[] = [{ type: { notIn: [...excluded] } }];
    if (f.actionType) {
      const types = eventTypesForAction(labels as never, f.actionType).filter((t) => !excluded.includes(t));
      if (types.length === 0) return { skip: true, where: {} };
      and.push({ type: { in: types } });
    }
    return { skip: false, where: { AND: and } };
  }

  private labelMatches(labels: Record<string, { label: string }>, q: string): string[] {
    return Object.entries(labels).filter(([, l]) => l.label.includes(q)).map(([k]) => k);
  }

  private fromTaskEvents(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('task', async () => {
      if (f.entityType && f.entityType !== 'Task') return [];
      const tf = this.typeFilter(TASK_EVENT_LABELS, TASK_EVENT_EXCLUDED, f);
      if (tf.skip) return [];
      const and: Where[] = [{ actorUserId: userId }, tf.where];
      if (created) and.push({ createdAt: created });
      if (f.entityId) and.push({ taskId: f.entityId });
      if (f.q) and.push({ OR: [{ type: { in: this.labelMatches(TASK_EVENT_LABELS, f.q) } }, { note: { contains: f.q, mode: 'insensitive' } }] });
      const rows = await db.taskEvent.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, taskId: true, type: true, createdAt: true } });
      return rows.map(mapTaskEvent);
    });
  }

  private fromCorrEvents(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('correspondence', async () => {
      if (f.entityType && f.entityType !== 'CorrLetter') return [];
      const tf = this.typeFilter(CORR_EVENT_LABELS, CORR_EVENT_EXCLUDED, f);
      if (tf.skip) return [];
      const and: Where[] = [{ actorUserId: userId }, tf.where];
      if (created) and.push({ createdAt: created });
      if (f.entityId) and.push({ letterId: f.entityId });
      if (f.q) and.push({ type: { in: this.labelMatches(CORR_EVENT_LABELS, f.q) } });
      const rows = await db.corrEvent.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, letterId: true, type: true, createdAt: true } });
      return rows.map(mapCorrEvent);
    });
  }

  private fromShipmentEvents(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('dispatch', async () => {
      if ((f.entityType && f.entityType !== 'Shipment') || (f.actionType && f.actionType !== 'other') || f.q) return [];
      const and: Where[] = [{ actorUserId: userId }];
      if (created) and.push({ createdAt: created });
      if (f.entityId) and.push({ shipmentId: f.entityId });
      const rows = await db.shipmentEvent.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, shipmentId: true, type: true, toStatus: true, createdAt: true } });
      return rows.map(mapShipmentEvent);
    });
  }

  private fromRevisions(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('document', async () => {
      if (f.q || (f.actionType && f.actionType !== 'update' && f.actionType !== 'cancel')) return [];
      const and: Where[] = [{ userId }];
      if (created) and.push({ createdAt: created });
      if (f.module) {
        const types = REVISION_ENTITY_TYPES_BY_MODULE[f.module];
        if (!types) return [];
        and.push({ entityType: { in: types } });
      }
      if (f.actionType) and.push({ action: f.actionType === 'cancel' ? 'VOID' : 'EDIT' });
      if (f.entityType) and.push({ entityType: f.entityType });
      if (f.entityId) and.push({ entityId: f.entityId });
      const rows = await db.documentRevision.findMany({
        where: { AND: and },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // عمداً بدون before/after/changes/reason
        select: { id: true, entityType: true, entityId: true, revisionNo: true, action: true, createdAt: true },
      });
      return rows.map(mapRevision);
    });
  }

  private fromSignatures(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('signature', async () => {
      const and: Where[] = [{ signerUserId: userId }];
      if (created) and.push({ createdAt: created });
      if (f.entityType) and.push({ entityType: f.entityType });
      if (f.entityId) and.push({ entityId: f.entityId });
      const rows = await db.signatureEvidence.findMany({
        where: { AND: and },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // عمداً بدون مختصات، UA، هش‌ها و تلفن
        select: { id: true, entityType: true, entityId: true, action: true, ip: true, createdAt: true },
      });
      return rows.map(mapSignature);
    });
  }

  private fromOffboarding(db: TenantPrismaClient, userId: string, f: TimelineFilters, created: Where | undefined, take: number) {
    return this.guard('offboarding', async () => {
      const and: Where[] = [{ OR: [{ fromUserId: userId }, { toUserId: userId }] }];
      if (created) and.push({ createdAt: created });
      if (f.q) and.push({ OR: [{ fromUserName: { contains: f.q, mode: 'insensitive' } }, { toUserName: { contains: f.q, mode: 'insensitive' } }] });
      const rows = await db.userOffboardingRun.findMany({
        where: { AND: and },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        // عمداً بدون counts/details/reason
        select: { id: true, mode: true, fromUserId: true, toUserId: true, fromUserName: true, toUserName: true, createdAt: true },
      });
      return rows.map((r) => mapOffboarding(r, userId));
    });
  }

  // ── غنی‌سازی ──────────────────────────────────────────────────────────

  /** عنوان وظیفه فقط برای مدیر/خود کاربر (مدیر منابع انسانی نباید عنوان وظایف خصوصی را ببیند). */
  private async attachLabels(db: TenantPrismaClient, access: ArchiveAccess, items: TimelineItem[]): Promise<TimelineItem[]> {
    if (!access.canSeeLabels) return items;
    const ids = [...new Set(items.filter((i) => i.source === 'task' && i.entityId).map((i) => i.entityId as string))];
    if (ids.length === 0) return items;
    const tasks = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, title: true } });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return items.map((i) => {
      const t = i.source === 'task' && i.entityId ? byId.get(i.entityId) : undefined;
      return t ? { ...i, title: `${i.title} «${t.title.slice(0, 60)}»` } : i;
    });
  }

  /** لینک فقط وقتی بیننده به همان ماژول دسترسی دارد (مدیر؛ یا «مشاهده‌ی همه»؛ یا «مشاهده‌ی خود» وقتی خودِ کاربر است). */
  private async attachLinks(ctx: TenantRequestContext, access: ArchiveAccess, items: TimelineItem[]): Promise<TimelineItem[]> {
    const memo = new Map<string, boolean>();
    const can = async (moduleCode: string): Promise<boolean> => {
      if (access.level === 'admin') return true;
      const hit = memo.get(moduleCode);
      if (hit !== undefined) return hit;
      const m = await this.permissions.getEffective(ctx, moduleCode).catch(() => null);
      const ok = !!m && (m.canViewAll || (m.canViewOwn && access.level === 'self'));
      memo.set(moduleCode, ok);
      return ok;
    };
    const out: TimelineItem[] = [];
    for (const i of items) {
      const l = linkTarget(i);
      out.push(l && (await can(l.moduleCode)) ? { ...i, link: l.href } : i);
    }
    return out;
  }
}

/** مسیر عمیق پنل برای موجودیت‌های شناخته‌شده؛ بقیه بدون لینک. */
export function linkTarget(i: Pick<TimelineItem, 'entityType' | 'entityId'>): { moduleCode: string; href: string } | null {
  if (!i.entityId || !/^[0-9A-Za-z_-]{6,64}$/.test(i.entityId)) return null;
  switch (i.entityType) {
    case 'Task':
      return { moduleCode: 'tasks', href: `/tasks?open=${i.entityId}` };
    case 'CorrLetter':
      return { moduleCode: 'correspondence', href: `/correspondence/${i.entityId}` };
    case 'Shipment':
      return { moduleCode: 'dispatch', href: `/dispatch/${i.entityId}` };
    default:
      return null;
  }
}
