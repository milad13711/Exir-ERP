import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getSubordinateUserIds } from '../hr/org-chain.util.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { entityDef, entityDelegate, entityReadScope, selectFor, type ReferralEntityDef } from './entity-defs.js';
import { ACTIVE_REFERRAL_STATUSES, hasEntityGrant } from './referral-grants.js';
import type { ReassignReferralDto, ReferDocumentDto } from './dto/referral.dto.js';

export type ReferralAction = 'accept' | 'return' | 'complete' | 'cancel' | 'revoke';

const FA_STATUS: Record<string, string> = {
  PENDING: 'در انتظار پذیرش',
  ACCEPTED: 'پذیرفته‌شده',
  DONE: 'انجام‌شده',
  RETURNED: 'بازگردانده‌شده',
  CANCELLED: 'لغوشده',
  FORWARDED: 'ارجاع مجدد شده',
  REVOKED: 'دسترسی لغو شد',
};

type DocumentReferralView = Awaited<ReturnType<ReferralsService['decorate']>>[number];

type ReferralRow = {
  id: string; entityType: string; entityId: string; entityLabel: string | null; fromUserId: string | null; toUserId: string;
  note: string | null; dueAt: Date | null; status: string; acceptedAt: Date | null; resolvedAt: Date | null;
  resolvedByUserId: string | null; resolvedNote: string | null; createdAt: Date;
};

const isManager = (ctx: TenantRequestContext) => ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
const isActive = (status: string) => (ACTIVE_REFERRAL_STATUSES as readonly string[]).includes(status);

