import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { enabledModuleSnapshot } from '../../common/module-enabled.util.js';
import { resolveTenantUserId } from '../../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import type { OffboardUserDto } from '../dto/offboard-user.dto.js';
import {
  UNASSIGN,
  cleanupPersonal,
  countOwned,
  hasRemainingReferences,
  transferOwnership,
  type CleanupResult,
  type DetailRow,
  type EntryResult,
  type OffboardingMode,
} from './offboarding.engine.js';
import { MATRIX_GATED_MODULE_CODES, MODULE_LABELS, MODULE_LINKS, TRANSFERABLE, type TransferEntry } from './ownership-registry.js';

const ROLE_RANK = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const;
type MembershipRole = keyof typeof ROLE_RANK;
const DELETED_NAME = 'کاربر حذف‌شده';
const TOMBSTONE_PREFIX = 'deleted:';
/** سقف شناسه‌های ذخیره‌شده برای گزارش CSV در هر اجرا (بیش از آن truncated=true می‌شود؛ شمارش‌ها همچنان کامل است). */
const MAX_DETAIL_IDS = 100_000;

export type BlockingIssue = { code: 'SELF' | 'MAIN_OWNER' | 'LAST_MANAGER' | 'HIERARCHY' | 'DELETE_OWNER_ONLY'; message: string };
export type OffboardingWarning = { code: string; message: string; moduleCode?: string; targetUserId?: string; count?: number };

type LeaverInfo = {
  user: { id: string; name: string; status: string; globalUserId: string; phone: string };
  realGlobalUserId: string;
  alreadyAnonymised: boolean;
  membership: { id: string; role: MembershipRole; status: string } | null;
};

export type OffboardingResult = {
  dryRun: boolean;
  runId: string | null;
  mode: OffboardingMode;
  fromUser: { id: string; name: string };
  target: { id: string; name: string } | null;
  userOutcome: 'unchanged' | 'deactivated' | 'anonymised' | 'deleted';
  freesLicenseSeat: boolean;
  totals: { moved: number; merged: number; unassigned: number; cleanedUp: number };
  modules: Array<{ moduleCode: string; label: string; moved: number; merged: number; unassigned: number; entries: EntryResult[] }>;
  cleanup: CleanupResult[];
  warnings: OffboardingWarning[];
  requiresAcceptance: boolean;
  truncated: boolean;
};

