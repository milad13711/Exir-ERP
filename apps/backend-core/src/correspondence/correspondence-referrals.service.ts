import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { cleanText } from './text-clean.js';
import { CorrespondenceCoreService, type CorrActor } from './correspondence-core.service.js';
import { REFERRAL_OPEN_STATUSES, type LetterStatus, type LetterType } from './correspondence.constants.js';
import type { ForwardReferralDto, ReferralInputDto } from './dto/correspondence.dto.js';
import { canParaph, canRefer, nextStatus } from './letter-state.js';

type LetterRow = Prisma.CorrLetterGetPayload<object>;

/**
 * ارجاع (انتقال مسئولیت با دستور و مهلت، زنجیره‌ای، چندگیرنده) و پاراف (یادداشت کوتاه تغییرناپذیر که زیر نامه چاپ می‌شود).
 * تفاوت: ارجاع «کاری را به کسی می‌سپارد» و در کارتابل او می‌نشیند؛ پاراف فقط «نظر/دستور کوتاه» است و چاپ می‌شود.
 */
@Injectable()
export class CorrespondenceReferralsService {
  constructor(private readonly core: CorrespondenceCoreService) {}

  private async hasOpenReferralTo(ctx: TenantRequestContext, letterId: string, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    return !!(await ctx.tenantDb.corrReferral.findFirst({ where: { letterId, toUserId: userId, status: { in: [...REFERRAL_OPEN_STATUSES] } }, select: { id: true } }));
  }

  private async isParticipant(ctx: TenantRequestContext, letter: LetterRow, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    if (letter.createdByUserId === userId || letter.ownerUserId === userId || letter.signerUserId === userId) return true;
    return !!(await ctx.tenantDb.corrParticipant.findFirst({ where: { letterId: letter.id, userId }, select: { id: true } }));
  }

  /** ایجاد ارجاع (تک/چندگیرنده). `parent` برای ارجاع‌مجدد؛ `tx` اختیاری برای فراخوانی از ثبت وارده. */
  async refer(ctx: TenantRequestContext, actor: CorrActor, letterId: string, dto: ReferralInputDto, parentReferralId?: string | null) {
    const letter = await this.core.findVisible(ctx, actor, letterId);
    const type = letter.type as LetterType;
    const status = letter.status as LetterStatus;
    if (!canRefer(type, status)) throw new BadRequestException('در این وضعیت امکان ارجاع نامه نیست');
    const allowed = actor.isManager || actor.matrix.canEdit || ((await this.isParticipant(ctx, letter, actor.userId)) && actor.matrix.canCreate) || (await this.hasOpenReferralTo(ctx, letterId, actor.userId));
    if (!allowed) throw new ForbiddenException('اجازه‌ی ارجاع این نامه را ندارید');

    const toIds = [...new Set(dto.toUserIds)].filter((id) => id && id !== actor.userId);
    if (!toIds.length) throw new BadRequestException('گیرنده‌ی ارجاع را انتخاب کنید');
    const users = await ctx.tenantDb.user.findMany({ where: { id: { in: toIds } }, select: { id: true, name: true, status: true } });
    if (users.length !== toIds.length) throw new BadRequestException('یکی از گیرندگان یافت نشد');
    if (users.some((u) => (u.status as string) === 'DISABLED' || (u.status as string) === 'SUSPENDED')) throw new BadRequestException('یکی از گیرندگان غیرفعال است');
    const access = await this.core.usersWithModuleAccess(ctx);
    const noAccess = users.filter((u) => !access.has(u.id));
    if (noAccess.length) throw new BadRequestException(`گیرنده به ماژول مکاتبات دسترسی ندارد: ${noAccess.map((u) => u.name).join('، ')}`);
    let dueAt: Date | null = null;
    if (dto.dueAt) {
      dueAt = new Date(dto.dueAt);
      if (Number.isNaN(dueAt.getTime())) throw new BadRequestException('مهلت نامعتبر است');
    }
    const kind = dto.kind ?? 'ACTION';
    const instruction = (dto.instruction ?? '').trim();
    if (parentReferralId) {
      const parent = await ctx.tenantDb.corrReferral.findFirst({ where: { id: parentReferralId, letterId } });
      if (!parent) throw new NotFoundException('ارجاع مبدأ یافت نشد');
    }

    const created = await ctx.tenantDb.$transaction(async (tx) => {
      const last = await tx.corrReferral.aggregate({ where: { letterId }, _max: { seq: true } });
      let seq = last._max.seq ?? 0;
      const rows = [];
      for (const u of users) {
        rows.push(await tx.corrReferral.create({
          data: {
            letterId, fromUserId: actor.userId ?? 'system', fromName: actor.name, toUserId: u.id, toName: u.name, kind, instruction, dueAt,
            parentReferralId: parentReferralId ?? null, seq: ++seq,
          },
        }));
        await this.core.addParticipant(tx, letterId, u.id, kind === 'INFO' ? 'CC' : 'REFERRAL');
      }
      const next = nextStatus(type, status, 'refer');
      const data: Prisma.CorrLetterUpdateInput = {};
      if (next && next !== status && type === 'INCOMING') data.status = next;
      if (kind === 'ACTION' && users.length === 1 && type === 'INCOMING') data.ownerUserId = users[0].id;
      if (Object.keys(data).length) await tx.corrLetter.update({ where: { id: letterId }, data });
      await this.core.logEvent(tx, letterId, 'REFERRED', actor, instruction || null, { toUserIds: users.map((u) => u.id), toNames: users.map((u) => u.name), kind, dueAt: dueAt?.toISOString() ?? null });
      return rows;
    });
    await this.core.notify(ctx, users.map((u) => u.id), kind === 'INFO' ? 'رونوشت نامه برای شما ارسال شد' : 'نامه‌ای به شما ارجاع شد', 'correspondence.referral', letter, actor.userId);
    return created;
  }