@Injectable()
export class ReferralsService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── کمکی‌ها ───────────────────────────────────────────────────────────

  private async me(ctx: TenantRequestContext): Promise<string> {
    const id = await resolveTenantUserId(ctx);
    if (!id) throw new ForbiddenException('این عملیات برای کلید API در دسترس نیست');
    return id;
  }

  private def(type: string): ReferralEntityDef {
    const d = entityDef(type);
    if (!d) throw new BadRequestException('این نوع سند قابل ارجاع نیست');
    return d;
  }

  private async userNames(ctx: TenantRequestContext, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (uniq.length === 0) return new Map();
    const rows = await ctx.tenantDb.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * سند را در دامنه‌ی «خواندن» (دید عادی + دسترسی صریح) کاربر پیدا می‌کند؛ خارج از دامنه ۴۰۴ (بدون افشای وجود).
   * مدیر همیشه می‌بیند.
   */
  private async loadVisible(ctx: TenantRequestContext, def: ReferralEntityDef, entityId: string): Promise<Record<string, unknown>> {
    const scope = await entityReadScope(this.permissions, ctx, def).catch((e) => {
      if (e instanceof ForbiddenException) throw new NotFoundException('سند یافت نشد');
      throw e;
    });
    const row = await entityDelegate(ctx, def).findFirst({ where: { id: entityId, ...scope }, select: selectFor(def) });
    if (!row) throw new NotFoundException('سند یافت نشد');
    return row as Record<string, unknown>;
  }

  /** چه کسی حق «ارجاع دادن» این سند را دارد: مدیر، دارنده‌ی «ویرایش» ماژول (در دامنه‌ی دید عادی)، صاحب سند، مسئول فعلی، یا مدیر بالادستِ صاحب/مسئول. */
  private async assertCanRefer(ctx: TenantRequestContext, def: ReferralEntityDef, entity: Record<string, unknown>, me: string, activeToUserIds: string[]): Promise<void> {
    if (isManager(ctx)) return;
    if (activeToUserIds.includes(me)) return; // مسئول فعلی می‌تواند ارجاع مجدد دهد
    const owners = def.ownerFields.map((f) => entity[f]).filter((x): x is string => typeof x === 'string');
    if (owners.includes(me)) return;
    const matrix = await this.permissions.getEffective(ctx, def.module);
    if (matrix.canEdit) {
      // باید سند را با دید عادی هم ببیند (نه فقط با دسترسی صریح)
      const strict = await def.strictScope(this.permissions, ctx).catch(() => null);
      if (strict) {
        const row = await entityDelegate(ctx, def).findFirst({ where: { id: entity.id, ...strict }, select: { id: true } });
        if (row) return;
      }
    }
    const subs = new Set(await getSubordinateUserIds(ctx.tenantDb, me));
    if ([...owners, ...activeToUserIds].some((u) => subs.has(u))) return;
    throw new ForbiddenException('اجازه‌ی ارجاع این سند را ندارید');
  }

  private link(def: ReferralEntityDef, id: string) {
    return def.link(id);
  }

  private async audit(ctx: TenantRequestContext, userId: string, action: string, r: { id: string; entityType: string; entityId: string }, summary: string) {
    await ctx.tenantDb.activityLog
      .create({ data: { userId, action, entityType: 'DocumentReferral', entityId: r.id, moduleCode: 'referrals', actionType: 'status', summary, metadata: { entityType: r.entityType, entityId: r.entityId } } })
      .catch(() => undefined);
  }

  private async decorate(ctx: TenantRequestContext, rows: ReferralRow[]) {
    const names = await this.userNames(ctx, rows.flatMap((r) => [r.fromUserId, r.toUserId, r.resolvedByUserId]));
    return rows.map((r) => ({
      ...r,
      statusLabel: FA_STATUS[r.status] ?? r.status,
      fromName: r.fromUserId ? (names.get(r.fromUserId) ?? null) : null,
      toName: names.get(r.toUserId) ?? null,
      resolvedByName: r.resolvedByUserId ? (names.get(r.resolvedByUserId) ?? null) : null,
      link: entityDef(r.entityType)?.link(r.entityId) ?? null,
      noun: entityDef(r.entityType)?.noun ?? r.entityType,
      overdue: !!r.dueAt && isActive(r.status) && r.dueAt.getTime() < Date.now(),
    }));
  }

  // ── ارجاع ─────────────────────────────────────────────────────────────

  async refer(ctx: TenantRequestContext, dto: ReferDocumentDto, opts: { emailCc?: string[]; notify?: boolean; trusted?: boolean; renotify?: boolean } = {}, _retry = false): Promise<DocumentReferralView & { duplicate: boolean }> {
    const me = await this.me(ctx);
    const def = this.def(dto.entityType);
    if (dto.toUserId === me) throw new BadRequestException('ارجاع به خودتان معنی ندارد');

    if (dto.idempotencyKey) {
      const dup = await ctx.tenantDb.documentReferral.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (dup) {
        if (dup.entityType !== dto.entityType || dup.entityId !== dto.entityId || dup.fromUserId !== me) throw new ConflictException('کلید تکرار برای ارجاع دیگری استفاده شده است');
        return { ...(await this.decorate(ctx, [dup as ReferralRow]))[0], duplicate: true };
      }
    }

    const entity = await this.loadVisible(ctx, def, dto.entityId);
    const target = await ctx.tenantDb.user.findFirst({ where: { id: dto.toUserId, status: { not: 'DISABLED' } }, select: { id: true, name: true } });
    if (!target) throw new NotFoundException('کاربر مقصد یافت نشد');

    const activeRows = await ctx.tenantDb.documentReferral.findMany({
      where: { entityType: dto.entityType, entityId: dto.entityId, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!opts.trusted) await this.assertCanRefer(ctx, def, entity, me, activeRows.map((r) => r.toUserId));

    // تکراری: همین گیرنده همین الان ارجاع فعال دارد → همان را برگردان (بدون اعلان دوباره)
    const same = activeRows.find((r) => r.toUserId === dto.toUserId);
    if (same) {
      if (opts.renotify && opts.notify !== false) await this.notifyAssigned(ctx, def, same as ReferralRow, entity, me, opts.emailCc);
      return { ...(await this.decorate(ctx, [same as ReferralRow]))[0], duplicate: true };
    }

    const label = def.label(entity);
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new BadRequestException('موعد نامعتبر است');
    const now = new Date();

    const primary = !dto.additional || activeRows.length === 0;
    let created: Awaited<ReturnType<typeof ctx.tenantDb.documentReferral.create>>;
    try {
      created = await ctx.tenantDb.$transaction(async (tx) => {
        if (!dto.additional && activeRows.length) {
          await tx.documentReferral.updateMany({
            where: { id: { in: activeRows.map((r) => r.id) }, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
            data: { status: 'FORWARDED', resolvedAt: now, resolvedByUserId: me, resolvedNote: `ارجاع مجدد به ${target.name}` },
          });
        }
        return tx.documentReferral.create({
          data: {
            entityType: dto.entityType, entityId: dto.entityId, entityLabel: label, fromUserId: me, toUserId: dto.toUserId,
            note: dto.note?.trim() || null, dueAt, idempotencyKey: dto.idempotencyKey ?? null, isPrimary: primary,
          },
        });
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      // کلید تکرار یا ایندکس یکتای ارجاع فعال (درخواست هم‌زمان): نتیجه‌ی موجود را برگردان
      if (dto.idempotencyKey) {
        const dup = await ctx.tenantDb.documentReferral.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (dup && dup.entityType === dto.entityType && dup.entityId === dto.entityId && dup.fromUserId === me) {
          return { ...(await this.decorate(ctx, [dup as ReferralRow]))[0], duplicate: true };
        }
      }
      const sameNow = await ctx.tenantDb.documentReferral.findFirst({ where: { entityType: dto.entityType, entityId: dto.entityId, toUserId: dto.toUserId, status: { in: [...ACTIVE_REFERRAL_STATUSES] } } });
      if (sameNow) return { ...(await this.decorate(ctx, [sameNow as ReferralRow]))[0], duplicate: true };
      if (!_retry) return this.refer(ctx, dto, opts, true); // رقابت روی «مسئول اصلی»: با وضعیت تازه یک بار دیگر
      throw new ConflictException('هم‌زمان ارجاع دیگری ثبت شد؛ دوباره تلاش کنید');
    }

    await this.audit(ctx, me, 'referral.created', created, `${label} به ${target.name} ارجاع شد`);

    if (opts.notify !== false) {
      await this.notifyAssigned(ctx, def, created as ReferralRow, entity, me, opts.emailCc);
      if (!dto.additional) {
        for (const prev of activeRows) {
          if (prev.toUserId === me || prev.toUserId === dto.toUserId) continue;
          await this.notifications.notify(ctx.tenantDb, {
            userId: prev.toUserId, type: 'referral.forwarded', category: 'approvals',
            title: `مسئولیت پیگیری ${label} به ${target.name} منتقل شد`, link: this.link(def, dto.entityId), entityType: 'DocumentReferral', entityId: prev.id,
          });
        }
      }
    }
    return { ...(await this.decorate(ctx, [created as ReferralRow]))[0], duplicate: false };
  }

  private async notifyAssigned(ctx: TenantRequestContext, def: ReferralEntityDef, r: ReferralRow, entity: Record<string, unknown>, me: string, emailCc?: string[]) {
    const label = r.entityLabel ?? def.label(entity);
    const fromName = (await this.userNames(ctx, [me])).get(me) ?? '';
    await this.notifications.notify(ctx.tenantDb, {
      userId: r.toUserId,
      type: 'referral.assigned',
      category: 'approvals',
      important: true,
      title: `${label} به شما ارجاع شد`,
      body: [fromName ? `از طرف ${fromName}` : '', r.note ?? '', r.dueAt ? `موعد: ${r.dueAt.toLocaleDateString('fa-IR')}` : ''].filter(Boolean).join(' — ') || 'برای پیگیری',
      link: this.link(def, r.entityId),
      entityType: 'DocumentReferral',
      entityId: r.id,
      emailCc,
    });
  }

  /** ارجاع مجدد از روی یک ارجاع موجود (مسئول فعلی، ارجاع‌دهنده یا مدیر). */
  async reassign(ctx: TenantRequestContext, referralId: string, dto: ReassignReferralDto) {
    const row = await ctx.tenantDb.documentReferral.findUnique({ where: { id: referralId } });
    if (!row) throw new NotFoundException('ارجاع یافت نشد');
    return this.refer(ctx, { entityType: row.entityType, entityId: row.entityId, toUserId: dto.toUserId, note: dto.note, dueAt: dto.dueAt, idempotencyKey: dto.idempotencyKey });
  }

  // ── اقدام روی ارجاع ───────────────────────────────────────────────────

  async respond(ctx: TenantRequestContext, referralId: string, action: ReferralAction, note?: string) {
    const me = await this.me(ctx);
    const row = await ctx.tenantDb.documentReferral.findUnique({ where: { id: referralId } });
    if (!row) throw new NotFoundException('ارجاع یافت نشد');
    const def = this.def(row.entityType);
    const isTo = row.toUserId === me;
    const isFrom = row.fromUserId === me;

    // گیرنده و ارجاع‌دهنده و مدیر وجود ارجاع را می‌بینند؛ بقیه ۴۰۴ (جلوگیری از IDOR)
    if (!isTo && !isFrom && !isManager(ctx) && !(action === 'revoke' && row.fromUserId)) throw new NotFoundException('ارجاع یافت نشد');

    const trimmed = note?.trim() || null;
    let from: string[];
    let to: string;
    if (action === 'accept') {
      if (!isTo) throw new ForbiddenException('فقط گیرنده می‌تواند ارجاع را بپذیرد');
      from = ['PENDING']; to = 'ACCEPTED';
    } else if (action === 'return') {
      if (!isTo) throw new ForbiddenException('فقط گیرنده می‌تواند ارجاع را برگرداند');
      from = ['PENDING', 'ACCEPTED']; to = 'RETURNED';
    } else if (action === 'complete') {
      if (!isTo) throw new ForbiddenException('فقط گیرنده می‌تواند ارجاع را انجام‌شده کند');
      from = ['PENDING', 'ACCEPTED']; to = 'DONE';
    } else if (action === 'revoke') {
      // لغو دسترسیِ مشاهده‌ی دائمیِ ارجاع انجام‌شده: مدیر، یا مدیر بالادستِ ارجاع‌دهنده
      const subs = !isManager(ctx) && row.fromUserId ? new Set(await getSubordinateUserIds(ctx.tenantDb, me)) : new Set<string>();
      if (!isManager(ctx) && !(row.fromUserId && subs.has(row.fromUserId))) throw new ForbiddenException('فقط مدیر می‌تواند دسترسی ارجاع انجام‌شده را لغو کند');
      from = ['DONE']; to = 'REVOKED';
    } else {
      if (!isFrom && !isManager(ctx)) throw new ForbiddenException('فقط ارجاع‌دهنده یا مدیر می‌تواند ارجاع را لغو کند');
      from = ['PENDING', 'ACCEPTED']; to = 'CANCELLED';
    }
    if (!from.includes(row.status)) throw new ConflictException(`این ارجاع در وضعیت «${FA_STATUS[row.status] ?? row.status}» است و این اقدام ممکن نیست`);

    const now = new Date();
    const res = await ctx.tenantDb.documentReferral.updateMany({
      where: { id: referralId, status: { in: from } },
      data: action === 'accept' ? { status: to, acceptedAt: now } : { status: to, resolvedAt: now, resolvedByUserId: me, resolvedNote: trimmed },
    });
    if (res.count === 0) throw new ConflictException('وضعیت ارجاع همین الان تغییر کرد؛ صفحه را تازه کنید');

    const label = row.entityLabel ?? def.noun;
    const names = await this.userNames(ctx, [me]);
    const myName = names.get(me) ?? '';
    await this.audit(ctx, me, `referral.${action}`, row, `${label}: ${FA_STATUS[to] ?? to}`);

    const link = def.link(row.entityId);
    if (action === 'revoke') {
      // بدون اعلان (طبق تصمیم)؛ فقط ممیزی
    } else if (action === 'cancel') {
      await this.notifications.notify(ctx.tenantDb, { userId: row.toUserId, type: 'referral.cancelled', category: 'approvals', title: `ارجاع ${label} لغو شد`, body: trimmed ?? undefined, link, entityType: 'DocumentReferral', entityId: row.id });
    } else if (row.fromUserId && row.fromUserId !== me) {
      const verb = { accept: 'پذیرفت', return: 'برگرداند', complete: 'انجام داد' }[action];
      await this.notifications.notify(ctx.tenantDb, { userId: row.fromUserId, type: `referral.${action}`, category: 'approvals', title: `${myName || 'گیرنده'} ارجاع ${label} را ${verb}`, body: trimmed ?? undefined, link, entityType: 'DocumentReferral', entityId: row.id });
    }
    const fresh = await ctx.tenantDb.documentReferral.findUniqueOrThrow({ where: { id: referralId } });
    return (await this.decorate(ctx, [fresh as ReferralRow]))[0];
  }

  /** وقتی گیرنده کار را از مسیر دیگری انجام داد (مثلاً پاراف گزارش): ارجاع‌های فعالش روی همان سند DONE می‌شود. */
  async completeActiveFor(ctx: TenantRequestContext, entityType: string, entityId: string, userId: string, note?: string) {
    await ctx.tenantDb.documentReferral.updateMany({
      where: { entityType, entityId, toUserId: userId, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
      data: { status: 'DONE', resolvedAt: new Date(), resolvedByUserId: userId, resolvedNote: note ?? null },
    });
  }

  // ── خواندن ────────────────────────────────────────────────────────────

  /** صندوق «ارجاع‌های من»: view = active | done | sent | all. */
  async inbox(ctx: TenantRequestContext, view: string, entityType?: string) {
    const me = await this.me(ctx);
    const type = entityType ? { entityType } : {};
    let where: Record<string, unknown>;
    if (view === 'sent') where = { fromUserId: me, ...type };
    else if (view === 'done') where = { toUserId: me, status: { notIn: [...ACTIVE_REFERRAL_STATUSES] }, ...type };
    else if (view === 'all') where = { toUserId: me, ...type };
    else where = { toUserId: me, status: { in: [...ACTIVE_REFERRAL_STATUSES] }, ...type };
    const rows = await ctx.tenantDb.documentReferral.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
    return this.decorate(ctx, rows as ReferralRow[]);
  }

  async counts(ctx: TenantRequestContext) {
    const me = await this.me(ctx);
    const db = ctx.tenantDb.documentReferral;
    const [pending, accepted, overdue, sentActive] = await Promise.all([
      db.count({ where: { toUserId: me, status: 'PENDING' } }),
      db.count({ where: { toUserId: me, status: 'ACCEPTED' } }),
      db.count({ where: { toUserId: me, status: { in: [...ACTIVE_REFERRAL_STATUSES] }, dueAt: { lt: new Date() } } }),
      db.count({ where: { fromUserId: me, status: { in: [...ACTIVE_REFERRAL_STATUSES] } } }),
    ]);
    return { pending, accepted, active: pending + accepted, overdue, sentActive };
  }

  /** تاریخچه و مسئول فعلی یک سند. کاربر باید سند را (با دید عادی یا دسترسی صریح) ببیند. */
  async forEntity(ctx: TenantRequestContext, entityType: string, entityId: string) {
    const me = await this.me(ctx).catch(() => null);
    const def = this.def(entityType);
    const entity = await this.loadVisible(ctx, def, entityId);
    const rows = (await ctx.tenantDb.documentReferral.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'asc' }, take: 200 })) as ReferralRow[];
    const decorated0 = await this.decorate(ctx, rows);
    const subs = me && !isManager(ctx) ? new Set(await getSubordinateUserIds(ctx.tenantDb, me)) : new Set<string>();
    const decorated = decorated0.map((r) => ({ ...r, canRevoke: r.status === 'DONE' && (isManager(ctx) || (!!r.fromUserId && subs.has(r.fromUserId))) }));
    const active = decorated.filter((r) => isActive(r.status));
    const current = active.length ? active[active.length - 1] : null;
    // بدون مسئول فعال: اگر آخرین ارجاعِ پایان‌یافته «انجام‌شده» بوده، همان را به‌عنوان وضعیت تکمیل نشان بده
    const lastEnded = [...decorated].reverse().find((r) => !isActive(r.status));
    const completed = !current && lastEnded?.status === 'DONE' ? lastEnded : null;
    let canRefer = false;
    if (me) canRefer = await this.assertCanRefer(ctx, def, entity, me, active.map((r) => r.toUserId)).then(() => true, () => false);
    return {
      entityType,
      entityId,
      label: def.label(entity),
      current,
      completed,
      additional: active.filter((r) => r !== current),
      history: decorated,
      canRefer,
      myActive: me ? (active.find((r) => r.toUserId === me) ?? null) : null,
    };
  }

  /** مسئول فعلی چند سند (ستون «مسئول» در فهرست‌ها) — فقط برای سندهایی که کاربر می‌بیند. */
  async assignees(ctx: TenantRequestContext, entityType: string, ids: string[]) {
    const def = this.def(entityType);
    const wanted = [...new Set(ids)].slice(0, 200);
    if (wanted.length === 0) return {};
    const scope = await entityReadScope(this.permissions, ctx, def).catch(() => null);
    if (!scope) return {};
    const visible = await entityDelegate(ctx, def).findMany({ where: { id: { in: wanted }, ...scope }, select: { id: true } });
    const visibleIds = (visible as Array<{ id: string }>).map((v) => v.id);
    if (visibleIds.length === 0) return {};
    const rows = await ctx.tenantDb.documentReferral.findMany({
      where: { entityType, entityId: { in: visibleIds }, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.userNames(ctx, rows.map((r) => r.toUserId));
    const out: Record<string, { userId: string; name: string | null; status: string; overdue: boolean }> = {};
    for (const r of rows) out[r.entityId] = { userId: r.toUserId, name: names.get(r.toUserId) ?? null, status: r.status, overdue: !!r.dueAt && r.dueAt.getTime() < Date.now() };
    return out;
  }

  /** شناسه‌ی سندهای این نوع که اکنون به من ارجاع فعال دارند («ارجاع‌های من» در فهرست‌ها). */
  async myEntityIds(ctx: TenantRequestContext, entityType: string) {
    const me = await this.me(ctx);
    this.def(entityType);
    const rows = await ctx.tenantDb.documentReferral.findMany({
      where: { entityType, toUserId: me, status: { in: [...ACTIVE_REFERRAL_STATUSES] } },
      select: { entityId: true },
      take: 500,
    });
    return { ids: rows.map((r) => r.entityId) };
  }

  /** برای تست/استفاده‌ی داخلی: آیا کاربر برای این سند دسترسی صریح دارد؟ */
  hasGrant(ctx: TenantRequestContext, userId: string, entityType: string, entityId: string) {
    return hasEntityGrant(ctx.tenantDb, userId, entityType, entityId);
  }
}
