import { CreateLetterDto, RegisterIncomingDto } from '../correspondence/dto/correspondence.dto.js';
import { LETTER_STATUSES, LETTER_TYPES, DELIVERY_METHODS, PRIORITIES } from '../correspondence/correspondence.constants.js';
import type { CorrActor } from '../correspondence/correspondence-core.service.js';
import { combineWhere } from '../correspondence/letter-search.js';
import type { McpDeps } from './mcp-deps.js';
import { clampLimit, clip, dateProp, htmlFromText, idProp, iso, isoProp, limitProp } from './mcp-tools.common.js';
import { parseDto } from './mcp-validate.js';
import type { McpTool } from './mcp-tool.types.js';

/**
 * دامنه‌ی دید نامه برای ایجنت: همیشه «مدیر (ADMIN)» — حتی اگر کلید را مالک ساخته باشد، ایجنت هرگز نامه‌ی «سری» نمی‌بیند
 * و پیش‌نویس دیگران هم دیده نمی‌شود (کلید API شناسه‌ی کاربر ندارد، پس شاخه‌ی «مال خودم» هم خالی است).
 * منطق دید همان letterVisibilityWhere است؛ اینجا فقط نقش مؤثر پایین می‌آید.
 */
export function agentLetterActor(actor: CorrActor): CorrActor {
  return { ...actor, isOwner: false, isAdmin: true, isManager: true, scope: { ...actor.scope, isOwner: false, isAdmin: true } };
}

const MASKED = '[محرمانه]';
const isNormal = (c: string | null | undefined) => !c || c === 'NORMAL';

/** نامه‌ی غیرعادی (محرمانه/خیلی محرمانه): موضوع و نام طرف‌ها هرگز به ایجنت (و ارائه‌دهنده‌ی مدل) نمی‌رود. */
export function maskLetterBrief(l: any) {
  const open = isNormal(l.confidentiality);
  return {
    id: l.id,
    type: l.type,
    status: l.status,
    letterNumber: l.letterNumber ?? null,
    externalNumber: open ? (l.externalNumber ?? null) : null,
    subject: open ? l.subject : MASKED,
    sender: open ? ([l.senderOrgName, l.senderName].filter(Boolean).join(' / ') || null) : MASKED,
    recipients: open ? clip(l.recipientsText, 300) : MASKED,
    priority: l.priority,
    confidentiality: l.confidentiality,
    letterDate: iso(l.letterDate),
    receivedAt: iso(l.receivedAt),
    responseDueAt: iso(l.responseDueAt),
    category: l.category?.name ?? null,
    createdAt: iso(l.createdAt),
  };
}

const AGENT_CONFIDENTIALITY = ['NORMAL', 'CONFIDENTIAL', 'VERY_CONFIDENTIAL'];