  private async loadReferral(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const ref = await ctx.tenantDb.corrReferral.findUnique({ where: { id } });
    if (!ref) throw new NotFoundException('ارجاع یافت نشد');
    const letter = await this.core.findVisible(ctx, actor, ref.letterId); // خارج از دامنه → ۴۰۴
    return { ref, letter };
  }

  private assertRecipient(actor: CorrActor, ref: { toUserId: string }) {
    if (!actor.userId || ref.toUserId !== actor.userId) throw new ForbiddenException('این ارجاع به شما نیست');
  }

  async markSeen(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const { ref, letter } = await this.loadReferral(ctx, actor, id);
    this.assertRecipient(actor, ref);
    if (ref.status !== 'PENDING') return ref;
    return ctx.tenantDb.$transaction(async (tx) => {
      const upd = await tx.corrReferral.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SEEN', seenAt: new Date() } });
      if (upd.count === 1) {
        await this.core.logEvent(tx, letter.id, 'REFERRAL_SEEN', actor, null, { referralId: id });
        const next = nextStatus(letter.type as LetterType, letter.status as LetterStatus, 'start');
        if (next && ref.kind === 'ACTION') await tx.corrLetter.update({ where: { id: letter.id }, data: { status: next } });
      }
      return tx.corrReferral.findUniqueOrThrow({ where: { id } });
    });
  }

