import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { faDate } from '../common/persian.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AttachmentAccessService } from './attachment-access.service.js';
import { CHECKLIST_ITEM_ENTITY } from '../daily-checklist/checklist-attachment.util.js';

export type ConversionTarget = 'KNOWLEDGE' | 'CONFIDENTIAL';
export type ConfidentialCategory = 'PASSWORD' | 'TECHNICAL_KNOWLEDGE' | 'FORMULATION' | 'CONFIDENTIAL_CONTRACT' | 'SYSTEM_LOG' | 'OTHER';

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** نام فایل برای دانلود/بایگانی: نام انتخابیِ کاربر + پسوند حدس‌زده‌شده از نوع فایل. */
export function fileNameWithExtension(title: string, dataUri: string): string {
  const mime = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(dataUri)?.[1];
  const ext = mime ? MIME_EXT[mime] : undefined;
  return ext && !title.toLowerCase().endsWith(`.${ext}`) ? `${title}.${ext}` : title;
}

/**
 * تبدیل پیوستِ آیتم چک‌لیست (یا نسخه‌ی بایگانی‌شده‌ی آن در گزارش روزانه) به «دانش سازمانی»
 * (گزارشِ isKnowledge در ماژول گزارش‌ها — همان مکانیزم موجود «تبدیل به دانش سازمانی») یا به یک
 * «سند محرمانه». فایل مبدأ دست‌نخورده می‌ماند و منبع/کاربر/زمان ثبت می‌شود.
 * همه‌ی چک‌ها سمت سرور است: دسترسی به خود پیوست، فعال‌بودن ماژولِ مقصد و مجوزِ کاربر روی مقصد.
 */
@Injectable()
export class AttachmentConversionService {
  constructor(
    private readonly access: AttachmentAccessService,
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async convert(
    ctx: TenantRequestContext,
    attachmentId: string,
    target: ConversionTarget,
    opts: { title?: string; category?: ConfidentialCategory } = {},
  ) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new ForbiddenException('این عملیات فقط برای یک نشست کاربر واقعی ممکن است');

    const att = await ctx.tenantDb.attachment.findUnique({ where: { id: attachmentId } });
    if (!att) throw new NotFoundException('پیوست یافت نشد');
    const eligible = att.entityType === CHECKLIST_ITEM_ENTITY || (att.entityType === 'Report' && !!att.sourceAttachmentId);
    if (!eligible) throw new BadRequestException('فقط فایل‌های چک‌لیست روزانه (و نسخه‌ی بایگانی‌شده‌ی آن‌ها در گزارش روزانه) قابل تبدیل‌اند');

    await this.access.assertAccess(ctx, att.entityType, att.entityId, 'read');

    const moduleCode = target === 'KNOWLEDGE' ? 'reports' : 'confidential-archive';
    if (!(await isModuleEnabled(this.controlDb, ctx.tenantId, moduleCode))) {
      throw new ForbiddenException(
        target === 'KNOWLEDGE' ? 'ماژول گزارش‌ها (دانش سازمانی) برای این محیط کاری فعال نیست' : 'ماژول اسناد محرمانه برای این محیط کاری فعال نیست',
      );
    }
    // دانش سازمانی = گزارشِ جدید در ماژول گزارش‌ها → همان مجوز «ایجاد». سند محرمانه: قاعده‌ی خود ماژول
    // (هر کاربرِ واقعی با ماژول فعال می‌تواند ثبت کند؛ دیدنِ آرشیو جدا با OTP + مجوز است).
    if (target === 'KNOWLEDGE') await this.permissions.assertCreate(ctx, 'reports');

    const rootId = att.sourceAttachmentId ?? att.id;
    const previous = await ctx.tenantDb.attachmentConversion.findMany({ where: { attachmentId: rootId, target } });
    for (const p of previous) {
      const stillThere =
        target === 'KNOWLEDGE'
          ? await ctx.tenantDb.report.findUnique({ where: { id: p.targetId }, select: { id: true } })
          : await ctx.tenantDb.confidentialDocument.findUnique({ where: { id: p.targetId }, select: { id: true } });
      if (stillThere) throw new BadRequestException('این فایل قبلاً به همین مقصد تبدیل شده است');
    }

    const title = (opts.title ?? att.title).replace(/\s+/g, ' ').trim();
    if (title.length < 2) throw new BadRequestException('نام باید حداقل ۲ نویسه باشد');

    const [user, origin] = await Promise.all([
      ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.describeOrigin(ctx, att),
    ]);
    const provenance = [
      `منبع: فایل «${att.title}» — ${origin}`,
      `تبدیل‌شده توسط ${user?.name ?? 'کاربر'} در ${faDate(new Date())}`,
    ].join('\n');

    let targetId: string;
    if (target === 'KNOWLEDGE') {
      const report = await ctx.tenantDb.report.create({
        data: { title, body: provenance, isKnowledge: true, createdByUserId: userId },
        select: { id: true },
      });
      await ctx.tenantDb.attachment.create({
        data: { entityType: 'Report', entityId: report.id, title, fileUrl: att.fileUrl, createdByUserId: userId, sourceNote: origin },
      });
      targetId = report.id;
    } else {
      const isData = att.fileUrl.startsWith('data:');
      const doc = await ctx.tenantDb.confidentialDocument.create({
        data: {
          title,
          category: opts.category ?? 'OTHER',
          content: isData ? provenance : `${provenance}\nلینک فایل: ${att.fileUrl}`,
          fileName: isData ? fileNameWithExtension(title, att.fileUrl) : undefined,
          fileData: isData ? att.fileUrl : undefined,
          ownerOnly: true, // امن‌ترین پیش‌فرض: فقط سازنده + مالک/مدیر
          createdByUserId: userId,
        },
        select: { id: true },
      });
      targetId = doc.id;
    }

    await ctx.tenantDb.attachmentConversion.create({
      data: { attachmentId: rootId, target, targetId, sourceTitle: att.title, convertedByUserId: userId, convertedByName: user?.name },
    });
    return { target, targetId, title };
  }

  private async describeOrigin(
    ctx: TenantRequestContext,
    att: { entityType: string; entityId: string; sourceNote: string | null },
  ): Promise<string> {
    if (att.entityType === CHECKLIST_ITEM_ENTITY) {
      const item = await ctx.tenantDb.dailyChecklistItem.findUnique({ where: { id: att.entityId }, select: { title: true, date: true } });
      return item ? `از آیتم «${item.title}» در چک‌لیست روزانه‌ی ${faDate(item.date)}` : 'از چک‌لیست روزانه';
    }
    const report = await ctx.tenantDb.report.findUnique({ where: { id: att.entityId }, select: { title: true } });
    return `از گزارش «${report?.title ?? ''}»${att.sourceNote ? ` (آیتم «${att.sourceNote}»)` : ''}`;
  }
}