export function buildCorrespondenceTools(d: McpDeps): McpTool[] {
  const readerActor = async (ctx: Parameters<McpTool['handler']>[1]) => agentLetterActor(await d.corrCore.actor(ctx));

  return [
    {
      name: 'search_letters',
      module: 'correspondence',
      kind: 'read',
      description:
        'جست‌وجوی نامه‌های دبیرخانه (وارده/صادره/داخلی) بر اساس شماره‌ی دبیرخانه یا شماره‌ی اصلی، موضوع، وضعیت، بازه‌ی تاریخ، فرستنده/گیرنده. نامه‌های «سری» و پیش‌نویس دیگران هرگز نمایش داده نمی‌شوند و موضوع نامه‌های محرمانه پنهان است.',
      operation: 'READ',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200, description: 'متن آزاد (موضوع، شماره، فرستنده...)' },
          number: { type: 'string', maxLength: 80, description: 'شماره‌ی دبیرخانه یا شماره‌ی اصلی' },
          type: { type: 'string', enum: [...LETTER_TYPES] },
          status: { type: 'array', items: { type: 'string', enum: [...LETTER_STATUSES] }, maxItems: 14 },
          dateFrom: dateProp('از تاریخ نامه (YYYY-MM-DD میلادی، به وقت تهران)'),
          dateTo: dateProp('تا تاریخ نامه (YYYY-MM-DD)'),
          sender: { type: 'string', maxLength: 200 },
          recipient: { type: 'string', maxLength: 200 },
          awaitingReply: { type: 'boolean', description: 'فقط وارده‌های بدون پاسخ' },
          responseOverdue: { type: 'boolean', description: 'فقط نامه‌های دارای مهلت پاسخِ گذشته' },
          limit: limitProp(50),
        },
      },
      handler: async (a, ctx) => {
        const actor = await readerActor(ctx);
        const { items } = await d.corrLetters.list(
          ctx,
          actor,
          {
            q: a.q as string | undefined,
            number: a.number as string | undefined,
            type: a.type as string | undefined,
            status: a.status as string[] | undefined,
            dateFrom: a.dateFrom as string | undefined,
            dateTo: a.dateTo as string | undefined,
            sender: a.sender as string | undefined,
            recipient: a.recipient as string | undefined,
            // جست‌وجوی متنی فقط روی نامه‌های عادی: جست‌وجو روی نامه‌ی محرمانه با تطبیق/عدم تطبیق، محتوایش را لو می‌دهد (oracle)
            ...(a.q || a.sender || a.recipient ? { confidentiality: 'NORMAL' } : {}),
            awaitingReply: a.awaitingReply === true,
            responseOverdue: a.responseOverdue === true,
          },
          undefined,
          clampLimit(a.limit),
        );
        return items.map(maskLetterBrief);
      },
    },
    {
      name: 'get_letter',
      module: 'correspondence',
      kind: 'read',
      description: 'وضعیت و خط زمان یک نامه: وضعیت، امضاکننده، ارجاع‌ها و پاسخ‌ها، رویدادها. متن نامه فقط برای نامه‌ی عادی و کوتاه‌شده برمی‌گردد.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: { letterId: idProp('شناسه‌ی نامه') }, required: ['letterId'] },
      handler: async (a, ctx) => {
        const actor = await readerActor(ctx);
        const l: any = await d.corrLetters.getDetail(ctx, actor, String(a.letterId));
        const open = isNormal(l.confidentiality);
        return {
          ...maskLetterBrief(l),
          signerUserId: open ? (l.signerUserId ?? null) : null,
          body: open ? clip(l.bodyText, 2000) : MASKED,
          referrals: open
            ? (l.referrals ?? []).map((r: any) => ({ from: r.fromName, to: r.toName, kind: r.kind, status: r.status, dueAt: iso(r.dueAt), instruction: clip(r.instruction, 300), response: clip(r.response, 300) }))
            : [],
          timeline: (l.events ?? []).map((e: any) => ({ type: e.type, at: iso(e.createdAt), by: open ? e.actorName : null, note: open ? clip(e.note, 300) : null })),
          reviews: !open ? [] : (l.reviews ?? []).map((r: any) => ({ status: r.status, order: r.order })),
          replyTo: open && l.replyTo ? { id: l.replyTo.id, letterNumber: l.replyTo.letterNumber } : null,
          attachmentCount: l.attachmentCount,
        };
      },
    },
    {
      name: 'list_pending_letter_actions',
      module: 'correspondence',
      kind: 'read',
      description: 'کارهای معلق دبیرخانه: نامه‌های منتظر امضا و ارجاع‌های بازِ بدون پاسخ (با نشانگر معوق‌بودن). فقط نامه‌هایی که در دامنه‌ی دید ایجنت‌اند.',
      operation: 'READ',
      inputSchema: { type: 'object', properties: { limit: limitProp(100) } },
      handler: async (a, ctx) => {
        const actor = await readerActor(ctx);
        const visible = d.corrCore.visibleWhere(actor);
        const take = clampLimit(a.limit, 30, 100);
        const now = new Date();
        const [sigs, refs] = await Promise.all([
          ctx.tenantDb.corrLetter.findMany({
            where: combineWhere({ status: 'PENDING_SIGNATURE', archivedAt: null }, visible) as never,
            select: { id: true, type: true, status: true, subject: true, letterNumber: true, confidentiality: true, signerUserId: true, submittedAt: true, priority: true, createdAt: true },
            orderBy: { submittedAt: 'asc' },
            take,
          }),
          ctx.tenantDb.corrReferral.findMany({
            where: { status: { in: ['PENDING', 'SEEN'] }, kind: 'ACTION', letter: visible as never },
            include: { letter: { select: { id: true, type: true, status: true, subject: true, letterNumber: true, confidentiality: true } } },
            orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
            take,
          }),
        ]);
        const signerIds = [...new Set(sigs.map((s) => s.signerUserId).filter((x): x is string => !!x))];
        const users = signerIds.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, name: true } }) : [];
        const nm = new Map(users.map((u) => [u.id, u.name]));
        return {
          pendingSignatures: sigs.map((s) => ({ ...maskLetterBrief(s), signer: s.signerUserId ? (nm.get(s.signerUserId) ?? null) : null, submittedAt: iso(s.submittedAt) })),
          openReferrals: refs.map((r) => ({
            letter: maskLetterBrief(r.letter),
            to: r.toName,
            from: r.fromName,
            status: r.status,
            dueAt: iso(r.dueAt),
            overdue: !!r.dueAt && r.dueAt < now,
            instruction: isNormal(r.letter.confidentiality) ? clip(r.instruction, 300) : MASKED,
          })),
        };
      },
    },
    {
      name: 'create_letter_draft',
      module: 'correspondence',
      kind: 'write',
      description:
        'ایجاد «پیش‌نویس» نامه‌ی صادره یا داخلی (نیازمند تأیید کاربر). نامه ارسال یا امضا نمی‌شود و شماره‌ی دبیرخانه نمی‌گیرد؛ کاربر پیش‌نویس را در پنل بازبینی و در گردش امضا می‌گذارد. متن را ساده (bodyText) بدهید.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['OUTGOING', 'INTERNAL'] },
          subject: { type: 'string', minLength: 2, maxLength: 300 },
          bodyText: { type: 'string', maxLength: 20000, description: 'متن ساده؛ هر بند با یک خط خالی جدا شود' },
          recipients: {
            type: 'array',
            maxItems: 20,
            items: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, title: { type: 'string', maxLength: 200 }, org: { type: 'string', maxLength: 200 } }, required: ['name'] },
          },
          categoryId: idProp('شناسه‌ی دسته'),
          priority: { type: 'string', enum: [...PRIORITIES] },
          confidentiality: { type: 'string', enum: AGENT_CONFIDENTIALITY, description: 'سطح «سری» برای ایجنت مجاز نیست' },
          letterDate: isoProp('تاریخ نامه'),
          responseDueAt: isoProp('مهلت پاسخ'),
          replyToLetterId: idProp('شناسه‌ی نامه‌ای که این پاسخ آن است'),
          relatedContactId: idProp('مخاطب مرتبط'),
          tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 10 },
        },
        required: ['type', 'subject'],
      },
      summarize: (a) => `ایجاد پیش‌نویس نامه‌ی ${a.type === 'INTERNAL' ? 'داخلی' : 'صادره'}: «${String(a.subject)}»`,
      validate: (a) => void toLetterDto(a),
      handler: async (a, ctx) => {
        const dto = toLetterDto(a);
        const actor = await d.corrCore.actor(ctx);
        const letter = await d.corrLetters.createDraft(ctx, actor, dto);
        return { id: letter.id, status: letter.status, type: letter.type };
      },
    },
    {
      name: 'register_incoming_letter',
      module: 'correspondence',
      kind: 'write',
      description:
        'ثبت یک نامه‌ی وارده در دبیرخانه (نیازمند تأیید کاربر): شماره‌ی دبیرخانه خودکار صادر می‌شود و شماره/تاریخ اصلیِ نامه (externalNumber/externalDate) جداگانه ثبت می‌شود. نامه‌ی تکراری (همان فرستنده+شماره+تاریخ) رد می‌شود. فایل اسکن را کاربر در پنل پیوست می‌کند.',
      operation: 'CREATE',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 300 },
          externalNumber: { type: 'string', maxLength: 100, description: 'شماره‌ی روی نامه‌ی فرستنده' },
          externalDate: isoProp('تاریخ روی نامه‌ی فرستنده'),
          receivedAt: isoProp('زمان دریافت'),
          deliveryMethod: { type: 'string', enum: [...DELIVERY_METHODS] },
          senderOrgName: { type: 'string', maxLength: 200 },
          senderName: { type: 'string', maxLength: 200 },
          senderContactId: idProp('مخاطب فرستنده در CRM'),
          bodyText: { type: 'string', maxLength: 20000, description: 'خلاصه/متن نامه' },
          categoryId: idProp('شناسه‌ی دسته'),
          priority: { type: 'string', enum: [...PRIORITIES] },
          confidentiality: { type: 'string', enum: AGENT_CONFIDENTIALITY },
          pageCount: { type: 'integer', minimum: 0, maximum: 100000 },
          responseDueAt: isoProp('مهلت پاسخ'),
          tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 10 },
        },
        required: ['subject'],
      },
      summarize: (a) => `ثبت نامه‌ی وارده «${String(a.subject)}»${a.externalNumber ? ` (شماره‌ی اصلی ${String(a.externalNumber)})` : ''}`,
      validate: (a) => void toIncomingDto(a),
      handler: async (a, ctx) => {
        const dto = toIncomingDto(a);
        const actor = await d.corrCore.actor(ctx);
        const letter: any = await d.corrLetters.registerIncoming(ctx, actor, dto);
        return { id: letter.id, letterNumber: letter.letterNumber, externalNumber: letter.externalNumber ?? null, status: letter.status };
      },
    },
  ];
}

function toLetterDto(a: Record<string, unknown>): CreateLetterDto {
  const { bodyText, tags, ...rest } = a as { bodyText?: string; tags?: string[] } & Record<string, unknown>;
  return parseDto(CreateLetterDto, {
    ...rest,
    ...(bodyText ? { bodyHtml: htmlFromText(bodyText) } : {}),
    tags: [...(tags ?? []), 'پیش‌نویس-دستیار-هوشمند'].slice(0, 20),
  });
}

function toIncomingDto(a: Record<string, unknown>): RegisterIncomingDto {
  const { bodyText, tags, ...rest } = a as { bodyText?: string; tags?: string[] } & Record<string, unknown>;
  // allowDuplicate و referral عمداً قابل‌تنظیم نیستند: ایجنت نباید قاعده‌ی ضدتکرار را دور بزند.
  return parseDto(RegisterIncomingDto, { ...rest, ...(bodyText ? { bodyHtml: htmlFromText(bodyText) } : {}), ...(tags ? { tags } : {}) });
}
