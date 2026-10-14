import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/tenant-client/index.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { getManagerUsers } from '../common/manager-users.js';
import { publicRef } from '../common/tenant-public-key.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { renderFleetTemplate, ShipmentsService } from '../fleet/shipments.service.js';
import { DispatchAdjustmentService } from './dispatch-adjustment.service.js';
import { DispatchReceiptService } from './dispatch-receipt.service.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { DispatchSuggestionsService } from './dispatch-suggestions.service.js';
import { assertCanOverride, canOverride, dedupe, logEvent, resolveActor, shipmentLink, type Actor } from './dispatch-common.js';
import { docsComplete, missingDocTypes } from './dispatch-rules.js';
import { canPerformStep, dispatchViewWhere, isExplicitlyAllowed } from './dispatch-scope.js';
import type { DispatchSettings } from './dispatch-settings.js';
import {
  DispatchRuleError,
  STATUS_LABELS_FA,
  assertReason,
  assertStepAllowed,
  autoStatusAfter,
  statusForDocs,
  validateManualChange,
  type DispatchStep,
  type ProgressFacts,
} from './dispatch-state.js';
import { decideSourceAction, type SuggestionSourceType } from './dispatch-suggestions.js';
import { assertWeightValue, computeNetKg, roundKg, validateNetEdit } from './dispatch-weight.js';
import type {
  CleanlinessDto,
  DeclareShipmentDto,
  FinalCheckDto,
  GrossDto,
  ManualStatusDto,
  NetEditDto,
  TareDto,
} from './dto/dispatch.dto.js';

const FULL_INCLUDE = {
  loading: true,
  contact: { select: { id: true, name: true, company: true, phone: true, type: true, nationalId: true, legalId: true, uniqueId: true, postalCode: true, postalAddress: true, address: true } },
  driver: { select: { id: true, name: true, phone: true, plateNumber: true, vehicleType: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ShipmentInclude;
type ShipmentFull = Prisma.ShipmentGetPayload<{ include: typeof FULL_INCLUDE }>;
type Loaded = { shipment: ShipmentFull; handlerOnly: boolean };

type StepAccessKey = keyof DispatchSettings['steps'];

function wrapRule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DispatchRuleError) throw new BadRequestException(e.message);
    throw e;
  }
}