  async complete(ctx: TenantRequestContext, actor: CorrActor, id: string, response?: string) {
    const { ref, letter } = await this.loadReferral(ctx, actor, id);
    this.assertRecipient(actor, ref);
    if (!REFERRAL_OPEN_STATUSES.includes(ref.status as never)) throw new ConflictException('این ارجاع قبلاً بسته شده است');
    const upd = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrReferral.updateMany({ where: { id, status: { in: [...REFERRAL_OPEN_STATUSES] } }, data: { status: 'DONE', completedAt: new Date(), response: response?.trim() || null, seenAt: ref.seenAt ?? new Date() } });
      if (r.count !== 1) throw new ConflictException('این ارجاع قبلاً بسته شده است');
      await this.core.logEvent(tx, letter.id, 'REFERRAL_DONE', actor, response?.trim() || null, { referralId: id });
      return tx.corrReferral.findUniqueOrThrow({ where: { id } });
    });
    await this.core.notify(ctx, [ref.fromUserId], 'ارجاع شما انجام شد', 'correspondence.referral_done', letter, actor.userId);
    return upd;
  }

  async returnBack(ctx: TenantRequestContext, actor: CorrActor, id: string, response: string) {
    const { ref, letter } = await this.loadReferral(ctx, actor, id);
    this.assertRecipient(actor, ref);
    if (!REFERRAL_OPEN_STATUSES.includes(ref.status as never)) throw new ConflictException('این ارجاع قبلاً بسته شده است');
    const upd = await ctx.tenantDb.$transaction(async (tx) => {
      const r = await tx.corrReferral.updateMany({ where: { id, status: { in: [...REFERRAL_OPEN_STATUSES] } }, data: { status: 'RETURNED', completedAt: new Date(), response: response.trim() } });
      if (r.count !== 1) throw new ConflictException('این ارجاع قبلاً بسته شده است');
      await this.core.logEvent(tx, letter.id, 'REFERRAL_RETURNED', actor, response.trim(), { referralId: id });
      return tx.corrReferral.findUniqueOrThrow({ where: { id } });
    });
    await this.core.notify(ctx, [ref.fromUserId], 'ارجاع شما برگشت خورد', 'correspondence.referral_returned', letter, actor.userId);
    return upd;
  }

  /** ارجاع‌مجدد: ارجاع خودم را می‌بندم (DONE) و برای فرد/افراد دیگر ارجاع تازه (با parent) می‌سازم. */
  async forward(ctx: TenantRequestContext, actor: CorrActor, id: string, dto: ForwardReferralDto) {
    const { ref } = await this.loadReferral(ctx, actor, id);
    this.assertRecipient(actor, ref);
    if (!REFERRAL_OPEN_STATUSES.includes(ref.status as never)) throw new ConflictException('این ارجاع قبلاً بسته شده است');
    const created = await this.refer(ctx, actor, ref.letterId, dto, id);
    await ctx.tenantDb.corrReferral.updateMany({
      where: { id, status: { in: [...REFERRAL_OPEN_STATUSES] } },
      data: { status: 'DONE', completedAt: new Date(), response: dto.response?.trim() || `ارجاع شد به ${created.map((c) => c.toName).join('، ')}` },
    });
    await this.core.logEvent(ctx.tenantDb, ref.letterId, 'REFERRAL_FORWARDED', actor, null, { referralId: id, toUserIds: created.map((c) => c.toUserId) });
    return created;
  }

  async cancel(ctx: TenantRequestContext, actor: CorrActor, id: string) {
    const { ref, letter } = await this.loadReferral(ctx, actor, id);
    if (!(actor.isManager || (actor.userId && ref.fromUserId === actor.userId))) throw new ForbiddenException('فقط ارجاع‌دهنده یا مدیر می‌تواند ارجاع را لغو کند');
    if (!REFERRAL_OPEN_STATUSES.includes(ref.status as never)) throw new ConflictException('این ارجاع قبلاً بسته شده است');
    await ctx.tenantDb.$transaction(async (tx) => {
      await tx.corrReferral.update({ where: { id }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await this.core.logEvent(tx, letter.id, 'REFERRAL_CANCELLED', actor, null, { referralId: id });
    });
    return { success: true };
  }

  // ── پاراف ──────────────────────────────────────────────────────────────
  /** افزودن پاراف. هیچ مسیر ویرایش/حذفی برای پاراف وجود ندارد (تغییرناپذیر)؛ ترتیب با یکتایی (letterId, order) تضمین می‌شود. */
  async addParaph(ctx: TenantRequestContext, actor: CorrActor, letterId: string, text: string) {
    const letter = await this.core.findVisible(ctx, actor, letterId);
    if (!canParaph(letter.status as LetterStatus)) throw new BadRequestException('روی این نامه امکان پاراف نیست');
    if (!(actor.isManager || (await this.isParticipant(ctx, letter, actor.userId)))) throw new ForbiddenException('فقط مشارکت‌کنندگان نامه می‌توانند پاراف بزنند');
    const clean = cleanText(text).trim();
    if (!clean) throw new BadRequestException('متن پاراف خالی است');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await ctx.tenantDb.$transaction(async (tx) => {
          const last = await tx.corrParaph.aggregate({ where: { letterId }, _max: { order: true } });
          const p = await tx.corrParaph.create({
            data: { letterId, authorUserId: actor.userId ?? 'system', authorName: actor.name, authorTitle: actor.title, text: clean, order: (last._max.order ?? 0) + 1 },
          });
          await this.core.addParticipant(tx, letterId, actor.userId, 'PARAPHER');
          await this.core.logEvent(tx, letterId, 'PARAPHED', actor, clean.slice(0, 200), { paraphId: p.id });
          return p;
        });
        return row;
      } catch (e) {
        if (attempt === 2 || (e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('ثبت پاراف ناموفق بود؛ دوباره تلاش کنید');
  }
}