@Injectable()
export class OffboardingService {
  private readonly logger = new Logger('OffboardingService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── پیش‌نمایش ─────────────────────────────────────────────────────────────

  async preview(ctx: TenantRequestContext, userId: string, mode: OffboardingMode = 'deactivate') {
    this.assertManager(ctx);
    const info = await this.loadLeaver(ctx, userId);
    const now = new Date();
    const owned = await countOwned(ctx.tenantDb, userId, now);
    const snapshot = await enabledModuleSnapshot(this.controlDb, ctx.tenantId);

    const byModule = new Map<string, { moduleCode: string; label: string; installed: boolean; total: number; entries: Array<{ key: string; label: string; count: number; scopeNote: string }> }>();
    for (const { entry, count } of owned) {
      if (count === 0) continue;
      const installed = !snapshot.defined.has(entry.moduleCode) || snapshot.enabled.has(entry.moduleCode);
      const m = byModule.get(entry.moduleCode) ?? { moduleCode: entry.moduleCode, label: MODULE_LABELS[entry.moduleCode] ?? entry.moduleCode, installed, total: 0, entries: [] };
      m.total += count;
      m.entries.push({ key: entry.key, label: entry.label, count, scopeNote: entry.scopeNote });
      byModule.set(entry.moduleCode, m);
    }
    const modules = [...byModule.values()].sort((a, b) => b.total - a.total);
    const totalOwned = modules.reduce((s, m) => s + m.total, 0);

    const blockingIssues = await this.computeBlocking(ctx, info, mode);
    const warnings: OffboardingWarning[] = [];
    if (info.membership?.status === 'ACTIVE' && mode !== 'transfer-only') {
      warnings.push({ code: 'ACTIVE_SESSIONS', message: 'این کاربر ممکن است هم‌اکنون وارد سیستم باشد؛ همه‌ی نشست‌های او پس از اجرا باطل می‌شود.' });
    }
    const approverCount = owned.find((o) => o.entry.key === 'ModuleApprover.userId')?.count ?? 0;
    if (approverCount > 0) {
      warnings.push({ code: 'MODULE_APPROVER', message: `او تأییدکننده‌ی نهایی ${approverCount} ماژول است؛ این مسئولیت هم به مقصد منتقل می‌شود (یا اگر مقصد مدیر نباشد به مدیران برمی‌گردد).`, count: approverCount });
    }
    const employee = await ctx.tenantDb.employee.findFirst({ where: { userId }, select: { id: true, fullName: true } });
    if (employee && mode !== 'transfer-only') {
      warnings.push({ code: 'EMPLOYEE_LINK', message: `پرونده‌ی پرسنلی «${employee.fullName}» حفظ می‌شود؛ فقط پیوند آن به حساب ورود جدا می‌شود. وضعیت استخدام را در بخش منابع انسانی جداگانه تعیین کنید.` });
    }
    if (mode === 'deactivate' && info.membership) {
      warnings.push({ code: 'SEAT_KEPT', message: 'در غیرفعال‌سازی، صندلی لایسنس آزاد نمی‌شود؛ برای آزادشدن صندلی «حذف کامل» را انتخاب کنید.' });
    }

    return {
      user: { id: info.user.id, name: info.user.name, status: info.user.status, membershipRole: info.membership?.role ?? 'MEMBER' },
      mode,
      modules,
      totalOwned,
      blockingIssues,
      warnings,
      suggestedTargets: await this.suggestTargets(ctx, userId),
    };
  }

  // ── dry-run / اجرا ───────────────────────────────────────────────────────

  async dryRun(ctx: TenantRequestContext, userId: string, dto: OffboardUserDto): Promise<OffboardingResult> {
    this.assertManager(ctx);
    const mode = dto.mode ?? 'deactivate';
    const info = await this.loadLeaver(ctx, userId);
    await this.assertAllowed(ctx, info, mode);
    const plan = await this.buildPlan(ctx, info, dto);
    const now = new Date();
    const transfer = await transferOwnership(ctx.tenantDb, { fromUserId: userId, targetFor: plan.targetFor, now, dryRun: true });
    const cleanup = await cleanupPersonal(ctx.tenantDb, { userId, mode, dryRun: true });
    return this.toResult({ dryRun: true, runId: null, mode, info, plan, transfer, cleanup, userOutcome: 'unchanged', truncated: false });
  }

  async offboard(ctx: TenantRequestContext, userId: string, dto: OffboardUserDto): Promise<OffboardingResult> {
    this.assertManager(ctx);
    const mode = dto.mode ?? 'deactivate';
    const info = await this.loadLeaver(ctx, userId);
    await this.assertAllowed(ctx, info, mode);
    const plan = await this.buildPlan(ctx, info, dto);
    if (plan.warnings.some((w) => w.code === 'TARGET_LACKS_ACCESS') && !dto.acceptTargetWithoutAccess) {
      throw new BadRequestException({
        message: 'مقصد به برخی ماژول‌های منتقل‌شده دسترسی مشاهده ندارد؛ مقصد دیگری انتخاب کنید یا با تأیید صریح ادامه دهید.',
        code: 'TARGET_LACKS_ACCESS',
        warnings: plan.warnings,
      });
    }

    const actorUserId = await resolveTenantUserId(ctx).catch(() => null);
    const actorName = actorUserId ? ((await ctx.tenantDb.user.findUnique({ where: { id: actorUserId }, select: { name: true } }))?.name ?? null) : null;
    const now = new Date();

    // ۱) کنترل‌پلین: دسترسی را زودتر می‌بندیم تا کاربر وسط انتقال رکورد جدید نسازد و نشست‌هایش باطل شود (قابل‌برگشت در صورت شکست).
    const revokes = mode !== 'transfer-only' && info.membership;
    const previousStatus = info.membership?.status as 'INVITED' | 'ACTIVE' | 'DISABLED' | undefined;
    if (revokes && info.membership) {
      await this.controlDb.tenantMembership.update({ where: { id: info.membership.id }, data: { status: 'DISABLED', tokenVersion: { increment: 1 } } });
    }

    let committed: { transfer: { entries: EntryResult[]; details: DetailRow[] }; cleanup: CleanupResult[]; outcome: OffboardingResult['userOutcome']; runId: string; truncated: boolean };
    try {
      committed = await ctx.tenantDb.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`offboard:${userId}`}))`;
          const transfer = await transferOwnership(tx, { fromUserId: userId, targetFor: plan.targetFor, now, dryRun: false });
          const cleanup = await cleanupPersonal(tx, { userId, mode, dryRun: false });

          let outcome: OffboardingResult['userOutcome'] = 'unchanged';
          if (mode === 'deactivate') {
            await tx.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
            outcome = 'deactivated';
          } else if (mode === 'delete') {
            if (await hasRemainingReferences(tx, userId)) {
              // سابقه (لاگ، امضا، پیام، …) به این ردیف وصل است → ردیف حذف نمی‌شود، ناشناس می‌شود.
              await tx.user.update({
                where: { id: userId },
                data: { name: DELETED_NAME, email: null, phone: '', status: 'DISABLED', navOrder: [], globalUserId: `${TOMBSTONE_PREFIX}${info.realGlobalUserId}` },
              });
              outcome = 'anonymised';
            } else {
              await tx.user.delete({ where: { id: userId } });
              outcome = 'deleted';
            }
          }

          const { rows, truncated } = capDetails(transfer.details, plan.names);
          const result = this.toResult({ dryRun: false, runId: null, mode, info, plan, transfer, cleanup, userOutcome: outcome, truncated });
          const run = await tx.userOffboardingRun.create({
            data: {
              fromUserId: userId,
              fromUserName: info.user.name,
              toUserId: plan.mainTarget?.id ?? null,
              toUserName: plan.mainTarget?.name ?? null,
              performedByUserId: actorUserId,
              performedByName: actorName,
              mode,
              reason: dto.reason?.trim() || null,
              counts: { entries: transfer.entries, cleanup, totals: result.totals, outcome } as never,
              details: rows as never,
              truncated,
            },
          });
          const toLabel = plan.mainTarget ? ` به «${plan.mainTarget.name}»` : '';
          await tx.activityLog.create({
            data: {
              userId: actorUserId,
              actorType: 'MANUAL',
              moduleCode: 'users',
              actionType: 'other',
              action: mode === 'transfer-only' ? 'users.records.transferred' : 'users.offboarded',
              entityType: 'User',
              entityId: userId,
              summary:
                result.totals.moved + result.totals.merged + result.totals.unassigned > 0
                  ? `انتقال مسئولیت از «${info.user.name}»${toLabel} (${result.totals.moved} رکورد)`
                  : `خروج کاربر «${info.user.name}» (بدون رکورد برای انتقال)`,
              metadata: {
                runId: run.id,
                mode,
                outcome,
                reason: dto.reason?.trim() || null,
                toUserId: plan.mainTarget?.id ?? null,
                totals: result.totals,
                modules: result.modules.map((m) => ({ moduleCode: m.moduleCode, moved: m.moved, merged: m.merged, unassigned: m.unassigned })),
                cleanup: cleanup.map((c) => ({ key: c.key, action: c.action, count: c.count })),
              } as never,
            },
          });
          return { transfer, cleanup, outcome, runId: run.id, truncated };
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (err) {
      // تراکنش برگشت خورد: دسترسی را به حالت قبل برمی‌گردانیم (tokenVersion برنمی‌گردد؛ فقط ورود دوباره لازم می‌شود).
      if (revokes && info.membership && previousStatus && previousStatus !== 'DISABLED') {
        await this.controlDb.tenantMembership
          .update({ where: { id: info.membership.id }, data: { status: previousStatus } })
          .catch((e) => this.logger.error(`بازگردانی عضویت پس از شکست خروج کاربر ناموفق بود: ${e instanceof Error ? e.message : e}`));
      }
      throw err;
    }

    // ۲) پس از commit: حذف کامل → عضویت کنترل‌پلین حذف می‌شود (صندلی لایسنس آزاد). idempotent و قابل تکرار.
    if (mode === 'delete') {
      await this.controlDb.tenantMembership.deleteMany({ where: { tenantId: ctx.tenantId, globalUserId: info.realGlobalUserId } });
    }

    // ۳) اعلان‌ها (هیچ‌کدام عملیات را نمی‌شکند)
    const result = this.toResult({ dryRun: false, runId: committed.runId, mode, info, plan, transfer: committed.transfer, cleanup: committed.cleanup, userOutcome: committed.outcome, truncated: committed.truncated });
    await this.notifyTargets(ctx, info, committed.transfer, plan.names, dto.notifyManager === true, committed.runId);
    return result;
  }

  // ── گزارش CSV ────────────────────────────────────────────────────────────

  async buildRunCsv(ctx: TenantRequestContext, runId: string): Promise<string> {
    this.assertManager(ctx);
    const run = await ctx.tenantDb.userOffboardingRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('گزارش یافت نشد');
    const rows = (run.details as Array<{ key: string; action: string; toUserId: string | null; toUserName: string | null; ids: string[] }> | null) ?? [];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [['ماژول', 'بخش', 'مدل', 'فیلد', 'شناسه رکورد', 'اقدام', 'از کاربر', 'به کاربر'].join(',')];
    const actionFa: Record<string, string> = { moved: 'منتقل شد', merged: 'ادغام شد (قبلاً در مقصد بود)', unassigned: 'بی‌صاحب شد' };
    for (const row of rows) {
      const entry = TRANSFERABLE.find((e) => e.key === row.key);
      const [model, field] = row.key.split('.');
      for (const id of row.ids) {
        lines.push([esc(MODULE_LABELS[entry?.moduleCode ?? ''] ?? entry?.moduleCode ?? ''), esc(entry?.label ?? row.key), model, field, id, esc(actionFa[row.action] ?? row.action), esc(run.fromUserName), esc(row.toUserName ?? '')].join(','));
      }
    }
    if (run.truncated) lines.push(esc('توجه: فهرست شناسه‌ها به سقف ذخیره‌سازی رسید؛ شمارش‌های کامل در گزارش اجرا موجود است.'));
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // ── داخلی ───────────────────────────────────────────────────────────────

  private assertManager(ctx: TenantRequestContext): void {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر');
  }

  private async loadLeaver(ctx: TenantRequestContext, userId: string): Promise<LeaverInfo> {
    const user = await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { id: true, name: true, status: true, globalUserId: true, phone: true } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const alreadyAnonymised = user.globalUserId.startsWith(TOMBSTONE_PREFIX);
    const realGlobalUserId = alreadyAnonymised ? user.globalUserId.slice(TOMBSTONE_PREFIX.length) : user.globalUserId;
    const m = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: ctx.tenantId, globalUserId: realGlobalUserId } },
      select: { id: true, role: true, status: true },
    });
    return { user, realGlobalUserId, alreadyAnonymised, membership: m ? { id: m.id, role: m.role as MembershipRole, status: m.status } : null };
  }

  private async computeBlocking(ctx: TenantRequestContext, info: LeaverInfo, mode: OffboardingMode): Promise<BlockingIssue[]> {
    const issues: BlockingIssue[] = [];
    if (mode === 'transfer-only') return issues; // انتقال بدون تغییر حساب برای همه‌ی مدیران مجاز است
    const actorUserId = await resolveTenantUserId(ctx).catch(() => null);
    if (actorUserId && actorUserId === info.user.id) issues.push({ code: 'SELF', message: 'نمی‌توانید حساب کاربری خودتان را حذف یا غیرفعال کنید' });
    const role = info.membership?.role ?? 'MEMBER';
    if (role === 'OWNER') issues.push({ code: 'MAIN_OWNER', message: 'مدیر اصلی سیستم قابل حذف نیست؛ ابتدا باید نقش مدیر کل او تغییر کند' });
    if (ctx.auth.role !== 'OWNER' && (ROLE_RANK[ctx.auth.role as MembershipRole] ?? 0) <= ROLE_RANK[role]) {
      issues.push({ code: 'HIERARCHY', message: 'فقط مدیر بالادستی می‌تواند دسترسی کاربر پایین‌دستی را حذف کند' });
    }
    if (mode === 'delete' && ctx.auth.role !== 'OWNER') {
      issues.push({ code: 'DELETE_OWNER_ONLY', message: 'حذف کامل فقط توسط مدیر کل ممکن است؛ می‌توانید کاربر را غیرفعال کنید' });
    }
    if (role === 'OWNER' || role === 'ADMIN') {
      const others = await this.controlDb.tenantMembership.count({
        where: { tenantId: ctx.tenantId, role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE', NOT: { id: info.membership?.id ?? '__none__' } },
      });
      if (others === 0) issues.push({ code: 'LAST_MANAGER', message: 'او آخرین مدیر فعال این محیط کاری است و نمی‌توان او را حذف/غیرفعال کرد' });
    }
    return issues;
  }

  private async assertAllowed(ctx: TenantRequestContext, info: LeaverInfo, mode: OffboardingMode): Promise<void> {
    const issues = await this.computeBlocking(ctx, info, mode);
    if (issues.length > 0) {
      throw new ForbiddenException({ message: issues[0].message, code: issues[0].code, blockingIssues: issues });
    }
  }

  /** اعتبارسنجی مقصدها + ساخت targetFor + هشدار دسترسی. هیچ نوشتنی ندارد. */
  private async buildPlan(ctx: TenantRequestContext, info: LeaverInfo, dto: OffboardUserDto) {
    const db = ctx.tenantDb;
    const leaverId = info.user.id;
    const now = new Date();
    const owned = await countOwned(db, leaverId, now);
    const ownedModules = new Set(owned.filter((o) => o.count > 0).map((o) => o.entry.moduleCode));
    const validModules = new Set(TRANSFERABLE.map((e) => e.moduleCode));

    const overrides: Record<string, string> = {};
    for (const [moduleCode, uid] of Object.entries(dto.perModuleOverrides ?? {})) {
      if (!validModules.has(moduleCode)) throw new BadRequestException(`ماژول «${moduleCode}» برای انتقال تعریف نشده است`);
      if (typeof uid !== 'string' || uid === '') throw new BadRequestException('شناسه‌ی کاربر مقصد ماژول نامعتبر است');
      overrides[moduleCode] = uid;
    }
    const main = dto.transferToUserId || undefined;

    const uncovered = [...ownedModules].filter((m) => !overrides[m]);
    if (uncovered.length > 0 && !main) {
      throw new BadRequestException('کاربر مقصد برای انتقال رکوردها الزامی است');
    }

    const targetIds = [...new Set([...(main ? [main] : []), ...Object.values(overrides)])];
    for (const id of targetIds) {
      if (id === leaverId) throw new BadRequestException('کاربر مقصد نمی‌تواند خودِ کاربر در حال خروج باشد');
    }
    const targets = targetIds.length ? await db.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true, status: true, globalUserId: true } }) : [];
    const byId = new Map(targets.map((t) => [t.id, t]));
    for (const id of targetIds) {
      const t = byId.get(id);
      if (!t) throw new BadRequestException('کاربر مقصد یافت نشد');
      if (t.status !== 'ACTIVE') throw new BadRequestException(`کاربر مقصد «${t.name}» فعال نیست`);
    }
    const memberships = targets.length
      ? await this.controlDb.tenantMembership.findMany({ where: { tenantId: ctx.tenantId, globalUserId: { in: targets.map((t) => t.globalUserId) } }, select: { globalUserId: true, role: true, status: true } })
      : [];
    const memberByGlobal = new Map(memberships.map((m) => [m.globalUserId, m]));
    for (const t of targets) {
      const m = memberByGlobal.get(t.globalUserId);
      if (m && m.status !== 'ACTIVE') throw new BadRequestException(`کاربر مقصد «${t.name}» دسترسی فعال ندارد`);
    }
    const isManagerTarget = (id: string) => {
      const t = byId.get(id);
      const r = t ? memberByGlobal.get(t.globalUserId)?.role : undefined;
      return r === 'OWNER' || r === 'ADMIN';
    };

    const targetFor = (entry: TransferEntry): string | typeof UNASSIGN => {
      const to = overrides[entry.moduleCode] ?? main;
      // نباید رخ دهد (مقصد پیش‌تر برای هر ماژولِ دارای رکورد الزامی شد)؛ اگر رکورد جدیدی همزمان ساخته شده بود، به‌جای بی‌صاحب‌کردن، تراکنش برگشت می‌خورد.
      if (!to) throw new BadRequestException('کاربر مقصد برای انتقال رکوردها الزامی است');
      if (entry.managerOnly && !isManagerTarget(to)) return UNASSIGN;
      return to;
    };

    // هشدار دسترسی: مقصد هر ماژولِ دارای رکورد باید لااقل «مشاهده‌ی خودش» را داشته باشد.
    const warnings: OffboardingWarning[] = [];
    const accessCache = new Map<string, Awaited<ReturnType<OffboardingService['viewableModules']>>>();
    const lacking = new Map<string, OffboardingWarning>();
    for (const { entry, count } of owned) {
      if (count === 0) continue;
      const to = targetFor(entry);
      if (to === UNASSIGN) {
        if (entry.managerOnly) warnings.push({ code: 'UNASSIGNED_TO_MANAGERS', moduleCode: entry.moduleCode, message: `«${entry.label}» به مدیران برمی‌گردد چون مقصد مدیر نیست`, count });
        continue;
      }
      if (!accessCache.has(to)) accessCache.set(to, await this.viewableModules(ctx, to, isManagerTarget(to)));
      const view = accessCache.get(to)!;
      if (view(entry.moduleCode)) continue;
      const k = `${entry.moduleCode}|${to}`;
      const prev = lacking.get(k);
      const total = (prev?.count ?? 0) + count;
      lacking.set(k, {
        code: 'TARGET_LACKS_ACCESS',
        moduleCode: entry.moduleCode,
        targetUserId: to,
        count: total,
        message: `«${byId.get(to)?.name ?? ''}» به ماژول «${MODULE_LABELS[entry.moduleCode] ?? entry.moduleCode}» دسترسی مشاهده ندارد (${total} رکورد)`,
      });
    }
    warnings.push(...lacking.values());
    // نامه‌های «سری» و پیش‌نویس‌ها خودکار منتقل نمی‌شوند (انتقال دید می‌دهد) → فقط مالک دستی
    const needsOwner = await db.corrLetter.count({ where: { ownerUserId: leaverId, archivedAt: null, status: { notIn: ['VOID', 'CLOSED', 'DELIVERED', 'REJECTED'] }, OR: [{ confidentiality: 'SECRET' }, { status: 'DRAFT' }] } });
    if (needsOwner > 0) {
      warnings.push({ code: 'NEEDS_OWNER', moduleCode: 'correspondence', count: needsOwner, message: `${needsOwner} نامه‌ی سری یا پیش‌نویس به‌صورت خودکار منتقل نمی‌شود و نیازمند تعیین مسئول توسط مالک است` });
    }

    const names = new Map(targets.map((t) => [t.id, t.name]));
    return {
      targetFor,
      warnings,
      names,
      mainTarget: main ? { id: main, name: byId.get(main)!.name } : null,
      requiresAcceptance: warnings.some((w) => w.code === 'TARGET_LACKS_ACCESS'),
    };
  }

  /** آیا کاربر به ماژول دسترسی مشاهده دارد؟ (مدیر = همه؛ ماژول بدون ماتریس = بله؛ دسترسی دستی جایگزین نقش‌هاست) */
  private async viewableModules(ctx: TenantRequestContext, userId: string, manager: boolean): Promise<(moduleCode: string) => boolean> {
    if (manager) return () => true;
    const [overrides, roleRows] = await Promise.all([
      ctx.tenantDb.userModulePermission.findMany({ where: { userId } }),
      ctx.tenantDb.modulePermission.findMany({ where: { role: { users: { some: { userId } } } } }),
    ]);
    const gated = new Set<string>(MATRIX_GATED_MODULE_CODES);
    const overridden = new Map(overrides.map((o) => [o.moduleCode, o.canViewAll || o.canViewOwn]));
    return (code: string) => {
      if (!gated.has(code)) return true;
      if (overridden.has(code)) return overridden.get(code)!;
      return roleRows.some((r) => r.moduleCode === code && (r.canViewAll || r.canViewOwn));
    };
  }

  private async suggestTargets(ctx: TenantRequestContext, leaverId: string): Promise<Array<{ userId: string; name: string; reason: 'manager' | 'department-manager' | 'same-role' | 'owner' }>> {
    const db = ctx.tenantDb;
    const out: Array<{ userId: string; name: string; reason: 'manager' | 'department-manager' | 'same-role' | 'owner' }> = [];
    const seen = new Set<string>([leaverId]);
    const push = (u: { id: string; name: string; status: string } | null | undefined, reason: (typeof out)[number]['reason']) => {
      if (!u || u.status !== 'ACTIVE' || seen.has(u.id)) return;
      seen.add(u.id);
      out.push({ userId: u.id, name: u.name, reason });
    };

    const emp = await db.employee.findFirst({ where: { userId: leaverId }, select: { managerId: true, department: { select: { managerId: true } } } });
    // زنجیره‌ی مدیران پرونده‌ی پرسنلی (تا ۵ سطح) — اولین مدیری که حساب فعال دارد
    let managerEmpId = emp?.managerId ?? null;
    for (let depth = 0; managerEmpId && depth < 5; depth++) {
      const mgr = await db.employee.findUnique({ where: { id: managerEmpId }, select: { userId: true, managerId: true } });
      if (!mgr) break;
      if (mgr.userId) push(await db.user.findUnique({ where: { id: mgr.userId }, select: { id: true, name: true, status: true } }), 'manager');
      managerEmpId = mgr.managerId;
    }
    if (emp?.department?.managerId) {
      const dm = await db.employee.findUnique({ where: { id: emp.department.managerId }, select: { userId: true } });
      if (dm?.userId) push(await db.user.findUnique({ where: { id: dm.userId }, select: { id: true, name: true, status: true } }), 'department-manager');
    }

    const roleIds = (await db.userRole.findMany({ where: { userId: leaverId }, select: { roleId: true } })).map((r) => r.roleId);
    if (roleIds.length) {
      const same = await db.user.findMany({ where: { status: 'ACTIVE', id: { not: leaverId }, roles: { some: { roleId: { in: roleIds } } } }, select: { id: true, name: true, status: true }, take: 5, orderBy: { createdAt: 'asc' } });
      for (const u of same) push(u, 'same-role');
    }

    const owners = await this.controlDb.tenantMembership.findMany({ where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE' }, select: { globalUserId: true } });
    if (owners.length) {
      const ownerUsers = await db.user.findMany({ where: { globalUserId: { in: owners.map((o) => o.globalUserId) } }, select: { id: true, name: true, status: true } });
      for (const u of ownerUsers) push(u, 'owner');
    }
    return out.slice(0, 8);
  }

  private toResult(p: {
    dryRun: boolean;
    runId: string | null;
    mode: OffboardingMode;
    info: LeaverInfo;
    plan: { mainTarget: { id: string; name: string } | null; warnings: OffboardingWarning[]; requiresAcceptance: boolean };
    transfer: { entries: EntryResult[]; details: DetailRow[] };
    cleanup: CleanupResult[];
    userOutcome: OffboardingResult['userOutcome'];
    truncated: boolean;
  }): OffboardingResult {
    const byModule = new Map<string, OffboardingResult['modules'][number]>();
    for (const e of p.transfer.entries) {
      const m = byModule.get(e.moduleCode) ?? { moduleCode: e.moduleCode, label: MODULE_LABELS[e.moduleCode] ?? e.moduleCode, moved: 0, merged: 0, unassigned: 0, entries: [] };
      m.moved += e.moved;
      m.merged += e.merged;
      m.unassigned += e.unassigned;
      m.entries.push(e);
      byModule.set(e.moduleCode, m);
    }
    const modules = [...byModule.values()];
    return {
      dryRun: p.dryRun,
      runId: p.runId,
      mode: p.mode,
      fromUser: { id: p.info.user.id, name: p.info.user.name },
      target: p.plan.mainTarget,
      userOutcome: p.userOutcome,
      freesLicenseSeat: p.mode === 'delete',
      totals: {
        moved: modules.reduce((s, m) => s + m.moved, 0),
        merged: modules.reduce((s, m) => s + m.merged, 0),
        unassigned: modules.reduce((s, m) => s + m.unassigned, 0),
        cleanedUp: p.cleanup.reduce((s, c) => s + c.count, 0),
      },
      modules,
      cleanup: p.cleanup,
      warnings: p.plan.warnings,
      requiresAcceptance: p.plan.requiresAcceptance,
      truncated: p.truncated,
    };
  }

  private async notifyTargets(ctx: TenantRequestContext, info: LeaverInfo, transfer: { entries: EntryResult[]; details: DetailRow[] }, names: Map<string, string>, notifyManager: boolean, runId: string): Promise<void> {
    // شمارش به‌ازای هر مقصد (مقصد ماژول‌ها ممکن است متفاوت باشد)
    const perTarget = new Map<string, { total: number; modules: Set<string> }>();
    for (const d of transfer.details) {
      if (d.action !== 'moved' || !d.toUserId) continue;
      const entry = TRANSFERABLE.find((e) => e.key === d.key);
      const t = perTarget.get(d.toUserId) ?? { total: 0, modules: new Set<string>() };
      t.total += d.ids.length;
      if (entry) t.modules.add(entry.moduleCode);
      perTarget.set(d.toUserId, t);
    }
    for (const [toId, t] of perTarget) {
      const firstModule = [...t.modules][0];
      await this.notifications
        .notify(ctx.tenantDb, {
          userId: toId,
          type: 'RECORDS_TRANSFERRED',
          title: `${t.total} رکورد به شما منتقل شد`,
          body: `مسئولیت رکوردهای «${info.user.name}» در ${[...t.modules].map((m) => MODULE_LABELS[m] ?? m).join('، ')} به شما واگذار شد.`,
          link: (firstModule && MODULE_LINKS[firstModule]) || '/',
        })
        .catch((e) => this.logger.warn(`اعلان انتقال رکورد ارسال نشد: ${e instanceof Error ? e.message : e}`));
    }
    if (notifyManager && perTarget.size > 0) {
      const mgr = (await this.suggestTargets(ctx, info.user.id)).find((s) => s.reason === 'manager');
      if (mgr && !perTarget.has(mgr.userId)) {
        const total = [...perTarget.values()].reduce((s, t) => s + t.total, 0);
        const toNames = [...perTarget.keys()].map((id) => names.get(id)).filter(Boolean).join('، ');
        await this.notifications
          .notify(ctx.tenantDb, {
            userId: mgr.userId,
            type: 'RECORDS_TRANSFERRED_MANAGER',
            title: `انتقال مسئولیت «${info.user.name}»`,
            body: `${total} رکورد از «${info.user.name}» به ${toNames} منتقل شد.`,
            link: `/settings/users?offboardingRun=${runId}`,
          })
          .catch(() => undefined);
      }
    }
  }
}

function capDetails(details: DetailRow[], names: Map<string, string>): { rows: Array<DetailRow & { toUserName: string | null }>; truncated: boolean } {
  let budget = MAX_DETAIL_IDS;
  let truncated = false;
  const rows: Array<DetailRow & { toUserName: string | null }> = [];
  for (const d of details) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const ids = d.ids.length > budget ? d.ids.slice(0, budget) : d.ids;
    if (ids.length < d.ids.length) truncated = true;
    budget -= ids.length;
    rows.push({ ...d, ids, toUserName: d.toUserId ? (names.get(d.toUserId) ?? null) : null });
  }
  return { rows, truncated };
}
