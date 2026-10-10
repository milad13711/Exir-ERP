import { HttpException, HttpStatus, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ActivityLogService } from '../activity/activity-log.service.js';
import { getManagerUsers } from '../common/manager-users.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { publicRef } from '../common/tenant-public-key.js';
import { describeAttachment, type PublicTenantCtx } from '../proposals/public-proposals.service.js';
import { computeProjectProgress } from './project-progress.js';
import { PUBLIC_INVOICE_HIDDEN_STATUSES } from './project-collab.service.js';
import type { PublicProjectCommentDto } from './dto/project-collab.dto.js';

export const MAX_CUSTOMER_COMMENTS_PER_WINDOW = 5;
export const COMMENT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_CUSTOMER_COMMENTS_TOTAL = 200;
/** حداقل فاصله‌ی دو اعلان «کامنت جدید مشتری» برای یک پروژه */
export const COMMENT_NOTIFY_THROTTLE_MS = 5 * 60 * 1000;

const SAFE_INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const TOKEN_PATTERN = /^[0-9a-fA-F-]{20,64}$/;

/** متن ورودی مشتری: بدون تگ HTML و کاراکتر کنترلی (رندر هم در فرانت escape می‌شود). */
export function sanitizeCustomerText(input: string): string {
  return input
    .replace(/<[^>]*>?/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** وضعیت مرحله برای مشتری: جزئیات تأیید/رد داخلی فاش نمی‌شود. */
export function publicStageStatus(status: string): 'DONE' | 'IN_PROGRESS' | 'PENDING' {
  return status === 'DONE' ? 'DONE' : status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING';
}

/**
 * صفحه‌ی عمومی پیگیری پروژه برای مشتری — فقط با publicToken غیرقابل‌حدس و فقط وقتی لینک عمومی «روشن» است.
 * خروجی کاملاً allow-list است: هیچ یادداشت داخلی، بودجه، هزینه، مسئول/تلفن، شناسه‌ی داخلی، جزئیات تأیید یا
 * پروپوزال/فاکتور بدون پرچم، و هیچ آیتم مرحله‌ای که «نمایش به مشتری» نشده باشد برنمی‌گردد.
 */
@Injectable()
export class PublicProjectsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityLogService,
  ) {}

  private async findByToken(t: PublicTenantCtx, token: string) {
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException('پروژه یافت نشد');
    const project = await t.tenantDb.project.findUnique({ where: { publicToken: token } });
    if (!project || !project.publicEnabled) throw new NotFoundException('پروژه یافت نشد');
    // ماژول پروژه برای این تننت غیرفعال شده = لینک بسته
    if (!(await isModuleEnabled(this.controlDb, t.tenantId, 'projects'))) throw new NotFoundException('پروژه یافت نشد');
    return project;
  }

  async view(t: PublicTenantCtx, token: string) {
    const project = await this.findByToken(t, token);
    const [stages, notes, contact, logoSetting, phoneSetting, addressSetting, proposalsOn, salesOn] = await Promise.all([
      t.tenantDb.projectStage.findMany({
        where: { projectId: project.id },
        orderBy: { order: 'asc' },
        include: { links: { where: { visibleToCustomer: true }, orderBy: { createdAt: 'asc' } } },
      }),
      t.tenantDb.projectNote.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }),
      project.contactId ? t.tenantDb.crmContact.findUnique({ where: { id: project.contactId }, select: { name: true, company: true } }) : Promise.resolve(null),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'logoUrl' } }, select: { value: true } }),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'phone' } }, select: { value: true } }),
      t.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'address' } }, select: { value: true } }),
      isModuleEnabled(this.controlDb, t.tenantId, 'proposals'),
      isModuleEnabled(this.controlDb, t.tenantId, 'sales'),
    ]);
    const str = (v: { value: unknown } | null) => (typeof v?.value === 'string' && v.value ? v.value : null);

    const stageIds = stages.map((s) => s.id);
    const attachments = stageIds.length
      ? await t.tenantDb.attachment.findMany({ where: { entityType: 'ProjectStage', entityId: { in: stageIds }, visibleToCustomer: true }, orderBy: { createdAt: 'asc' }, select: { id: true, entityId: true, title: true, fileUrl: true } })
      : [];

    const progress = computeProjectProgress(stages);

    const stageNotes = (stageId: string) =>
      notes
        .filter((n) => n.stageId === stageId && n.source === 'STAFF' && !n.parentId && n.visibleToCustomer)
        .map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt }));

    // کامنت‌های مشتری (سطح پروژه) + فقط پاسخ‌هایی که صریحاً «نمایش به مشتری» شده‌اند
    const customerNotes = notes.filter((n) => n.source === 'CUSTOMER' && !n.parentId);
    const comments = customerNotes.map((c) => ({
      id: c.id,
      authorName: c.authorName ?? 'مشتری',
      body: c.body,
      createdAt: c.createdAt,
      replies: notes
        .filter((r) => r.parentId === c.id && r.source === 'STAFF' && r.visibleToCustomer)
        .map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt })),
    }));

    const [proposals, invoices] = await Promise.all([
      proposalsOn
        ? t.tenantDb.proposal.findMany({
            where: { projectId: project.id, projectShowOnPublicLink: true, status: { not: 'DRAFT' } },
            select: { proposalNo: true, title: true, amount: true, status: true, issuedAt: true, publicToken: true },
            orderBy: { issuedAt: 'desc' },
          })
        : [],
      salesOn
        ? t.tenantDb.salesInvoice.findMany({
            where: { projectId: project.id, projectShowOnPublicLink: true, status: { notIn: [...PUBLIC_INVOICE_HIDDEN_STATUSES] } },
            select: { invoiceNo: true, total: true, status: true, issuedAt: true, publicToken: true },
            orderBy: { issuedAt: 'desc' },
          })
        : [],
    ]);
    const ref = publicRef(t.tenantSlug);

    return {
      seller: { name: t.tenantName, logoUrl: str(logoSetting), phone: str(phoneSetting), address: str(addressSetting) },
      projectNo: project.projectNo,
      name: project.name,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      customer: contact ? { name: contact.name, company: contact.company } : null,
      progress: { percent: progress.progressPercent, doneStages: progress.doneStages, totalStages: progress.totalStages, hasStages: progress.hasStages },
      stages: stages.map((s, i) => {
        const atts = attachments.filter((a) => a.entityId === s.id).map((a) => ({ id: a.id, title: a.title, ...describeAttachment(a.fileUrl) }));
        return {
          index: i + 1,
          title: s.title,
          status: publicStageStatus(s.status),
          completedAt: s.status === 'DONE' ? s.completedAt : null,
          description: s.descriptionVisibleToCustomer ? s.description : null,
          links: s.links.map((l) => ({ id: l.id, title: l.title, url: l.url })),
          images: atts.filter((a) => a.isImage).map((a) => ({ id: a.id, title: a.title })),
          files: atts.filter((a) => !a.isImage).map((a) => ({ id: a.id, title: a.title, sizeBytes: a.sizeBytes, externalUrl: a.externalUrl })),
          notes: stageNotes(s.id),
        };
      }),
      documents: [
        ...proposals.map((p) => ({ kind: 'PROPOSAL' as const, number: p.proposalNo, title: p.title, amount: p.amount, status: p.status, date: p.issuedAt, path: `/proposal/${ref}/${p.publicToken}` })),
        ...invoices.map((i) => ({ kind: 'INVOICE' as const, number: i.invoiceNo, title: `فاکتور شماره ${i.invoiceNo}`, amount: i.total, status: i.status, date: i.issuedAt, path: `/invoice/${ref}/${i.publicToken}` })),
      ],
      comments,
    };
  }

  /** فایل پیوست مرحله (فقط اگر نمایش به مشتری شده): تصویر امن inline، بقیه اجباراً دانلود — همان قواعد پروپوزال. */
  async getFile(t: PublicTenantCtx, token: string, attachmentId: string) {
    const project = await this.findByToken(t, token);
    const stages = await t.tenantDb.projectStage.findMany({ where: { projectId: project.id }, select: { id: true } });
    const att = await t.tenantDb.attachment.findFirst({
      where: { id: attachmentId, entityType: 'ProjectStage', entityId: { in: stages.map((s) => s.id) }, visibleToCustomer: true },
    });
    if (!att) throw new NotFoundException('فایل یافت نشد');
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(att.fileUrl);
    if (!m) throw new NotFoundException('فایل یافت نشد');
    const inline = SAFE_INLINE_IMAGE.test(m[1]);
    return { buffer: Buffer.from(m[2], 'base64'), mimeType: inline ? m[1] : 'application/octet-stream', title: att.title, inline };
  }

  /** گیرندگان اعلان: مدیر پروژه + سازنده؛ اگر هیچ‌کدام نبود، مدیران (مالک/ادمین). */
  private async recipients(t: PublicTenantCtx, p: { managerUserId: string | null; createdByUserId: string | null }): Promise<string[]> {
    const ids = new Set<string>();
    if (p.managerUserId) ids.add(p.managerUserId);
    if (p.createdByUserId) ids.add(p.createdByUserId);
    if (ids.size === 0) {
      const managers = await getManagerUsers(this.controlDb, t.tenantDb, t.tenantId).catch(() => []);
      for (const m of managers) ids.add(m.tenantUserId);
    }
    return [...ids];
  }

  async comment(t: PublicTenantCtx, token: string, dto: PublicProjectCommentDto) {
    const project = await this.findByToken(t, token);
    const body = sanitizeCustomerText(dto.body);
    if (!body) throw new BadRequestException('متن نظر خالی است');
    const authorName = sanitizeCustomerText(dto.name ?? '').slice(0, 60) || 'مشتری';

    const [recent, total] = await Promise.all([
      t.tenantDb.projectNote.count({ where: { projectId: project.id, source: 'CUSTOMER', createdAt: { gt: new Date(Date.now() - COMMENT_WINDOW_MS) } } }),
      t.tenantDb.projectNote.count({ where: { projectId: project.id, source: 'CUSTOMER' } }),
    ]);
    if (recent >= MAX_CUSTOMER_COMMENTS_PER_WINDOW || total >= MAX_CUSTOMER_COMMENTS_TOTAL) {
      throw new HttpException('تعداد پیام‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }

    const created = await t.tenantDb.projectNote.create({
      data: { projectId: project.id, source: 'CUSTOMER', authorName, body, visibleToCustomer: true },
      select: { id: true, authorName: true, body: true, createdAt: true },
    });

    this.activity.logSystem(t.tenantDb, {
      action: 'projects.customer_comment',
      moduleCode: 'projects',
      actionType: 'create',
      actorType: 'AUTOMATIC',
      entityType: 'Project',
      entityId: project.id,
      summary: `کامنت مشتری روی پروژه‌ی «${project.name}»`,
    });

    // اعلان با محدودیت تکرار؛ شرط در خود به‌روزرسانی تا دو کامنت هم‌زمان دو اعلان نسازند
    const cutoff = new Date(Date.now() - COMMENT_NOTIFY_THROTTLE_MS);
    const claimed = await t.tenantDb.project.updateMany({
      where: { id: project.id, OR: [{ lastCustomerCommentNotifiedAt: null }, { lastCustomerCommentNotifiedAt: { lt: cutoff } }] },
      data: { lastCustomerCommentNotifiedAt: new Date() },
    });
    if (claimed.count > 0) {
      for (const userId of await this.recipients(t, project)) {
        await this.notifications.notify(t.tenantDb, {
          userId,
          type: 'projects.customer_comment',
          title: `کامنت جدید مشتری روی پروژه‌ی «${project.name}»`,
          body: body.slice(0, 160),
          link: `/projects?id=${project.id}`,
        });
      }
    }
    return { id: created.id, authorName: created.authorName ?? 'مشتری', body: created.body, createdAt: created.createdAt, replies: [] };
  }
}