@Injectable()
export class DispatchService implements OnModuleInit {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly rules: DispatchRulesService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly controlDb: ControlPrismaService,
    private readonly fleet: ShipmentsService,
    private readonly sms: TenantSmsService,
    private readonly receipts: DispatchReceiptService,
    private readonly adjustments: DispatchAdjustmentService,
    private readonly suggestions: DispatchSuggestionsService,
  ) {}

  // ── کارتابل تأیید ───────────────────────────────────────────────────
  onModuleInit(): void {
    const parse = (entityId: string) => {
      const [shipmentId, kind] = entityId.split(':');
      return { shipmentId, kind };
    };
    this.approvals.registerHandler('DISPATCH_STEP', {
      approve: async (ctx, entityId, opts) => {
        const { shipmentId, kind } = parse(entityId);
        if (kind === 'CLEANLINESS') await this.cleanliness(ctx, shipmentId, { result: 'PASS', note: opts.note });
        else if (kind === 'FINAL_CHECK') await this.finalCheck(ctx, shipmentId, { result: 'PASS', note: opts.note, loadingCorrect: true, tarpInstalled: true });
        else if (kind === 'READY') await this.grantReady(ctx, shipmentId, { note: opts.note });
        else if (kind === 'WEIGHT') await this.confirmWeight(ctx, shipmentId, { note: opts.note });
        else throw new BadRequestException('نوع درخواست نامعتبر است');
      },
      reject: async (ctx, entityId, opts) => {
        const { shipmentId, kind } = parse(entityId);
        if (kind === 'CLEANLINESS') await this.cleanliness(ctx, shipmentId, { result: 'FAIL', note: opts.note ?? 'رد شد در کارتابل تأیید' });
        else if (kind === 'FINAL_CHECK') await this.finalCheck(ctx, shipmentId, { result: 'FAIL', note: opts.note ?? 'رد شد در کارتابل تأیید', loadingCorrect: false, tarpInstalled: false });
        else {
          const actor = await resolveActor(ctx);
          await logEvent(ctx.tenantDb, shipmentId, { type: 'approval_rejected', actor, note: `${kind}: ${opts.note ?? 'بدون توضیح'}` });
        }
      },
      describe: async (ctx, entityId) => {
        const { shipmentId, kind } = parse(entityId);
        const s = await ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { loading: true, driver: true } });
        const l = s.loading;
        const labels: Record<string, string> = { CLEANLINESS: 'تأیید نظافت ماشین', FINAL_CHECK: 'کنترل نهایی بار', READY: 'مجوز آماده حرکت', WEIGHT: 'تأیید وزن نهایی' };
        return {
          fields: [
            { label: 'درخواست', value: labels[kind] ?? kind },
            { label: 'بار', value: `#${s.shipmentNo} — ${s.cargoType}` },
            { label: 'مشتری', value: l?.customerName ?? '—' },
            { label: 'راننده / پلاک', value: `${s.driver?.name ?? '—'} / ${s.driver?.plateNumber ?? '—'}` },
            { label: 'وزن خالی / پر / خالص', value: `${l?.tareKg ?? '—'} / ${l?.grossKg ?? '—'} / ${l?.netKg ?? '—'} کیلوگرم` },
            { label: 'اسناد لازم', value: l?.requiredDocTypes.join('، ') || '—' },
            { label: 'وضعیت', value: STATUS_LABELS_FA[s.status as keyof typeof STATUS_LABELS_FA] ?? s.status },
          ],
        };
      },
    });
  }

  private async requestApproval(ctx: TenantRequestContext, s: Pick<ShipmentFull, 'id' | 'shipmentNo'>, kind: 'CLEANLINESS' | 'FINAL_CHECK' | 'READY' | 'WEIGHT', actor: Actor) {
    const titles = {
      CLEANLINESS: `تأیید نظافت ماشین — بار #${s.shipmentNo}`,
      FINAL_CHECK: `کنترل نهایی بار #${s.shipmentNo}`,
      READY: `مجوز آماده حرکت — بار #${s.shipmentNo}`,
      WEIGHT: `تأیید وزن نهایی بار #${s.shipmentNo}`,
    } as const;
    await this.approvals
      .request(ctx, {
        moduleCode: kind === 'WEIGHT' ? 'sales' : 'dispatch',
        entityType: 'DISPATCH_STEP',
        entityId: `${s.id}:${kind}`,
        title: titles[kind],
        link: shipmentLink(s.id),
        requestedByUserId: actor.userId ?? undefined,
      })
      .catch(() => undefined);
  }

  private closeApproval(ctx: TenantRequestContext, shipmentId: string, kind: string, status: 'APPROVED' | 'REJECTED' = 'APPROVED') {
    return this.approvals.closeForEntity(ctx, 'DISPATCH_STEP', `${shipmentId}:${kind}`, status).catch(() => undefined);
  }

  // ── دسترسی و بارگذاری ───────────────────────────────────────────────
  private async taskShipmentIds(ctx: TenantRequestContext, userId: string): Promise<string[]> {
    const tasks = await ctx.tenantDb.task.findMany({
      where: { relatedModule: 'Shipment', relatedEntityId: { not: null }, assignees: { some: { userId } } },
      select: { relatedEntityId: true },
      take: 500,
    });
    return tasks.map((t) => t.relatedEntityId!).filter(Boolean);
  }

  async isDocsHandler(ctx: TenantRequestContext, shipmentId: string, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    const t = await ctx.tenantDb.task.findFirst({
      where: { relatedModule: 'Shipment', relatedEntityId: shipmentId, assignees: { some: { userId } } },
      select: { id: true },
    });
    return !!t;
  }

  /** where دامنه‌ی دید؛ بدون دسترسی ۴۰۳. */
  async scopeWhere(ctx: TenantRequestContext, actor: Actor): Promise<Record<string, unknown>> {
    const m = await this.permissions.getEffective(ctx, 'dispatch');
    const taskIds = !m.canViewAll && m.canViewOwn && actor.userId ? await this.taskShipmentIds(ctx, actor.userId) : [];
    const where = dispatchViewWhere(m.canViewAll, m.canViewOwn, actor.userId, taskIds);
    if (where === null) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    return where;
  }

  /** بار را در دامنه‌ی کاربر می‌خواند؛ خارج از دامنه ۴۰۴. مسئول وظیفه‌ی اسناد حتی بدون ماتریس dispatch دسترسی محدود دارد. */
  async load(ctx: TenantRequestContext, actor: Actor, id: string): Promise<Loaded> {
    const m = await this.permissions.getEffective(ctx, 'dispatch');
    if (m.canViewAll || m.canViewOwn) {
      const where = await this.scopeWhere(ctx, actor);
      const s = await ctx.tenantDb.shipment.findFirst({ where: { id, ...where }, include: FULL_INCLUDE });
      if (s) return { shipment: s, handlerOnly: false };
    }
    if (await this.isDocsHandler(ctx, id, actor.userId)) {
      const s = await ctx.tenantDb.shipment.findUnique({ where: { id }, include: FULL_INCLUDE });
      if (s) return { shipment: s, handlerOnly: true };
    }
    throw new NotFoundException('بار یافت نشد');
  }

  private async loadForEdit(ctx: TenantRequestContext, id: string) {
    const actor = await resolveActor(ctx);
    const loaded = await this.load(ctx, actor, id);
    if (loaded.handlerOnly) throw new ForbiddenException('این کار فقط برای کاربران ماژول اعلام بار مجاز است');
    await this.permissions.assertEdit(ctx, 'dispatch');
    return { actor, shipment: loaded.shipment };
  }

  private async buildFacts(ctx: TenantRequestContext, s: ShipmentFull, settings: DispatchSettings): Promise<ProgressFacts & { attachedCodes: string[]; missing: string[] }> {
    const l = s.loading!;
    const [docs, receipt] = await Promise.all([
      ctx.tenantDb.shipmentDocument.findMany({ where: { shipmentId: s.id }, select: { docTypeCode: true } }),
      ctx.tenantDb.dispatchReceipt.findUnique({ where: { shipmentId: s.id }, select: { status: true } }),
    ]);
    const attachedCodes = docs.map((d) => d.docTypeCode);
    const complete = docsComplete(l.requiredDocTypes, attachedCodes);
    return {
      status: s.status,
      hasDriver: !!s.driverId,
      arrived: !!l.arrivedAt,
      cleanlinessResult: l.cleanlinessResult,
      tareKg: l.tareKg,
      loaded: !!l.loadedAt,
      grossKg: l.grossKg,
      netKg: l.netKg,
      loaderUserId: l.loaderUserId,
      finalCheckResult: l.finalCheckResult,
      docsRequired: l.requiredDocTypes.length > 0,
      docsComplete: complete,
      docsOverridden: !!l.docsOverrideAt,
      readyGranted: !!l.readyGrantedAt,
      departed: !!l.departedAt,
      receiptDone: receipt?.status === 'SIGNED' || receipt?.status === 'PAPER',
      receiptRequiredBeforeDeparture: settings.receipt.requiredBefore === 'DEPARTURE',
      receiptOverridden: !!l.receiptOverrideReason,
      needsWeighing: l.needsWeighing,
      weightConfirmed: !!l.weightConfirmedAt,
      attachedCodes,
      missing: missingDocTypes(l.requiredDocTypes, attachedCodes),
    };
  }

  /** اجرای یک مرحله: دسترسی ماتریس + مجوز نقش مرحله + پیش‌شرط‌های ماشین‌حالت. */
  private async guardStep(ctx: TenantRequestContext, id: string, step: DispatchStep, access: StepAccessKey | null) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    if (!shipment.loading) throw new BadRequestException('گردش اعلام بار برای این بار فعال نشده است؛ ابتدا آن را شروع کنید');
    const settings = await this.rules.getSettings(ctx.tenantDb);
    if (access && !canPerformStep(settings.steps[access], actor)) throw new ForbiddenException('این مرحله برای نقش شما مجاز نیست (تنظیمات ماژول اعلام بار)');
    const facts = await this.buildFacts(ctx, shipment, settings);
    wrapRule(() => assertStepAllowed(step, facts, actor.userId));
    return { actor, shipment, loading: shipment.loading, settings, facts };
  }

  private async moveStatus(ctx: TenantRequestContext, s: { id: string; status: string }, to: string, actor: Actor | null, ev: { type: string; note?: string | null; reason?: string | null; meta?: Record<string, unknown> }) {
    const res = await ctx.tenantDb.shipment.updateMany({ where: { id: s.id, status: s.status as never }, data: { status: to as never } });
    if (res.count === 0) throw new ConflictException('وضعیت بار همین الان تغییر کرد؛ صفحه را تازه کنید');
    await logEvent(ctx.tenantDb, s.id, { type: ev.type, fromStatus: s.status, toStatus: to, actor, note: ev.note, reason: ev.reason, meta: ev.meta });
    s.status = to;
  }

  private async advance(ctx: TenantRequestContext, s: { id: string; status: string }, step: DispatchStep, actor: Actor | null, note: string, meta?: Record<string, unknown>) {
    const to = autoStatusAfter(s.status, step);
    if (to) await this.moveStatus(ctx, s, to, actor, { type: 'status_auto', note, meta });
  }

  private async notifyUsers(ctx: TenantRequestContext, userIds: Array<string | null | undefined>, n: { type: string; title: string; body?: string; shipmentId: string }, except?: string | null) {
    for (const userId of dedupe(userIds.filter((u): u is string => !!u))) {
      if (userId === except) continue;
      await this.notifications.notify(ctx.tenantDb, { userId, type: n.type, title: n.title, body: n.body, link: shipmentLink(n.shipmentId) }).catch(() => undefined);
    }
  }

  private async managerIds(ctx: TenantRequestContext): Promise<string[]> {
    return (await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId)).map((m) => m.tenantUserId);
  }

  // ── فهرست / جزئیات ─────────────────────────────────────────────────
  async detail(ctx: TenantRequestContext, id: string) {
    const actor = await resolveActor(ctx);
    const { shipment, handlerOnly } = await this.load(ctx, actor, id);
    const settings = await this.rules.getSettings(ctx.tenantDb);
    const loading = shipment.loading;
    const [events, documents, docTypes, receipt, adjustment, task, matrix, overrideOk] = await Promise.all([
      ctx.tenantDb.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: 'asc' } }),
      ctx.tenantDb.shipmentDocument.findMany({ where: { shipmentId: id }, orderBy: { createdAt: 'asc' } }),
      this.rules.listDocTypes(ctx, true),
      ctx.tenantDb.dispatchReceipt.findUnique({ where: { shipmentId: id } }),
      this.adjustments.latestFor(ctx, id),
      loading?.docsTaskId
        ? ctx.tenantDb.task.findUnique({ where: { id: loading.docsTaskId }, select: { id: true, title: true, status: true, number: true, assignees: { select: { userId: true } } } })
        : Promise.resolve(null),
      this.permissions.getEffective(ctx, 'dispatch'),
      canOverride(this.permissions, ctx),
    ]);
    const attIds = documents.map((d) => d.attachmentId);
    const atts = attIds.length ? await ctx.tenantDb.attachment.findMany({ where: { id: { in: attIds } }, select: { id: true, title: true, createdAt: true, fileUrl: true } }) : [];
    const attById = new Map(atts.map((a) => [a.id, a]));
    const assigneeUsers = task?.assignees.length ? await ctx.tenantDb.user.findMany({ where: { id: { in: task.assignees.map((a) => a.userId) } }, select: { id: true, name: true } }) : [];

    let can: Record<string, boolean> = {};
    let facts: (ProgressFacts & { attachedCodes: string[]; missing: string[] }) | null = null;
    if (loading) {
      facts = await this.buildFacts(ctx, shipment, settings);
      const editor = !handlerOnly && matrix.canEdit;
      const ok = (step: DispatchStep, access: StepAccessKey | null) => {
        if (!editor) return false;
        if (access && !canPerformStep(settings.steps[access], actor)) return false;
        try {
          assertStepAllowed(step, facts!, actor.userId);
          return true;
        } catch {
          return false;
        }
      };
      const handler = handlerOnly || (await this.isDocsHandler(ctx, id, actor.userId));
      const readyAllowed = actor.manager || isExplicitlyAllowed(settings.steps.readyToDepart, actor) || handler;
      let readyOk = false;
      try {
        assertStepAllowed('READY', facts, actor.userId);
        readyOk = true;
      } catch {
        readyOk = false;
      }
      const terminal = shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED';
      can = {
        edit: editor,
        assignDriver: editor && !terminal && shipment.status !== 'SUSPENDED',
        arrival: ok('ARRIVAL', 'arrival'),
        cleanliness: ok('CLEANLINESS', 'cleanliness'),
        tare: ok('TARE', 'weighing'),
        loading: ok('LOADING', 'loading'),
        gross: ok('GROSS', 'weighing'),
        finalCheck: ok('FINAL_CHECK', 'finalCheck'),
        ready: readyAllowed && readyOk && !terminal && shipment.status !== 'SUSPENDED',
        depart: ok('DEPART', 'loading'),
        deliver: ok('DELIVER', 'loading'),
        docs: (editor || handler) && shipment.status !== 'CANCELLED',
        confirmWeight: editor && loading.needsWeighing && loading.grossKg != null && !loading.weightConfirmedAt && canPerformStep(settings.steps.weightConfirm, actor),
        editNet: overrideOk && loading.grossKg != null && !terminal,
        override: overrideOk,
        suspend: editor && !terminal && shipment.status !== 'SUSPENDED',
        resume: editor && shipment.status === 'SUSPENDED',
        cancel: matrix.canDelete && !terminal,
        manualStatus: overrideOk && !terminal,
        receipt: editor && !!loading.readyGrantedAt && shipment.status !== 'CANCELLED',
        decideAdjustment: actor.manager,
      };
    }

    return {
      shipment: { ...shipment, contact: shipment.contact, loading },
      events,
      documents: documents.map((d) => {
        const a = attById.get(d.attachmentId);
        return { ...d, title: a?.title ?? null, attachmentCreatedAt: a?.createdAt ?? null, fileUrl: a?.fileUrl ?? null };
      }),
      docTypes,
      requiredDocTypes: loading?.requiredDocTypes ?? [],
      missingDocTypes: facts?.missing ?? [],
      docsComplete: facts ? facts.docsComplete : true,
      receipt: receipt
        ? {
            status: receipt.status,
            sentAt: receipt.sentAt,
            signedAt: receipt.signedAt,
            signerName: receipt.signerName,
            paperByName: receipt.paperByName,
            hasPdf: !!receipt.pdfAttachmentId,
            archived: !!receipt.archivedDocumentId,
            link: can.receipt || actor.manager ? this.receipts.linkFor(ctx.tenantSlug, receipt.publicToken) : null,
          }
        : null,
      adjustment,
      task: task ? { id: task.id, number: task.number, title: task.title, status: task.status, assignees: assigneeUsers } : null,
      settings: { receiptRequiredBefore: settings.receipt.requiredBefore },
      handlerOnly,
      can,
      statusLabels: STATUS_LABELS_FA,
    };
  }

  // ── ایجاد / اعلام بار ───────────────────────────────────────────────
  /** مقادیر پیش‌فرض فرم «اعلام بار» از منبع (فاکتور/تولید/حواله). */
  async prefill(ctx: TenantRequestContext, typeRaw: string, id: string) {
    const type = this.suggestions.assertType(typeRaw);
    const live = await this.suggestions.liveShipmentsFor(ctx, type, id);
    const decision = decideSourceAction(live);
    let base: {
      contactId: string | null;
      cargoType: string;
      quantity: number;
      unit: string;
      invoice?: { id: string; invoiceNo: number; status: string; lines: Array<{ id: string; description: string; quantity: number }> };
      productionOrderId?: string;
      reference?: string;
    };

    if (type === 'SALES_INVOICE') {
      await this.permissions.assertView(ctx, 'sales');
      const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
      const inv = await ctx.tenantDb.salesInvoice.findFirst({ where: { id, ...scope }, include: { lines: { include: { product: { select: { unit: true } } } } } });
      if (!inv) throw new NotFoundException('فاکتور یافت نشد');
      const first = inv.lines[0];
      base = {
        contactId: inv.contactId,
        cargoType: first ? first.description + (inv.lines.length > 1 ? ` و ${inv.lines.length - 1} قلم دیگر` : '') : 'کالا',
        quantity: Math.max(1, inv.lines.reduce((s, l) => s + l.quantity, 0)),
        unit: first?.product?.unit ?? 'عدد',
        invoice: { id: inv.id, invoiceNo: inv.invoiceNo, status: inv.status, lines: inv.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity })) },
        reference: `فاکتور ${inv.invoiceNo}`,
      };
    } else if (type === 'PRODUCTION_ORDER') {
      await this.permissions.assertView(ctx, 'production');
      const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id }, include: { bom: { include: { outputProduct: { select: { name: true, unit: true } } } } } });
      if (!order) throw new NotFoundException('دستور تولید یافت نشد');
      let contactId: string | null = null;
      if (order.relatedInvoiceId) contactId = (await ctx.tenantDb.salesInvoice.findUnique({ where: { id: order.relatedInvoiceId }, select: { contactId: true } }))?.contactId ?? null;
      base = {
        contactId,
        cargoType: order.bom.outputProduct.name,
        quantity: Math.max(1, order.quantityProduced ?? order.quantityPlanned),
        unit: order.bom.outputProduct.unit,
        productionOrderId: order.id,
        reference: `دستور تولید ${order.orderNo}`,
      };
    } else {
      await this.permissions.assertView(ctx, 'warehouse');
      const mv = await ctx.tenantDb.stockMovement.findUnique({ where: { id }, include: { product: { select: { name: true, unit: true } } } });
      if (!mv) throw new NotFoundException('حواله یافت نشد');
      base = { contactId: null, cargoType: mv.product.name, quantity: Math.max(1, Math.abs(mv.quantityDelta)), unit: mv.product.unit, reference: mv.reference ?? undefined };
    }

    const contact = base.contactId
      ? await ctx.tenantDb.crmContact.findUnique({ where: { id: base.contactId }, select: { id: true, name: true, company: true, type: true, nationalId: true, legalId: true, uniqueId: true, postalCode: true, postalAddress: true, address: true } })
      : null;
    const profile = contact
      ? {
          uniqueId: contact.uniqueId,
          nationalId: contact.type === 'COMPANY' ? (contact.legalId ?? contact.nationalId) : contact.nationalId,
          postalCode: contact.postalCode,
          postalAddress: contact.postalAddress ?? contact.address,
        }
      : { uniqueId: null, nationalId: null, postalCode: null, postalAddress: null };
    const pickupAt = new Date(Date.now() + 2 * 3600 * 1000);
    return {
      sourceType: type,
      sourceId: id,
      contactId: contact?.id ?? null,
      contactName: contact ? (contact.company ? `${contact.company} (${contact.name})` : contact.name) : null,
      cargoType: base.cargoType,
      quantity: base.quantity,
      unit: base.unit,
      deliveryAddress: profile.postalAddress ?? '',
      region: '',
      pickupAt: pickupAt.toISOString(),
      expectedWeightKg: base.unit === 'کیلوگرم' || base.unit.toLowerCase() === 'kg' ? base.quantity : null,
      profile,
      missingProfile: (['uniqueId', 'nationalId', 'postalCode', 'postalAddress'] as const).filter((k) => !profile[k]),
      invoice: base.invoice ?? null,
      reference: base.reference ?? null,
      existing: decision.action === 'EXISTS' ? decision.shipment : null,
    };
  }

  private snapshotOf(contact: { name: string; company: string | null; type: string; nationalId: string | null; legalId: string | null; uniqueId: string | null; postalCode: string | null; postalAddress: string | null; address: string | null } | null, over: DeclareShipmentDto['profile']) {
    const nat = contact ? (contact.type === 'COMPANY' ? (contact.legalId ?? contact.nationalId) : contact.nationalId) : null;
    const pick = (o: string | undefined, fallback: string | null) => (o?.trim() ? o.trim() : fallback);
    return {
      customerName: contact ? (contact.company ? `${contact.company} (${contact.name})` : contact.name) : null,
      uniqueId: pick(over?.uniqueId, contact?.uniqueId ?? null),
      nationalId: pick(over?.nationalId, nat),
      postalCode: pick(over?.postalCode, contact?.postalCode ?? null),
      postalAddress: pick(over?.postalAddress, contact?.postalAddress ?? contact?.address ?? null),
    };
  }

  async declare(ctx: TenantRequestContext, dto: DeclareShipmentDto) {
    await this.permissions.assertCreate(ctx, 'dispatch');
    const actor = await resolveActor(ctx);
    const sourceType = dto.sourceType ?? 'MANUAL';
    if (sourceType !== 'MANUAL' && !dto.sourceId) throw new BadRequestException('شناسه‌ی منبع الزامی است');

    // ضدتکرار
    let claimed = false;
    if (sourceType !== 'MANUAL') {
      const live = await this.suggestions.liveShipmentsFor(ctx, sourceType, dto.sourceId!);
      const d = decideSourceAction(live);
      if (d.action === 'EXISTS') return { shipment: await this.detailLite(ctx, d.shipment.id), alreadyExisted: true };
      claimed = await this.suggestions.claim(ctx, sourceType, dto.sourceId!);
      if (!claimed) {
        const again = decideSourceAction(await this.suggestions.liveShipmentsFor(ctx, sourceType, dto.sourceId!));
        if (again.action === 'EXISTS') return { shipment: await this.detailLite(ctx, again.shipment.id), alreadyExisted: true };
      }
    }

    try {
      let contactId = dto.contactId ?? null;
      let needsWeighing = dto.needsWeighing ?? false;
      let productionOrderId: string | null = null;
      let sourceInvoiceId: string | undefined;
      let sourceStockMovementId: string | undefined;

      if (sourceType === 'SALES_INVOICE') {
        const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
        const inv = await ctx.tenantDb.salesInvoice.findFirst({ where: { id: dto.sourceId!, ...scope }, select: { id: true, contactId: true, status: true } });
        if (!inv) throw new NotFoundException('فاکتور یافت نشد');
        if (inv.status === 'CANCELLED') throw new BadRequestException('فاکتور باطل‌شده قابل اعلام بار نیست');
        if (needsWeighing && inv.status !== 'DRAFT') throw new BadRequestException('«نیاز به وزن‌کشی» فقط برای فاکتور پیش‌نویس ممکن است');
        contactId = contactId ?? inv.contactId;
        sourceInvoiceId = inv.id;
      } else if (sourceType === 'PRODUCTION_ORDER') {
        const order = await ctx.tenantDb.productionOrder.findUnique({ where: { id: dto.sourceId! }, select: { id: true, relatedInvoiceId: true } });
        if (!order) throw new NotFoundException('دستور تولید یافت نشد');
        productionOrderId = order.id;
        if (!contactId && order.relatedInvoiceId) contactId = (await ctx.tenantDb.salesInvoice.findUnique({ where: { id: order.relatedInvoiceId }, select: { contactId: true } }))?.contactId ?? null;
      } else if (sourceType === 'STOCK_MOVEMENT') {
        const mv = await ctx.tenantDb.stockMovement.findUnique({ where: { id: dto.sourceId! }, select: { id: true } });
        if (!mv) throw new NotFoundException('حواله یافت نشد');
        sourceStockMovementId = mv.id;
      }

      const contact = contactId
        ? await ctx.tenantDb.crmContact.findUnique({ where: { id: contactId }, select: { id: true, name: true, company: true, type: true, nationalId: true, legalId: true, uniqueId: true, postalCode: true, postalAddress: true, address: true } })
        : null;
      if (contactId && !contact) throw new BadRequestException('مشتری یافت نشد');
      const snap = this.snapshotOf(contact, dto.profile);

      let driverId: string | null = null;
      if (dto.driverId) {
        const d = await ctx.tenantDb.driver.findUnique({ where: { id: dto.driverId } });
        if (!d || !d.isActive) throw new BadRequestException('راننده یافت نشد یا غیرفعال است');
        driverId = d.id;
      }

      const created = await ctx.tenantDb.shipment.create({
        data: {
          sourceType,
          sourceInvoiceId,
          sourceStockMovementId,
          contactId: contact?.id,
          cargoType: dto.cargoType.trim(),
          quantity: dto.quantity,
          unit: dto.unit?.trim() || undefined,
          deliveryAddress: dto.deliveryAddress.trim(),
          region: dto.region?.trim() || undefined,
          pickupAt: new Date(dto.pickupAt),
          status: driverId ? 'ACCEPTED' : 'AWAITING_DRIVER',
          driverId,
          acceptedAt: driverId ? new Date() : undefined,
          createdByUserId: actor.userId,
          loading: {
            create: {
              needsWeighing,
              productionOrderId,
              expectedWeightKg: dto.expectedWeightKg ?? undefined,
              weighLineIds: dto.weighLineIds ?? [],
              kgPerUnit: dto.kgPerUnit && dto.kgPerUnit > 0 ? dto.kgPerUnit : 1,
              ...snap,
            },
          },
          events: {
            create: {
              type: 'created',
              toStatus: driverId ? 'ACCEPTED' : 'AWAITING_DRIVER',
              actorUserId: actor.userId,
              actorName: actor.name,
              note: sourceType === 'MANUAL' ? 'اعلام بار دستی' : `اعلام بار از ${sourceType === 'SALES_INVOICE' ? 'فاکتور فروش' : sourceType === 'PRODUCTION_ORDER' ? 'دستور تولید' : 'حواله خروج'}`,
              meta: { needsWeighing, sourceType, sourceId: dto.sourceId ?? null },
            },
          },
        },
        include: FULL_INCLUDE,
      });
      if (claimed) await this.suggestions.attach(ctx, sourceType as SuggestionSourceType, dto.sourceId!, created.id);

      // «ذخیره در پروفایل مشتری» — فقط با دسترسی ویرایش CRM
      if (dto.saveToProfile && contact && dto.profile) await this.saveProfile(ctx, contact, dto.profile);

      if (driverId) {
        await this.notifyUsers(ctx, [actor.userId], { type: 'dispatch.driver_assigned', title: `راننده برای بار #${created.shipmentNo} تعیین شد`, body: created.driver?.name, shipmentId: created.id });
      }
      return { shipment: created, alreadyExisted: false };
    } catch (e) {
      if (claimed) await this.suggestions.release(ctx, sourceType as SuggestionSourceType, dto.sourceId!).catch(() => undefined);
      throw e;
    }
  }

  private async detailLite(ctx: TenantRequestContext, id: string) {
    return ctx.tenantDb.shipment.findUniqueOrThrow({ where: { id }, include: FULL_INCLUDE });
  }

  private async saveProfile(ctx: TenantRequestContext, contact: { id: string; type: string }, p: NonNullable<DeclareShipmentDto['profile']>) {
    const m = await this.permissions.getEffective(ctx, 'crm');
    if (!m.canEdit) return;
    await ctx.tenantDb.crmContact.update({
      where: { id: contact.id },
      data: {
        uniqueId: p.uniqueId?.trim() || undefined,
        ...(contact.type === 'COMPANY' ? { legalId: p.nationalId?.trim() || undefined } : { nationalId: p.nationalId?.trim() || undefined }),
        postalCode: p.postalCode?.trim() || undefined,
        postalAddress: p.postalAddress?.trim() || undefined,
      },
    });
  }

  /** شروع گردش اعلام بار برای باری که قبلاً در ناوگان ساخته شده. */
  async enroll(ctx: TenantRequestContext, id: string) {
    await this.permissions.assertCreate(ctx, 'dispatch');
    const actor = await resolveActor(ctx);
    const loaded = await this.load(ctx, actor, id);
    const s = loaded.shipment;
    if (s.loading) throw new ConflictException('گردش اعلام بار برای این بار قبلاً شروع شده است');
    if (s.status === 'DELIVERED' || s.status === 'CANCELLED') throw new BadRequestException('بار بسته‌شده را نمی‌توان وارد گردش کرد');
    const snap = this.snapshotOf(s.contact, undefined);
    await ctx.tenantDb.shipmentLoading.create({ data: { shipmentId: id, ...snap } });
    await logEvent(ctx.tenantDb, id, { type: 'enrolled', actor, note: 'گردش اعلام بار برای این بار شروع شد' });
    if (s.status === 'DRAFT') await this.moveStatus(ctx, s, 'AWAITING_DRIVER', actor, { type: 'status_auto', note: 'شروع گردش اعلام بار' });
    return this.detail(ctx, id);
  }

  async assignDriver(ctx: TenantRequestContext, id: string, driverId: string) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    if (!shipment.loading) throw new BadRequestException('گردش اعلام بار برای این بار فعال نشده است');
    if (['DELIVERED', 'CANCELLED', 'SUSPENDED', 'IN_TRANSIT', 'READY_TO_DEPART'].includes(shipment.status)) throw new BadRequestException('در این وضعیت امکان تغییر راننده نیست');
    const d = await ctx.tenantDb.driver.findUnique({ where: { id: driverId } });
    if (!d || !d.isActive) throw new BadRequestException('راننده یافت نشد یا غیرفعال است');
    await ctx.tenantDb.shipmentOffer.updateMany({ where: { shipmentId: id, status: { in: ['PENDING', 'SCHEDULED'] } }, data: { status: 'EXPIRED' } });
    await ctx.tenantDb.shipment.update({ where: { id }, data: { driverId, acceptedAt: new Date() } });
    await logEvent(ctx.tenantDb, id, { type: 'driver_assigned', actor, note: `راننده: ${d.name}${d.plateNumber ? ` — پلاک ${d.plateNumber}` : ''}`, meta: { driverId, previousDriverId: shipment.driverId } });
    await this.advance(ctx, shipment, 'ASSIGN_DRIVER', actor, 'تعیین راننده');
    await this.notifyUsers(ctx, [shipment.createdByUserId, actor.userId], { type: 'dispatch.driver_assigned', title: `راننده برای بار #${shipment.shipmentNo} تعیین شد`, body: d.name, shipmentId: id });
    return this.detail(ctx, id);
  }

  // ── مراحل چک‌لیست ───────────────────────────────────────────────────
  async arrival(ctx: TenantRequestContext, id: string) {
    const g = await this.guardStep(ctx, id, 'ARRIVAL', 'arrival');
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { arrivedAt: new Date(), arrivedByUserId: g.actor.userId, arrivedByName: g.actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'arrived', actor: g.actor, note: 'ماشین رسید' });
    await this.advance(ctx, g.shipment, 'ARRIVAL', g.actor, 'رسیدن ماشین');
    await this.requestApproval(ctx, g.shipment, 'CLEANLINESS', g.actor);
    return this.detail(ctx, id);
  }

  /** تأییدکننده = کاربر واردشده؛ نام و زمان خودکار ثبت می‌شود (نه ورودی دستی). */
  async cleanliness(ctx: TenantRequestContext, id: string, dto: CleanlinessDto) {
    const g = await this.guardStep(ctx, id, 'CLEANLINESS', 'cleanliness');
    if (dto.result === 'FAIL' && !dto.note?.trim()) throw new BadRequestException('برای نظافت مردود، توضیح الزامی است');
    await ctx.tenantDb.shipmentLoading.update({
      where: { shipmentId: id },
      data: { cleanlinessResult: dto.result, cleanlinessNote: dto.note?.trim() || null, cleanlinessAt: new Date(), cleanlinessByUserId: g.actor.userId, cleanlinessByName: g.actor.name },
    });
    await logEvent(ctx.tenantDb, id, { type: 'cleanliness', actor: g.actor, note: dto.note?.trim() || undefined, meta: { result: dto.result } });
    if (dto.result === 'PASS') {
      await this.advance(ctx, g.shipment, 'CLEANLINESS', g.actor, 'تأیید نظافت');
      await this.closeApproval(ctx, id, 'CLEANLINESS');
    } else {
      await this.notifyUsers(ctx, [g.shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.cleanliness_failed', title: `نظافت ماشین بار #${g.shipment.shipmentNo} مردود شد`, body: dto.note, shipmentId: id }, g.actor.userId);
    }
    return this.detail(ctx, id);
  }

  async tare(ctx: TenantRequestContext, id: string, dto: TareDto) {
    const g = await this.guardStep(ctx, id, 'TARE', 'weighing');
    const kg = wrapRule(() => assertWeightValue(dto.kg, 'وزن خالی'));
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { tareKg: kg, tareAt: new Date(), tareByUserId: g.actor.userId, tareByName: g.actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'tare', actor: g.actor, meta: { kg } });
    await this.advance(ctx, g.shipment, 'TARE', g.actor, 'ثبت وزن خالی');
    return this.detail(ctx, id);
  }

  async loadingDone(ctx: TenantRequestContext, id: string) {
    const g = await this.guardStep(ctx, id, 'LOADING', 'loading');
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { loadedAt: new Date(), loaderUserId: g.actor.userId, loaderName: g.actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'loaded', actor: g.actor, note: 'بارگیری انجام شد' });
    await this.advance(ctx, g.shipment, 'LOADING', g.actor, 'بارگیری');
    return this.detail(ctx, id);
  }

  async gross(ctx: TenantRequestContext, id: string, dto: GrossDto) {
    const g = await this.guardStep(ctx, id, 'GROSS', 'weighing');
    const net = wrapRule(() => computeNetKg(g.loading.tareKg!, dto.kg));
    const gross = roundKg(dto.kg);
    await ctx.tenantDb.shipmentLoading.update({
      where: { shipmentId: id },
      data: { grossKg: gross, grossAt: new Date(), grossByUserId: g.actor.userId, grossByName: g.actor.name, netKg: net, netEdited: false, netEditReason: null },
    });
    await logEvent(ctx.tenantDb, id, { type: 'gross', actor: g.actor, meta: { grossKg: gross, tareKg: g.loading.tareKg, netKg: net } });
    await this.advance(ctx, g.shipment, 'GROSS', g.actor, 'ثبت وزن پر و محاسبه‌ی وزن خالص');

    const applied = await this.rules.applyToShipment(ctx, id, g.actor);
    if (applied.required.length > 0) {
      await logEvent(ctx.tenantDb, id, { type: 'docs_rules', actor: null, note: `قانون اسناد فعال شد: ${applied.required.join('، ')}${applied.created ? ' — وظیفه ساخته شد' : ''}`, meta: { required: applied.required, taskId: applied.taskId } });
    }
    await this.refreshDocsState(ctx, id, g.actor);
    await this.requestApproval(ctx, g.shipment, 'FINAL_CHECK', g.actor);
    if (g.loading.needsWeighing) await this.requestApproval(ctx, g.shipment, 'WEIGHT', g.actor);
    return this.detail(ctx, id);
  }

  /** ویرایش دستی وزن خالص — فقط با دسترسی مدیر و دلیل؛ تأیید وزن باید دوباره انجام شود. */
  async editNet(ctx: TenantRequestContext, id: string, dto: NetEditDto) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    await assertCanOverride(this.permissions, ctx);
    const l = shipment.loading;
    if (!l || l.grossKg == null) throw new BadRequestException('وزن خالصی برای ویرایش ثبت نشده است');
    if (shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED') throw new BadRequestException('بار بسته‌شده قابل ویرایش نیست');
    const { netKg, reason } = wrapRule(() => validateNetEdit(dto.netKg, dto.reason));
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { netKg, netEdited: true, netEditReason: reason, weightConfirmedAt: null, weightConfirmedByUserId: null, weightConfirmedByName: null } });
    await logEvent(ctx.tenantDb, id, { type: 'net_edited', actor, reason, meta: { oldNetKg: l.netKg, newNetKg: netKg } });
    await this.rules.applyToShipment(ctx, id, actor);
    await this.refreshDocsState(ctx, id, actor);
    if (l.needsWeighing) await this.requestApproval(ctx, shipment, 'WEIGHT', actor);
    return this.detail(ctx, id);
  }

  async finalCheck(ctx: TenantRequestContext, id: string, dto: FinalCheckDto) {
    const g = await this.guardStep(ctx, id, 'FINAL_CHECK', 'finalCheck');
    if (dto.result === 'PASS' && !(dto.loadingCorrect && dto.tarpInstalled)) throw new BadRequestException('برای تأیید، صحت بارگیری و نصب چادر باید تأیید شود');
    if (dto.result === 'FAIL' && !dto.note?.trim()) throw new BadRequestException('برای کنترل نهایی مردود، توضیح الزامی است');
    await ctx.tenantDb.shipmentLoading.update({
      where: { shipmentId: id },
      data: {
        finalCheckResult: dto.result,
        finalCheckNote: dto.note?.trim() || null,
        loadingCorrect: dto.loadingCorrect ?? null,
        tarpInstalled: dto.tarpInstalled ?? null,
        finalCheckAt: new Date(),
        finalCheckByUserId: g.actor.userId,
        finalCheckByName: g.actor.name,
      },
    });
    await logEvent(ctx.tenantDb, id, { type: 'final_check', actor: g.actor, note: dto.note?.trim() || undefined, meta: { result: dto.result, loadingCorrect: dto.loadingCorrect, tarpInstalled: dto.tarpInstalled } });
    if (dto.result === 'PASS') {
      await this.closeApproval(ctx, id, 'FINAL_CHECK');
      await this.requestApproval(ctx, g.shipment, 'READY', g.actor);
      const handlerIds = g.loading.docsTaskId ? (await ctx.tenantDb.taskAssignee.findMany({ where: { taskId: g.loading.docsTaskId }, select: { userId: true } })).map((a) => a.userId) : [];
      await this.notifyUsers(ctx, [...handlerIds, g.shipment.createdByUserId], { type: 'dispatch.final_check_passed', title: `کنترل نهایی بار #${g.shipment.shipmentNo} تأیید شد`, body: 'در انتظار مجوز «آماده حرکت»', shipmentId: id }, g.actor.userId);
    } else {
      await this.notifyUsers(ctx, [g.shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.final_check_failed', title: `کنترل نهایی بار #${g.shipment.shipmentNo} مردود شد`, body: dto.note, shipmentId: id }, g.actor.userId);
    }
    return this.detail(ctx, id);
  }

  async confirmWeight(ctx: TenantRequestContext, id: string, dto: { note?: string }) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    const l = shipment.loading;
    if (!l || !l.needsWeighing) throw new BadRequestException('برای این بار «نیاز به وزن‌کشی» اعلام نشده است');
    if (l.grossKg == null || l.netKg == null) throw new BadRequestException('ابتدا وزن پر باید ثبت شود');
    if (l.weightConfirmedAt) throw new ConflictException('وزن نهایی قبلاً تأیید شده است');
    const settings = await this.rules.getSettings(ctx.tenantDb);
    if (!canPerformStep(settings.steps.weightConfirm, actor)) throw new ForbiddenException('تأیید وزن نهایی برای نقش شما مجاز نیست');
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { weightConfirmedAt: new Date(), weightConfirmedByUserId: actor.userId, weightConfirmedByName: actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'weight_confirmed', actor, note: dto.note?.trim() || undefined, meta: { netKg: l.netKg } });
    await this.closeApproval(ctx, id, 'WEIGHT');
    if (shipment.sourceInvoiceId) await this.adjustments.propose(ctx, id, actor);
    return this.detail(ctx, id);
  }

  async proposeAdjustment(ctx: TenantRequestContext, id: string) {
    const { actor } = await this.loadForEdit(ctx, id);
    if (!actor.manager) {
      const m = await this.permissions.getEffective(ctx, 'sales');
      if (!m.canEdit) throw new ForbiddenException('فقط مدیر یا حسابدار می‌تواند تعدیل فاکتور را دوباره پیشنهاد دهد');
    }
    await this.adjustments.propose(ctx, id, actor);
    return this.detail(ctx, id);
  }

  async decideAdjustment(ctx: TenantRequestContext, id: string, approve: boolean, note?: string) {
    const actor = await resolveActor(ctx);
    await this.load(ctx, actor, id);
    const adj = await this.adjustments.latestFor(ctx, id);
    if (!adj || adj.status !== 'PROPOSED') throw new BadRequestException('پیشنهاد تعدیلِ در انتظاری وجود ندارد');
    await this.adjustments.decide(ctx, adj.id, approve, note);
    return this.detail(ctx, id);
  }

  async retryFinalizeInvoice(ctx: TenantRequestContext, id: string) {
    const actor = await resolveActor(ctx);
    await this.load(ctx, actor, id);
    await this.adjustments.retryFinalize(ctx, id);
    return this.detail(ctx, id);
  }

  // ── اسناد ───────────────────────────────────────────────────────────
  /** وضعیت «در انتظار اسناد» ↔ «کنترل نهایی» را با کامل‌بودن اسناد هماهنگ می‌کند. */
  async refreshDocsState(ctx: TenantRequestContext, id: string, actor: Actor | null) {
    const s = await ctx.tenantDb.shipment.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!s?.loading) return;
    const settings = await this.rules.getSettings(ctx.tenantDb);
    const facts = await this.buildFacts(ctx, s, settings);
    const target = statusForDocs(s.status, s.loading.grossKg != null, facts.docsRequired, facts.docsComplete, facts.docsOverridden);
    if (!target) return;
    await this.moveStatus(ctx, s, target, actor, { type: 'status_auto', note: target === 'FINAL_CHECK' ? 'اسناد الزامی کامل شد' : 'در انتظار تکمیل اسناد الزامی' });
    if (target === 'FINAL_CHECK' && facts.docsRequired) {
      const handlerIds = s.loading.docsTaskId ? (await ctx.tenantDb.taskAssignee.findMany({ where: { taskId: s.loading.docsTaskId }, select: { userId: true } })).map((a) => a.userId) : [];
      await this.notifyUsers(ctx, [s.createdByUserId, ...handlerIds], { type: 'dispatch.docs_complete', title: `اسناد بار #${s.shipmentNo} کامل شد`, shipmentId: id }, actor?.userId);
    }
  }

  private async docAccess(ctx: TenantRequestContext, id: string) {
    const actor = await resolveActor(ctx);
    const loaded = await this.load(ctx, actor, id);
    if (!loaded.handlerOnly) {
      const m = await this.permissions.getEffective(ctx, 'dispatch');
      if (!m.canEdit && !m.canCreate) throw new ForbiddenException('اجازه‌ی ویرایش در این بخش را ندارید');
    }
    if (loaded.shipment.status === 'CANCELLED') throw new BadRequestException('بار لغو شده است');
    return { actor, shipment: loaded.shipment };
  }

  async addDocument(ctx: TenantRequestContext, id: string, dto: { docTypeCode: string; title: string; fileUrl: string; step?: 'TARE' | 'GROSS' }) {
    const { actor } = await this.docAccess(ctx, id);
    const type = await ctx.tenantDb.dispatchDocType.findUnique({ where: { code: dto.docTypeCode } });
    if (!type || !type.isActive) throw new BadRequestException('نوع سند نامعتبر است');
    const title = dto.title.trim() || type.name;
    const att = await ctx.tenantDb.attachment.create({ data: { entityType: 'Shipment', entityId: id, title, fileUrl: dto.fileUrl, createdByUserId: actor.userId } });
    await ctx.tenantDb.shipmentDocument.create({ data: { shipmentId: id, docTypeCode: type.code, step: dto.step ?? null, attachmentId: att.id, createdByUserId: actor.userId, createdByName: actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'doc_added', actor, note: `${type.name}: ${title}`, meta: { docTypeCode: type.code, step: dto.step ?? null } });
    await this.refreshDocsState(ctx, id, actor);
    return this.detail(ctx, id);
  }

  async removeDocument(ctx: TenantRequestContext, id: string, docId: string) {
    const { actor } = await this.docAccess(ctx, id);
    const doc = await ctx.tenantDb.shipmentDocument.findFirst({ where: { id: docId, shipmentId: id } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    await ctx.tenantDb.attachment.deleteMany({ where: { id: doc.attachmentId } });
    await ctx.tenantDb.shipmentDocument.delete({ where: { id: docId } });
    await logEvent(ctx.tenantDb, id, { type: 'doc_removed', actor, note: doc.docTypeCode });
    await this.refreshDocsState(ctx, id, actor);
    return this.detail(ctx, id);
  }

  async overrideDocs(ctx: TenantRequestContext, id: string, reason: string) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    await assertCanOverride(this.permissions, ctx);
    const r = wrapRule(() => assertReason(reason, 'عبور از دروازه‌ی اسناد'));
    if (!shipment.loading || shipment.loading.requiredDocTypes.length === 0) throw new BadRequestException('برای این بار سند الزامی تعریف نشده است');
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { docsOverrideReason: r, docsOverrideByName: actor.name, docsOverrideAt: new Date() } });
    await logEvent(ctx.tenantDb, id, { type: 'docs_override', actor, reason: r });
    await this.refreshDocsState(ctx, id, actor);
    return this.detail(ctx, id);
  }

  // ── آماده حرکت / حرکت / تحویل ────────────────────────────────────────
  /** صدور «آماده حرکت» — فقط مسئول وظیفه‌ی اسناد، مجازهای تنظیمات یا مدیر؛ و فقط از همین مسیر (پنل اعلام بار). */
  async grantReady(ctx: TenantRequestContext, id: string, dto: { note?: string }) {
    const actor = await resolveActor(ctx);
    const { shipment, handlerOnly } = await this.load(ctx, actor, id);
    if (!shipment.loading) throw new BadRequestException('گردش اعلام بار برای این بار فعال نشده است');
    const settings = await this.rules.getSettings(ctx.tenantDb);
    const handler = handlerOnly || (await this.isDocsHandler(ctx, id, actor.userId));
    if (!(actor.manager || isExplicitlyAllowed(settings.steps.readyToDepart, actor) || handler)) {
      throw new ForbiddenException('صدور «آماده حرکت» فقط برای مسئول اسناد این بار یا مجازهای تعیین‌شده در تنظیمات امکان‌پذیر است');
    }
    const facts = await this.buildFacts(ctx, shipment, settings);
    wrapRule(() => assertStepAllowed('READY', facts, actor.userId));
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { readyGrantedAt: new Date(), readyGrantedByUserId: actor.userId, readyGrantedByName: actor.name } });
    await logEvent(ctx.tenantDb, id, { type: 'ready_granted', actor, note: dto.note?.trim() || undefined });
    await this.advance(ctx, shipment, 'READY', actor, 'صدور مجوز آماده حرکت');
    await this.closeApproval(ctx, id, 'READY');
    if (settings.receipt.requiredBefore !== 'NONE') await this.receipts.sendLink(ctx, id, actor).catch(() => undefined);
    await this.notifyUsers(ctx, [shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.ready', title: `بار #${shipment.shipmentNo} آماده حرکت است`, body: shipment.driver?.name ?? undefined, shipmentId: id }, actor.userId);
    return this.detail(ctx, id);
  }

  async sendReceiptLink(ctx: TenantRequestContext, id: string) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    if (!shipment.loading?.readyGrantedAt) throw new BadRequestException('رسید پس از صدور «آماده حرکت» قابل ارسال است');
    if (!shipment.driver) throw new BadRequestException('راننده تعیین نشده است');
    const r = await this.receipts.sendLink(ctx, id, actor);
    return { ...r, detail: await this.detail(ctx, id) };
  }

  async attachPaperReceipt(ctx: TenantRequestContext, id: string, dto: { title: string; fileUrl: string }) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    if (!shipment.loading?.readyGrantedAt) throw new BadRequestException('رسید پس از صدور «آماده حرکت» قابل ثبت است');
    await this.receipts.attachPaper(ctx, id, actor, dto);
    return this.detail(ctx, id);
  }

  async regenerateReceiptPdf(ctx: TenantRequestContext, id: string) {
    await this.loadForEdit(ctx, id);
    const r = await ctx.tenantDb.dispatchReceipt.findUnique({ where: { shipmentId: id } });
    if (!r || r.status === 'PENDING') throw new BadRequestException('رسیدی ثبت نشده است');
    await this.receipts.generateAndArchive(ctx, id, r.status === 'SIGNED' ? 'SIGNED' : 'PAPER');
    return this.detail(ctx, id);
  }

  async depart(ctx: TenantRequestContext, id: string, dto: { overrideReason?: string }) {
    const { actor, shipment, settings } = await (async () => {
      const { actor, shipment } = await this.loadForEdit(ctx, id);
      return { actor, shipment, settings: await this.rules.getSettings(ctx.tenantDb) };
    })();
    if (!shipment.loading) throw new BadRequestException('گردش اعلام بار برای این بار فعال نشده است');
    if (!canPerformStep(settings.steps.loading, actor)) throw new ForbiddenException('این مرحله برای نقش شما مجاز نیست');
    const facts = await this.buildFacts(ctx, shipment, settings);
    let overrideReason: string | undefined;
    if (facts.receiptRequiredBeforeDeparture && !facts.receiptDone && !facts.receiptOverridden && dto.overrideReason) {
      await assertCanOverride(this.permissions, ctx);
      overrideReason = wrapRule(() => assertReason(dto.overrideReason, 'حرکت بدون رسید راننده'));
      facts.receiptOverridden = true;
    }
    wrapRule(() => assertStepAllowed('DEPART', facts, actor.userId));
    await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { departedAt: new Date(), departedByName: actor.name, ...(overrideReason ? { receiptOverrideReason: overrideReason } : {}) } });
    await logEvent(ctx.tenantDb, id, { type: 'departed', actor, reason: overrideReason, note: 'ماشین از محل خارج شد' });
    await this.advance(ctx, shipment, 'DEPART', actor, 'حرکت');
    return this.detail(ctx, id);
  }

  async deliver(ctx: TenantRequestContext, id: string, dto: { overrideReason?: string }, publicWebUrl: string) {
    const g = await this.guardStep(ctx, id, 'DELIVER', 'loading');
    const settings = g.settings;
    let overrideReason: string | undefined;
    if (settings.receipt.requiredBefore === 'DELIVERY' && !g.facts.receiptDone) {
      if (!dto.overrideReason) throw new BadRequestException('رسید راننده هنوز ثبت نشده است');
      await assertCanOverride(this.permissions, ctx);
      overrideReason = wrapRule(() => assertReason(dto.overrideReason, 'تحویل بدون رسید راننده'));
    }
    await ctx.tenantDb.shipment.update({ where: { id }, data: { deliveredAt: new Date() } });
    await this.moveStatus(ctx, g.shipment, 'DELIVERED', g.actor, { type: 'delivered', note: 'بار تحویل شد', reason: overrideReason });

    // نظرسنجی تحویل برای مشتری — همان رفتار fleet.deliver
    try {
      const contact = g.shipment.contact ? await ctx.tenantDb.crmContact.findUnique({ where: { id: g.shipment.contact.id }, select: { phone: true } }) : null;
      const survey = (await ctx.tenantDb.deliverySurvey.findUnique({ where: { shipmentId: id } })) ?? (await ctx.tenantDb.deliverySurvey.create({ data: { shipmentId: id } }));
      const fleetSms = await this.fleet.getSmsSettings(ctx);
      if (fleetSms.enabled && contact?.phone && publicWebUrl) {
        const url = `${publicWebUrl}/survey/${publicRef(ctx.tenantSlug)}/${survey.publicToken}`;
        const message = renderFleetTemplate(fleetSms.deliveredSurveyTemplate, { shipmentNo: String(g.shipment.shipmentNo), link: url });
        const res = await this.sms.sendSms(ctx, contact.phone, message);
        if (res.success) await ctx.tenantDb.deliverySurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
      }
    } catch {
      // نظرسنجی هرگز تحویل را خراب نمی‌کند
    }
    await this.notifyUsers(ctx, [g.shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.delivered', title: `بار #${g.shipment.shipmentNo} تحویل شد`, body: g.shipment.contact?.name, shipmentId: id }, g.actor.userId);
    return this.detail(ctx, id);
  }

  // ── تغییر دستی وضعیت / توقف / لغو ────────────────────────────────────
  async manualStatus(ctx: TenantRequestContext, id: string, dto: ManualStatusDto) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    const to = dto.status;
    const reason = wrapRule(() => validateManualChange(shipment.status, to, dto.reason));
    if (to === 'CANCELLED') {
      await this.permissions.assertDelete(ctx, 'dispatch');
      return this.cancelInternal(ctx, shipment, actor, reason);
    }
    if (to === 'SUSPENDED') {
      if (shipment.loading) await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { suspendedFrom: shipment.status } });
      await this.moveStatus(ctx, shipment, 'SUSPENDED', actor, { type: 'suspended', reason });
      await this.notifyUsers(ctx, [shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.suspended', title: `بار #${shipment.shipmentNo} متوقف شد`, body: reason, shipmentId: id }, actor.userId);
      return this.detail(ctx, id);
    }
    await assertCanOverride(this.permissions, ctx);
    await this.moveStatus(ctx, shipment, to, actor, { type: 'manual_status', reason });
    return this.detail(ctx, id);
  }

  async resume(ctx: TenantRequestContext, id: string, reason: string) {
    const { actor, shipment } = await this.loadForEdit(ctx, id);
    if (shipment.status !== 'SUSPENDED') throw new BadRequestException('این بار متوقف نیست');
    const r = wrapRule(() => assertReason(reason, 'ازسرگیری بار'));
    const back = shipment.loading?.suspendedFrom ?? 'ACCEPTED';
    await this.moveStatus(ctx, shipment, back, actor, { type: 'resumed', reason: r });
    if (shipment.loading) await ctx.tenantDb.shipmentLoading.update({ where: { shipmentId: id }, data: { suspendedFrom: null } });
    return this.detail(ctx, id);
  }

  private async cancelInternal(ctx: TenantRequestContext, shipment: ShipmentFull, actor: Actor, reason: string) {
    if (shipment.status === 'DELIVERED') throw new BadRequestException('بار تحویل‌شده قابل لغو نیست');
    await ctx.tenantDb.shipmentOffer.updateMany({ where: { shipmentId: shipment.id, status: { in: ['PENDING', 'SCHEDULED'] } }, data: { status: 'EXPIRED' } });
    await this.moveStatus(ctx, shipment, 'CANCELLED', actor, { type: 'cancelled', reason });
    // منبع آزاد می‌شود تا دوباره قابل اعلام باشد؛ فاکتور هم از قفل وزن‌کشی خارج می‌شود (دروازه به لغو توجه دارد)
    const type: SuggestionSourceType | null = shipment.sourceType === 'SALES_INVOICE' ? 'SALES_INVOICE' : shipment.sourceType === 'STOCK_MOVEMENT' ? 'STOCK_MOVEMENT' : shipment.sourceType === 'PRODUCTION_ORDER' ? 'PRODUCTION_ORDER' : null;
    const sourceId = shipment.sourceInvoiceId ?? shipment.sourceStockMovementId ?? shipment.loading?.productionOrderId ?? null;
    if (type && sourceId) await this.suggestions.release(ctx, type, sourceId).catch(() => undefined);
    for (const kind of ['CLEANLINESS', 'FINAL_CHECK', 'READY', 'WEIGHT']) await this.closeApproval(ctx, shipment.id, kind, 'REJECTED');
    await this.notifyUsers(ctx, [shipment.createdByUserId, ...(await this.managerIds(ctx))], { type: 'dispatch.cancelled', title: `بار #${shipment.shipmentNo} لغو شد`, body: reason, shipmentId: shipment.id }, actor.userId);
    return this.detail(ctx, shipment.id);
  }
}
