import type { TenantRequestContext } from '../common/request-context.js';
import { contractScope, projectScope, proposalScope } from '../permissions/entity-scopes.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { reportStrictScope } from '../reports/report-scope.js';
import { scopeWithGrants } from './referral-grants.js';

/**
 * فهرست موجودیت‌هایی که قابل ارجاع‌اند. entityType همان نام پیوست‌ها (Attachment.entityType) است.
 * افزودن نوع جدید = یک ورودی اینجا + (برای گرفتن دسترسی مشاهده) استفاده از scopeWithGrants در کنترلر همان ماژول.
 */
export type ReferralEntityDef = {
  type: string;
  /** کد ماژول ماتریس دسترسی (برای «ویرایش» = حق ارجاع) */
  module: string;
  /** نام delegate پریزما */
  model: string;
  /** برچسب فارسی نوع سند */
  noun: string;
  /** ستون‌های مالک/مسئول سند (برای «صاحب سند می‌تواند ارجاع دهد») */
  ownerFields: string[];
  /** ستون‌های لازم برای برچسب */
  labelFields: string[];
  label: (row: Record<string, unknown>) => string;
  link: (id: string) => string;
  /** وضعیت‌هایی که ویرایش/پیوست با دسترسی ارجاع در آن‌ها مجاز است (سند صادرشده/قفل/تأییدشده خارج از آن). */
  editableWhen?: { field: string; allow?: string[]; deny?: string[] };
  /** دامنه‌ی دید عادی (بدون ارجاع/وظیفه) */
  strictScope: (permissions: PermissionsService, ctx: TenantRequestContext) => Promise<Record<string, unknown>>;
};

/**
 * لینک یکتای باز کردن سند: صفحه‌ی «نمایش سند» (/referrals/view) که برای همه کار می‌کند — حتی برای گیرنده‌ای که
 * ماژول مبدأ را در منو ندارد (صفحه‌ی ماژول در پنل برای او مسدود است).
 */
