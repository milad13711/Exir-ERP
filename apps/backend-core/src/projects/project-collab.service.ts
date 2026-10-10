import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { isModuleEnabled } from '../common/module-enabled.util.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { proposalScope } from '../permissions/entity-scopes.js';
import { assertInScope } from '../permissions/scope.util.js';
import { publicRef } from '../common/tenant-public-key.js';
import type { CreateProjectNoteDto, CreateStageLinkDto } from './dto/project-collab.dto.js';

type Scope = Record<string, unknown>;

/** پروپوزال و فاکتورِ قابل‌نمایش به مشتری: پیش‌نویس هرگز؛ فاکتور لغوشده هم نه. */
export const PUBLIC_INVOICE_HIDDEN_STATUSES = ['DRAFT', 'CANCELLED'] as const;

/**
 * همکاری روی پروژه: لینک عمومی، یادداشت‌ها/پاسخ‌ها، لینک‌ها و پیوست‌های مرحله (نمایش به مشتری) و اسناد مرتبط
 * (پروپوزال/فاکتور). همه‌ی متدها «projectId»ی را می‌گیرند که کنترلر پیش‌تر با دامنه‌ی دسترسی کاربر
 * (assertInScope → ۴۰۴) بررسی کرده است؛ این سرویس خودش هم وابستگی مرحله/یادداشت به همان پروژه را تضمین می‌کند.
 */