export const viewLink = (type: string, id: string) => `/referrals/view?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

const owned = (module: string, ownerField: string) => (permissions: PermissionsService, ctx: TenantRequestContext) =>
  permissions.viewScope(ctx, module, ownerField);

export const REFERRAL_ENTITY_DEFS: Record<string, ReferralEntityDef> = {
  SalesInvoice: {
    editableWhen: { field: 'status', allow: ['DRAFT'] }, type: 'SalesInvoice', module: 'sales', model: 'salesInvoice', noun: 'فاکتور', ownerFields: ['createdByUserId'],
    labelFields: ['invoiceNo'], label: (r) => `فاکتور ${r.invoiceNo}`, link: (id) => viewLink('SalesInvoice', id), strictScope: owned('sales', 'createdByUserId'),
  },
  SalesQuotation: {
    editableWhen: { field: 'status', allow: ['DRAFT'] }, type: 'SalesQuotation', module: 'sales', model: 'salesQuotation', noun: 'پیش‌فاکتور', ownerFields: ['createdByUserId'],
    labelFields: ['quotationNo'], label: (r) => `پیش‌فاکتور ${r.quotationNo}`, link: (id) => viewLink('SalesQuotation', id), strictScope: owned('sales', 'createdByUserId'),
  },
  PurchaseOrder: {
    editableWhen: { field: 'status', allow: ['DRAFT'] }, type: 'PurchaseOrder', module: 'purchasing', model: 'purchaseOrder', noun: 'سفارش خرید', ownerFields: ['createdByUserId'],
    labelFields: ['orderNo'], label: (r) => `سفارش خرید ${r.orderNo}`, link: (id) => viewLink('PurchaseOrder', id), strictScope: owned('purchasing', 'createdByUserId'),
  },
  CrmContact: {
    type: 'CrmContact', module: 'crm', model: 'crmContact', noun: 'مشتری', ownerFields: ['ownerUserId'],
    labelFields: ['name'], label: (r) => `مشتری ${r.name}`, link: (id) => viewLink('CrmContact', id), strictScope: owned('crm', 'ownerUserId'),
  },
  CrmDeal: {
    editableWhen: { field: 'stage', deny: ['WON', 'LOST'] }, type: 'CrmDeal', module: 'crm', model: 'crmDeal', noun: 'فرصت فروش', ownerFields: ['ownerUserId'],
    labelFields: ['title'], label: (r) => `فرصت «${r.title}»`, link: (id) => viewLink('CrmDeal', id), strictScope: owned('crm', 'ownerUserId'),
  },
  Proposal: {
    editableWhen: { field: 'status', allow: ['DRAFT', 'REVISION_REQUESTED'] }, type: 'Proposal', module: 'proposals', model: 'proposal', noun: 'پیشنهاد', ownerFields: ['createdByUserId', 'assignedUserId'],
    labelFields: ['proposalNo', 'title'], label: (r) => `پیشنهاد ${r.proposalNo} «${r.title}»`, link: (id) => viewLink('Proposal', id), strictScope: (p, c) => proposalScope(p, c),
  },
  Contract: {
    editableWhen: { field: 'status', allow: ['DRAFT'] }, type: 'Contract', module: 'contracts', model: 'contract', noun: 'قرارداد', ownerFields: ['createdByUserId'],
    labelFields: ['contractNo', 'title'], label: (r) => `قرارداد ${r.contractNo} «${r.title}»`, link: (id) => viewLink('Contract', id), strictScope: (p, c) => contractScope(p, c),
  },
  Project: {
    editableWhen: { field: 'status', deny: ['COMPLETED', 'CANCELLED'] }, type: 'Project', module: 'projects', model: 'project', noun: 'پروژه', ownerFields: ['createdByUserId', 'managerUserId'],
    labelFields: ['projectNo', 'name'], label: (r) => `پروژه ${r.projectNo} «${r.name}»`, link: (id) => viewLink('Project', id), strictScope: (p, c) => projectScope(p, c),
  },
  Report: {
    type: 'Report', module: 'reports', model: 'report', noun: 'گزارش', ownerFields: ['createdByUserId'],
    labelFields: ['reportNo', 'title', 'isKnowledge'],
    label: (r) => `${r.isKnowledge ? 'گزارش دانش سازمانی' : 'گزارش'} ${r.reportNo} «${r.title}»`,
    link: (id) => viewLink('Report', id), strictScope: (p, c) => reportStrictScope(p, c),
  },
};

export function entityDef(type: string): ReferralEntityDef | undefined {
  return Object.prototype.hasOwnProperty.call(REFERRAL_ENTITY_DEFS, type) ? REFERRAL_ENTITY_DEFS[type] : undefined;
}

/** دامنه‌ی خواندن = دید عادی + دسترسی صریح ارجاع/وظیفه. */
export function entityReadScope(permissions: PermissionsService, ctx: TenantRequestContext, def: ReferralEntityDef): Promise<Record<string, unknown>> {
  return scopeWithGrants(ctx, def.type, () => def.strictScope(permissions, ctx));
}

/** مدل پریزما برای تایپ‌دهی ضعیف delegate های پویا. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function entityDelegate(ctx: TenantRequestContext, def: ReferralEntityDef): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ctx.tenantDb as any)[def.model];
}

export function selectFor(def: ReferralEntityDef): Record<string, true> {
  const sel: Record<string, true> = { id: true };
  for (const f of [...def.labelFields, ...def.ownerFields]) sel[f] = true;
  return sel;
}

/**
 * ویرایش/پیوستِ مبتنی بر ارجاع فقط روی سندی که در وضعیت قفل/صادرشده/تأییدشده نیست.
 * (مسیرهای محتوا همین قواعد را در سرویس خود دارند؛ این برای پیوست‌ها و هر مسیر بدون قاعده‌ی وضعیت است.)
 */
export async function isEditableByGrant(ctx: TenantRequestContext, type: string, entityId: string): Promise<boolean> {
  const def = entityDef(type);
  if (!def) return false;
  const cond = def.editableWhen;
  const row = await entityDelegate(ctx, def).findFirst({ where: { id: entityId }, select: cond ? { id: true, [cond.field]: true } : { id: true } });
  if (!row) return false;
  if (!cond) return true;
  const v = String((row as Record<string, unknown>)[cond.field]);
  if (cond.allow && !cond.allow.includes(v)) return false;
  if (cond.deny && cond.deny.includes(v)) return false;
  return true;
}