@Injectable()
export class ProjectCollabService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── لینک عمومی ───────────────────────────────────────────────────────

  private async getProject(ctx: TenantRequestContext, id: string) {
    const p = await ctx.tenantDb.project.findUnique({ where: { id }, select: { id: true, publicToken: true, publicEnabled: true } });
    if (!p) throw new NotFoundException('پروژه یافت نشد');
    return p;
  }

  private linkPayload(ctx: TenantRequestContext, p: { publicToken: string; publicEnabled: boolean }, publicWebUrl: string) {
    return { enabled: p.publicEnabled, url: `${publicWebUrl.replace(/\/$/, '')}/project/${publicRef(ctx.tenantSlug)}/${p.publicToken}` };
  }

  async getPublicLink(ctx: TenantRequestContext, id: string, publicWebUrl: string) {
    return this.linkPayload(ctx, await this.getProject(ctx, id), publicWebUrl);
  }

  async setPublicLink(ctx: TenantRequestContext, id: string, enabled: boolean, publicWebUrl: string) {
    await this.getProject(ctx, id);
    const p = await ctx.tenantDb.project.update({ where: { id }, data: { publicEnabled: enabled }, select: { publicToken: true, publicEnabled: true } });
    return this.linkPayload(ctx, p, publicWebUrl);
  }

  /** توکن جدید؛ لینک قبلی فوراً از کار می‌افتد. */
  async regeneratePublicLink(ctx: TenantRequestContext, id: string, publicWebUrl: string) {
    await this.getProject(ctx, id);
    const p = await ctx.tenantDb.project.update({ where: { id }, data: { publicToken: randomUUID() }, select: { publicToken: true, publicEnabled: true } });
    return this.linkPayload(ctx, p, publicWebUrl);
  }

  // ── یادداشت‌ها ───────────────────────────────────────────────────────

  async listNotes(ctx: TenantRequestContext, projectId: string) {
    const notes = await ctx.tenantDb.projectNote.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
    return notes.map((n) => ({
      id: n.id,
      stageId: n.stageId,
      parentId: n.parentId,
      source: n.source,
      authorName: n.source === 'CUSTOMER' ? n.authorName ?? 'مشتری' : n.author?.name ?? n.authorName ?? null,
      body: n.body,
      visibleToCustomer: n.visibleToCustomer,
      createdAt: n.createdAt,
    }));
  }

  /**
   * یادداشت/پاسخ کارکنان. قاعده‌ی نمایش: فقط (الف) یادداشت روی یک مرحله یا (ب) پاسخ به کامنت مشتری
   * می‌تواند «نمایش به مشتری» باشد؛ یادداشت سطح پروژه همیشه خصوصی است.
   */
  async addNote(ctx: TenantRequestContext, projectId: string, dto: CreateProjectNoteDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('متن یادداشت خالی است');
    let stageId: string | null = null;
    if (dto.stageId) {
      const stage = await ctx.tenantDb.projectStage.findFirst({ where: { id: dto.stageId, projectId }, select: { id: true } });
      if (!stage) throw new NotFoundException('مرحله یافت نشد');
      stageId = stage.id;
    }
    let parent: { id: string; source: string; parentId: string | null; stageId: string | null } | null = null;
    if (dto.parentId) {
      parent = await ctx.tenantDb.projectNote.findFirst({ where: { id: dto.parentId, projectId }, select: { id: true, source: true, parentId: true, stageId: true } });
      if (!parent) throw new NotFoundException('یادداشت یافت نشد');
      if (parent.parentId) throw new BadRequestException('پاسخ را روی یادداشت اصلی بدهید');
    }
    const wantsVisible = dto.visibleToCustomer === true;
    if (wantsVisible && !stageId && !(parent && parent.source === 'CUSTOMER')) {
      throw new BadRequestException('فقط یادداشت‌های یک مرحله یا پاسخ به کامنت مشتری قابل نمایش به مشتری هستند');
    }
    const authorUserId = await resolveTenantUserId(ctx);
    const created = await ctx.tenantDb.projectNote.create({
      data: {
        projectId,
        stageId: stageId ?? parent?.stageId ?? null,
        parentId: parent?.id ?? null,
        source: 'STAFF',
        authorUserId,
        body,
        visibleToCustomer: wantsVisible,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    return {
      id: created.id,
      stageId: created.stageId,
      parentId: created.parentId,
      source: created.source,
      authorName: created.author?.name ?? null,
      body: created.body,
      visibleToCustomer: created.visibleToCustomer,
      createdAt: created.createdAt,
    };
  }

  async setNoteVisibility(ctx: TenantRequestContext, projectId: string, noteId: string, visible: boolean) {
    const note = await ctx.tenantDb.projectNote.findFirst({ where: { id: noteId, projectId }, include: { parent: { select: { source: true } } } });
    if (!note) throw new NotFoundException('یادداشت یافت نشد');
    // کامنت خودِ مشتری همیشه برای خودش دیده می‌شود؛ پرچم برای آن بی‌معنی است
    if (note.source === 'CUSTOMER') throw new BadRequestException('کامنت مشتری همیشه در لینک عمومی دیده می‌شود');
    if (visible && !note.stageId && note.parent?.source !== 'CUSTOMER') {
      throw new BadRequestException('فقط یادداشت‌های یک مرحله یا پاسخ به کامنت مشتری قابل نمایش به مشتری هستند');
    }
    await ctx.tenantDb.projectNote.update({ where: { id: noteId }, data: { visibleToCustomer: visible } });
    return { id: noteId, visibleToCustomer: visible };
  }

  async removeNote(ctx: TenantRequestContext, projectId: string, noteId: string) {
    const note = await ctx.tenantDb.projectNote.findFirst({ where: { id: noteId, projectId }, select: { id: true } });
    if (!note) throw new NotFoundException('یادداشت یافت نشد');
    await ctx.tenantDb.projectNote.delete({ where: { id: noteId } });
    return { success: true };
  }

  // ── لینک‌ها و پیوست‌های مرحله ────────────────────────────────────────

  private async requireStage(ctx: TenantRequestContext, projectId: string, stageId: string) {
    const stage = await ctx.tenantDb.projectStage.findFirst({ where: { id: stageId, projectId }, select: { id: true } });
    if (!stage) throw new NotFoundException('مرحله یافت نشد');
  }

  async addStageLink(ctx: TenantRequestContext, projectId: string, stageId: string, dto: CreateStageLinkDto) {
    await this.requireStage(ctx, projectId, stageId);
    return ctx.tenantDb.projectStageLink.create({
      data: { stageId, title: dto.title.trim(), url: dto.url.trim(), visibleToCustomer: dto.visibleToCustomer === true },
    });
  }

  async setStageLinkVisibility(ctx: TenantRequestContext, projectId: string, stageId: string, linkId: string, visible: boolean) {
    await this.requireStage(ctx, projectId, stageId);
    const res = await ctx.tenantDb.projectStageLink.updateMany({ where: { id: linkId, stageId }, data: { visibleToCustomer: visible } });
    if (res.count === 0) throw new NotFoundException('لینک یافت نشد');
    return { id: linkId, visibleToCustomer: visible };
  }

  async removeStageLink(ctx: TenantRequestContext, projectId: string, stageId: string, linkId: string) {
    await this.requireStage(ctx, projectId, stageId);
    const res = await ctx.tenantDb.projectStageLink.deleteMany({ where: { id: linkId, stageId } });
    if (res.count === 0) throw new NotFoundException('لینک یافت نشد');
    return { success: true };
  }

  async setStageAttachmentVisibility(ctx: TenantRequestContext, projectId: string, stageId: string, attachmentId: string, visible: boolean) {
    await this.requireStage(ctx, projectId, stageId);
    const res = await ctx.tenantDb.attachment.updateMany({ where: { id: attachmentId, entityType: 'ProjectStage', entityId: stageId }, data: { visibleToCustomer: visible } });
    if (res.count === 0) throw new NotFoundException('پیوست یافت نشد');
    return { id: attachmentId, visibleToCustomer: visible };
  }

  // ── اسناد مرتبط: پروپوزال و فاکتور ───────────────────────────────────

  private async proposalsScopeOrNull(ctx: TenantRequestContext): Promise<Scope | null> {
    try {
      return await proposalScope(this.permissions, ctx);
    } catch (e) {
      if (e instanceof ForbiddenException) return null;
      throw e;
    }
  }

  private async invoiceScopeOrNull(ctx: TenantRequestContext): Promise<Scope | null> {
    try {
      return await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    } catch (e) {
      if (e instanceof ForbiddenException) return null;
      throw e;
    }
  }

  /** پروپوزال‌ها/فاکتورهای متصل به پروژه؛ ماژول غیرفعال یا نبود دسترسی مشاهده = فهرست خالی با پرچم. */
  async listDocuments(ctx: TenantRequestContext, projectId: string) {
    const [proposalsOn, salesOn] = await Promise.all([
      isModuleEnabled(this.controlDb, ctx.tenantId, 'proposals'),
      isModuleEnabled(this.controlDb, ctx.tenantId, 'sales'),
    ]);
    let proposals: unknown[] = [];
    let canViewProposals = false;
    if (proposalsOn) {
      const scope = await this.proposalsScopeOrNull(ctx);
      if (scope) {
        canViewProposals = true;
        proposals = await ctx.tenantDb.proposal.findMany({
          where: { AND: [{ projectId }, scope] },
          select: { id: true, proposalNo: true, title: true, status: true, amount: true, issuedAt: true, projectShowOnPublicLink: true, contact: { select: { name: true, company: true } } },
          orderBy: { issuedAt: 'desc' },
        });
      }
    }
    let invoices: unknown[] = [];
    let canViewInvoices = false;
    if (salesOn) {
      const scope = await this.invoiceScopeOrNull(ctx);
      if (scope) {
        canViewInvoices = true;
        invoices = await ctx.tenantDb.salesInvoice.findMany({
          where: { AND: [{ projectId }, scope] },
          select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true, issuedAt: true, projectShowOnPublicLink: true },
          orderBy: { issuedAt: 'desc' },
        });
      }
    }
    return {
      proposals: { enabled: proposalsOn, canView: canViewProposals, items: proposals },
      invoices: { enabled: salesOn, canView: canViewInvoices, items: invoices },
    };
  }

  private async requireModule(ctx: TenantRequestContext, code: 'proposals' | 'sales', label: string) {
    if (!(await isModuleEnabled(this.controlDb, ctx.tenantId, code))) {
      throw new ForbiddenException(`ماژول «${label}» برای این محیط کاری فعال نیست`);
    }
  }

  /** پروپوزال را در دامنه‌ی مشاهده‌ی کاربر پیدا می‌کند؛ خارج از دامنه = ۴۰۴. */
  private async scopedProposal(ctx: TenantRequestContext, proposalId: string) {
    await this.requireModule(ctx, 'proposals', 'پیشنهادها');
    const scope = await proposalScope(this.permissions, ctx);
    await assertInScope(ctx.tenantDb.proposal, scope, { id: proposalId }, { message: 'پروپوزال یافت نشد' });
    const p = await ctx.tenantDb.proposal.findUnique({ where: { id: proposalId }, select: { id: true, projectId: true } });
    if (!p) throw new NotFoundException('پروپوزال یافت نشد');
    return p;
  }

  private async scopedInvoice(ctx: TenantRequestContext, invoiceId: string) {
    await this.requireModule(ctx, 'sales', 'فروش');
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    await assertInScope(ctx.tenantDb.salesInvoice, scope, { id: invoiceId }, { message: 'فاکتور یافت نشد' });
    const i = await ctx.tenantDb.salesInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, projectId: true } });
    if (!i) throw new NotFoundException('فاکتور یافت نشد');
    return i;
  }

  async linkProposal(ctx: TenantRequestContext, projectId: string, proposalId: string, show = false) {
    const p = await this.scopedProposal(ctx, proposalId);
    if (p.projectId && p.projectId !== projectId) throw new ConflictException('این پروپوزال به پروژه‌ی دیگری متصل است؛ ابتدا از آن جدا کنید');
    if (p.projectId === projectId) {
      await ctx.tenantDb.proposal.update({ where: { id: proposalId }, data: { projectShowOnPublicLink: show } });
      return { success: true };
    }
    // شرط projectId=null: دو اتصال هم‌زمان به دو پروژه، فقط یکی برنده می‌شود
    const res = await ctx.tenantDb.proposal.updateMany({ where: { id: proposalId, projectId: null }, data: { projectId, projectShowOnPublicLink: show } });
    if (res.count === 0) throw new ConflictException('این پروپوزال به پروژه‌ی دیگری متصل است؛ ابتدا از آن جدا کنید');
    return { success: true };
  }

  async setProposalShow(ctx: TenantRequestContext, projectId: string, proposalId: string, show: boolean) {
    await this.scopedProposal(ctx, proposalId);
    const res = await ctx.tenantDb.proposal.updateMany({ where: { id: proposalId, projectId }, data: { projectShowOnPublicLink: show } });
    if (res.count === 0) throw new NotFoundException('این پروپوزال به این پروژه متصل نیست');
    return { id: proposalId, showOnPublicLink: show };
  }

  async unlinkProposal(ctx: TenantRequestContext, projectId: string, proposalId: string) {
    await this.scopedProposal(ctx, proposalId);
    const res = await ctx.tenantDb.proposal.updateMany({ where: { id: proposalId, projectId }, data: { projectId: null, projectShowOnPublicLink: false } });
    if (res.count === 0) throw new NotFoundException('این پروپوزال به این پروژه متصل نیست');
    return { success: true };
  }

  async linkInvoice(ctx: TenantRequestContext, projectId: string, invoiceId: string, show = false) {
    const i = await this.scopedInvoice(ctx, invoiceId);
    if (i.projectId && i.projectId !== projectId) throw new ConflictException('این فاکتور به پروژه‌ی دیگری متصل است؛ ابتدا از آن جدا کنید');
    if (i.projectId === projectId) {
      await ctx.tenantDb.salesInvoice.update({ where: { id: invoiceId }, data: { projectShowOnPublicLink: show } });
      return { success: true };
    }
    const res = await ctx.tenantDb.salesInvoice.updateMany({ where: { id: invoiceId, projectId: null }, data: { projectId, projectShowOnPublicLink: show } });
    if (res.count === 0) throw new ConflictException('این فاکتور به پروژه‌ی دیگری متصل است؛ ابتدا از آن جدا کنید');
    return { success: true };
  }

  async setInvoiceShow(ctx: TenantRequestContext, projectId: string, invoiceId: string, show: boolean) {
    await this.scopedInvoice(ctx, invoiceId);
    const res = await ctx.tenantDb.salesInvoice.updateMany({ where: { id: invoiceId, projectId }, data: { projectShowOnPublicLink: show } });
    if (res.count === 0) throw new NotFoundException('این فاکتور به این پروژه متصل نیست');
    return { id: invoiceId, showOnPublicLink: show };
  }

  async unlinkInvoice(ctx: TenantRequestContext, projectId: string, invoiceId: string) {
    await this.scopedInvoice(ctx, invoiceId);
    const res = await ctx.tenantDb.salesInvoice.updateMany({ where: { id: invoiceId, projectId }, data: { projectId: null, projectShowOnPublicLink: false } });
    if (res.count === 0) throw new NotFoundException('این فاکتور به این پروژه متصل نیست');
    return { success: true };
  }
}
