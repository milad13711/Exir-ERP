/**
 * رجیستری «مالکیت رکورد» برای خروج کاربر / انتقال رکوردها.
 *
 * هر فیلدی در schema تننت که به User اشاره می‌کند باید دقیقاً در یکی از این دسته‌ها باشد
 * (تست ownership-registry.spec.ts با خواندن schema.prisma این را اجبار می‌کند؛ مدل جدید فراموش نمی‌شود):
 *
 *  A) TRANSFERABLE — مالکیت/مسئولیت/ارجاع: هنگام خروج به کاربر دیگری منتقل می‌شود.
 *  B) HISTORICAL   — سابقه‌ی نویسندگی (createdBy، تأییدکننده، امضاکننده…): هرگز بازنویسی نمی‌شود تا تاریخچه راست بماند.
 *  C) PERSONAL     — داده‌ی شخصی/دسترسی (اعلان، پوش، نقش، دسترسی دستی…): با سیاست پاک‌سازی صریح حذف/جدا می‌شود.
 *  ACKNOWLEDGED_HISTORICAL — جدول‌های لاگ/رویداد/مدرک append-only که عمداً دست‌نخورده می‌مانند.
 *
 * افزودن ماژول جدید = افزودن یک ورودی به همین فایل. این فایل عمداً هیچ import ای از prisma/ یا src/ ندارد
 * (ایمیج اجرایی فقط dist/ و prisma/ دارد).
 */

export type OwnershipKind = 'single' | 'assignee-join' | 'array';

export type TransferEntry = {
  /** `Model.field` — یکتا در کل رجیستری */
  key: string;
  moduleCode: string;
  /** برچسب فارسی برای UI و گزارش */
  label: string;
  /** نام مدل Prisma (delegate = حرف اول کوچک) */
  model: string;
  field: string;
  /**
   * single: ستون اسکالر مالک (updateMany)؛
   * assignee-join: جدول اتصال کاربر↔رکورد با unique(parentField, field) — اگر هدف همان انتساب را دارد ردیف خروجی ادغام (حذف) می‌شود؛
   * array: ستون آرایه‌ای از شناسه‌ها (table/column الزامی) — جایگزینی عنصر با SQL خام.
   */
  kind: OwnershipKind;
  parentField?: string;
  table?: string;
  column?: string;
  /** کلید یکتا برای ثبت شناسه‌ها؛ پیش‌فرض id */
  idField?: string;
  /** شرط محدودکننده (فقط رکوردهای «باز/جاری»)؛ رکوردهای بسته‌شده تاریخچه‌اند و جابه‌جا نمی‌شوند. */
  scope?: (now: Date) => Record<string, unknown>;
  /** توضیح فارسی دامنه برای UI */
  scopeNote: string;
  /**
   * مسئولیت مدیریتی: اگر هدف مدیر (OWNER/ADMIN) نباشد، به‌جای واگذاری به غیرمدیر «بی‌صاحب» می‌شود
   * (ApprovalRequest → خالی = هر مدیر؛ ModuleApprover → حذف).
   */
  managerOnly?: { fallback: 'null' | 'delete' };
  /** هوک پس از انتقال موفق (نام در engine ثبت می‌شود؛ بدون import تا ایمیج اجرایی نشکند) */
  afterMove?: 'corr-referral-participant';
};

export type CleanupRule = {
  action: 'delete' | 'nullify';
  /** always: در غیرفعال‌سازی و حذف؛ delete-mode: فقط در حذف کامل (ناشناس‌سازی) */
  when: 'always' | 'delete-mode';
  where?: Record<string, unknown>;
};

export type PersonalEntry = {
  key: string;
  moduleCode: string;
  label: string;
  model: string;
  field: string;
  cleanup: CleanupRule[];
  note: string;
};

/** B: مدل.فیلد ها به‌تفکیک ماژول */
export type HistoricalGroups = Record<string, string[]>;

export const OPEN_TASK_STATUSES = ['OPEN', 'NEW', 'SEEN', 'IN_PROGRESS', 'DONE', 'HAS_PROBLEM', 'RETURNED_FOR_FIX'];
const OPEN_PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD'];

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ── A) انتقال‌پذیر ───────────────────────────────────────────────────────────

export const TRANSFERABLE: TransferEntry[] = [
  {
    key: 'Task.assignedUserId', moduleCode: 'tasks', label: 'وظایف (مسئول اصلی)', model: 'Task', field: 'assignedUserId', kind: 'single',
    scope: () => ({ status: { in: OPEN_TASK_STATUSES } }),
    scopeNote: 'فقط وظایف باز؛ وظایف تأییدشده/لغوشده/منقضی تاریخچه‌اند. سازنده‌ی وظیفه تغییر نمی‌کند.',
  },
  {
    key: 'TaskAssignee.userId', moduleCode: 'tasks', label: 'وظایف (مسئولان چندنفره)', model: 'TaskAssignee', field: 'userId', kind: 'assignee-join', parentField: 'taskId',
    scope: () => ({ task: { status: { in: OPEN_TASK_STATUSES } } }),
    scopeNote: 'فقط ردیف مسئولیت وظایف باز؛ اگر مقصد قبلاً مسئول همان وظیفه باشد ردیف خروجی ادغام می‌شود. رویدادهای وظیفه (TaskEvent) دست‌نخورده می‌مانند.',
  },
  {
    key: 'DailyChecklistItem.userId', moduleCode: 'daily-checklist', label: 'چک‌لیست روزانه', model: 'DailyChecklistItem', field: 'userId', kind: 'single',
    scope: (now) => ({ doneAt: null, date: { gte: startOfDay(now) } }),
    scopeNote: 'فقط آیتم‌های انجام‌نشده‌ی امروز و آینده.',
  },
  {
    key: 'CrmContact.ownerUserId', moduleCode: 'crm', label: 'مخاطبین و مشتریان (مسئول پرونده)', model: 'CrmContact', field: 'ownerUserId', kind: 'single',
    scopeNote: 'همه‌ی مخاطبین؛ فاکتورها و سوابق مخاطب تغییر نمی‌کند.',
  },
  {
    key: 'CrmDeal.ownerUserId', moduleCode: 'crm', label: 'فرصت‌های فروش (مسئول)', model: 'CrmDeal', field: 'ownerUserId', kind: 'single',
    scope: () => ({ stage: { notIn: ['WON', 'LOST'] } }),
    scopeNote: 'فقط فرصت‌های باز؛ فرصت‌های برده/باخته برای عملکرد فروش به نام او می‌مانند.',
  },
  {
    key: 'Project.managerUserId', moduleCode: 'projects', label: 'پروژه‌ها (مدیر پروژه)', model: 'Project', field: 'managerUserId', kind: 'single',
    scope: () => ({ status: { in: OPEN_PROJECT_STATUSES } }),
    scopeNote: 'فقط پروژه‌های در دست اقدام (برنامه‌ریزی/فعال/متوقف).',
  },
  {
    key: 'ProjectMember.userId', moduleCode: 'projects', label: 'پروژه‌ها (عضویت در تیم)', model: 'ProjectMember', field: 'userId', kind: 'assignee-join', parentField: 'projectId',
    scope: () => ({ project: { status: { in: OPEN_PROJECT_STATUSES } } }),
    scopeNote: 'عضویت در پروژه‌های جاری؛ در صورت عضویت قبلی مقصد، ادغام می‌شود.',
  },
  {
    key: 'ProjectStage.responsibleUserId', moduleCode: 'projects', label: 'مراحل پروژه (مسئول اجرا)', model: 'ProjectStage', field: 'responsibleUserId', kind: 'single',
    scope: () => ({ status: { in: ['PENDING', 'AWAITING_APPROVAL', 'IN_PROGRESS'] } }),
    scopeNote: 'فقط مراحل انجام‌نشده.',
  },
  {
    key: 'Contract.referredSignerUserId', moduleCode: 'contracts', label: 'قراردادها (امضاکننده‌ی ارجاعی)', model: 'Contract', field: 'referredSignerUserId', kind: 'single',
    scope: () => ({ status: { in: ['DRAFT', 'ACTIVE'] } }),
    scopeNote: 'فقط قراردادهای پیش‌نویس/فعال؛ شواهد امضای انجام‌شده (SignatureEvidence) تغییر نمی‌کند.',
  },
  {
    key: 'Proposal.assignedUserId', moduleCode: 'proposals', label: 'پیشنهادها (مسئول پیگیری)', model: 'Proposal', field: 'assignedUserId', kind: 'single',
    scope: () => ({ status: { in: ['DRAFT', 'SENT', 'VIEWED', 'REVISION_REQUESTED'] } }),
    scopeNote: 'فقط پیشنهادهای در جریان.',
  },
  {
    key: 'Appointment.providerUserId', moduleCode: 'booking', label: 'نوبت‌ها (ارائه‌دهنده‌ی خدمت)', model: 'Appointment', field: 'providerUserId', kind: 'single',
    scope: (now) => ({ status: { in: ['PENDING_COORDINATION', 'SCHEDULED', 'CONFIRMED'] }, startAt: { gte: now } }),
    scopeNote: 'فقط نوبت‌های آینده‌ی فعال؛ نوبت‌های انجام‌شده به نام او می‌مانند.',
  },
  {
    key: 'MentoringEngagement.advisorUserId', moduleCode: 'mentoring', label: 'منتورینگ (مشاور)', model: 'MentoringEngagement', field: 'advisorUserId', kind: 'single',
    scope: () => ({ status: { in: ['ACTIVE', 'PAUSED'] } }),
    scopeNote: 'فقط قراردادهای مشاوره‌ی فعال/متوقف؛ جلسات گذشته و گزارش‌ها تغییر نمی‌کند.',
  },
  {
    key: 'ProductionOrderStage.assignedUserId', moduleCode: 'production', label: 'تولید (مسئول مرحله)', model: 'ProductionOrderStage', field: 'assignedUserId', kind: 'single',
    scope: () => ({ status: { in: ['PENDING', 'IN_PROGRESS'] } }),
    scopeNote: 'فقط مراحل تمام‌نشده‌ی دستور تولید.',
  },
  {
    key: 'JobApplicant.specialistUserId', moduleCode: 'recruitment', label: 'استخدام (کارشناس بررسی‌کننده)', model: 'JobApplicant', field: 'specialistUserId', kind: 'single',
    scope: () => ({ stage: { in: ['NEW', 'INTERVIEW_SCHEDULED', 'INTERVIEWED'] } }),
    scopeNote: 'فقط متقاضیانی که هنوز در مرحله‌ی نظر کارشناس‌اند.',
  },
  {
    key: 'JobApplicant.managementUserId', moduleCode: 'recruitment', label: 'استخدام (تصمیم‌گیر مدیریتی)', model: 'JobApplicant', field: 'managementUserId', kind: 'single',
    scope: () => ({ stage: { in: ['SPECIALIST_APPROVED', 'OFFER_SENT', 'AWAITING_MANAGEMENT'] } }),
    scopeNote: 'فقط متقاضیانی که منتظر تصمیم مدیریت‌اند.',
  },
  {
    key: 'JobInterview.interviewerUserId', moduleCode: 'recruitment', label: 'استخدام (مصاحبه‌کننده)', model: 'JobInterview', field: 'interviewerUserId', kind: 'single',
    scope: () => ({ status: 'SCHEDULED' }),
    scopeNote: 'فقط مصاحبه‌های برنامه‌ریزی‌شده‌ی انجام‌نشده.',
  },
  {
    key: 'ReportReferral.toUserId', moduleCode: 'reports', label: 'گزارش‌ها (ارجاع‌شده به او)', model: 'ReportReferral', field: 'toUserId', kind: 'single',
    scope: () => ({ paraphed: false }),
    scopeNote: 'فقط ارجاع‌های پاراف‌نشده؛ ارجاع‌های پاراف‌شده سابقه‌اند.',
  },
  {
    key: 'ApprovalRequest.assigneeUserId', moduleCode: 'approvals', label: 'کارتابل تأیید (درخواست‌های در انتظار)', model: 'ApprovalRequest', field: 'assigneeUserId', kind: 'single',
    scope: () => ({ status: 'PENDING' }),
    scopeNote: 'فقط درخواست‌های در انتظار تأیید؛ اگر مقصد مدیر نباشد، درخواست به «هر مدیر» برمی‌گردد.',
    managerOnly: { fallback: 'null' },
  },
  {
    key: 'ModuleApprover.userId', moduleCode: 'approvals', label: 'تأییدکننده‌ی نهایی ماژول‌ها', model: 'ModuleApprover', field: 'userId', kind: 'single', idField: 'moduleCode',
    scopeNote: 'ماژول‌هایی که او تأییدکننده‌شان است؛ اگر مقصد مدیر نباشد، تأییدکننده‌ی اختصاصی حذف می‌شود (اسناد به مدیران می‌رود).',
    managerOnly: { fallback: 'delete' },
  },
  {
    key: 'CorrLetter.ownerUserId', moduleCode: 'correspondence', label: 'مکاتبات (مسئول فعلی نامه)', model: 'CorrLetter', field: 'ownerUserId', kind: 'single',
    scope: () => ({ status: { notIn: ['VOID', 'CLOSED', 'DELIVERED', 'REJECTED', 'DRAFT'] }, confidentiality: { not: 'SECRET' }, archivedAt: null }),
    scopeNote: 'فقط نامه‌های جاری (نه بسته/باطل/بایگانی). مسئول نامه به نامه دید می‌دهد؛ پس نامه‌های «سری» و پیش‌نویس‌ها خودکار منتقل نمی‌شوند و در هشدار «نیازمند مالک» می‌آیند (انتقال دستی فقط با مالک).',
  },
  {
    key: 'CorrLetter.signerUserId', moduleCode: 'correspondence', label: 'مکاتبات (امضاکننده‌ی نامه‌های منتظر امضا)', model: 'CorrLetter', field: 'signerUserId', kind: 'single',
    scope: () => ({ status: { in: ['PENDING_REVIEW', 'PENDING_SIGNATURE'] }, confidentiality: { not: 'SECRET' } }),
    scopeNote: 'فقط نامه‌های در انتظار امضا/بازبینی.',
  },
  {
    key: 'CorrReferral.toUserId', moduleCode: 'correspondence', label: 'مکاتبات (ارجاع‌های باز در کارتابل)', model: 'CorrReferral', field: 'toUserId', kind: 'single',
    scope: () => ({ status: { in: ['PENDING', 'SEEN'] }, letter: { confidentiality: { not: 'SECRET' } } }),
    scopeNote: 'فقط ارجاع‌های بازِ نامه‌های غیرسری؛ ارجاع‌های بسته سابقه‌اند. برای مقصد یک مشارکت‌کننده‌ی نامه ساخته می‌شود تا ارجاع را ببیند.',
    afterMove: 'corr-referral-participant',
  },
  {
    key: 'DispatchDocRule.handlerUserId', moduleCode: 'dispatch', label: 'حمل‌ونقل (مسئول قانون مدارک)', model: 'DispatchDocRule', field: 'handlerUserId', kind: 'single',
    scopeNote: 'قوانین مدارک ارسال که او مسئول رسیدگی است.',
  },
];

// ── C) شخصی / دسترسی ─────────────────────────────────────────────────────────

export const PERSONAL: PersonalEntry[] = [
  { key: 'UserRole.userId', moduleCode: 'users', label: 'نقش‌های کاربر', model: 'UserRole', field: 'userId', cleanup: [{ action: 'delete', when: 'delete-mode' }], note: 'در غیرفعال‌سازی حفظ می‌شود (بازگشت‌پذیر)، در حذف کامل پاک می‌شود.' },
  { key: 'UserModulePermission.userId', moduleCode: 'users', label: 'دسترسی دستی ماژول‌ها', model: 'UserModulePermission', field: 'userId', cleanup: [{ action: 'delete', when: 'delete-mode' }], note: 'در غیرفعال‌سازی حفظ می‌شود، در حذف کامل پاک می‌شود.' },
  { key: 'Notification.userId', moduleCode: 'users', label: 'اعلان‌های درون‌برنامه', model: 'Notification', field: 'userId', cleanup: [{ action: 'delete', when: 'delete-mode' }], note: 'فقط در حذف کامل پاک می‌شود.' },
  { key: 'NotificationPreference.userId', moduleCode: 'users', label: 'ترجیح‌های اعلان', model: 'NotificationPreference', field: 'userId', cleanup: [{ action: 'delete', when: 'delete-mode' }], note: 'فقط در حذف کامل پاک می‌شود.' },
  { key: 'PushSubscription.userId', moduleCode: 'users', label: 'اشتراک‌های پوش (دستگاه‌ها)', model: 'PushSubscription', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود تا اعلان‌ها دیگر به دستگاه‌های او نرسد.' },
  { key: 'VoipExtension.userId', moduleCode: 'voip', label: 'داخلی تلفن / SIP', model: 'VoipExtension', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود (حاوی اعتبارنامه‌ی SIP).' },
  { key: 'StaffAvailabilitySlot.userId', moduleCode: 'booking', label: 'ساعات کاری نوبت‌دهی', model: 'StaffAvailabilitySlot', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود تا برای نوبت جدید قابل رزرو نباشد.' },
  { key: 'StaffTimeBlock.userId', moduleCode: 'booking', label: 'بازه‌های مسدود نوبت‌دهی', model: 'StaffTimeBlock', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود.' },
  { key: 'StaffBookingPreference.userId', moduleCode: 'booking', label: 'ترجیح‌های نوبت‌دهی', model: 'StaffBookingPreference', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود.' },
  { key: 'ConfidentialArchiveAccess.userId', moduleCode: 'confidential-archive', label: 'دسترسی بایگانی محرمانه', model: 'ConfidentialArchiveAccess', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'هرگز منتقل نمی‌شود (حداقل دسترسی)؛ همیشه لغو می‌شود.' },
  { key: 'DashboardReminder.createdByUserId', moduleCode: 'dashboard', label: 'یادآوری‌های شخصی داشبورد', model: 'DashboardReminder', field: 'createdByUserId', cleanup: [{ action: 'delete', when: 'always', where: { status: 'PENDING' } }], note: 'یادآوری‌های در انتظار پاک می‌شود؛ انجام‌شده‌ها سابقه می‌مانند.' },
  { key: 'DashboardLayout.ownerKey', moduleCode: 'dashboard', label: 'چیدمان شخصی داشبورد', model: 'DashboardLayout', field: 'ownerKey', cleanup: [{ action: 'delete', when: 'delete-mode', where: { scope: 'USER' } }], note: 'فقط در حذف کامل پاک می‌شود (ownerKey برابر شناسه‌ی کاربر).' },
  { key: 'MessengerMember.userId', moduleCode: 'messenger', label: 'عضویت در گروه‌های پیام‌رسان', model: 'MessengerMember', field: 'userId', cleanup: [{ action: 'delete', when: 'always', where: { conversation: { type: 'GROUP' } } }, { action: 'delete', when: 'delete-mode' }], note: 'از گروه‌ها خارج می‌شود (پیام‌های گذشته‌اش می‌ماند)؛ گفتگوهای مستقیم تا حذف کامل حفظ می‌شود.' },
  { key: 'MessengerPresence.userId', moduleCode: 'messenger', label: 'وضعیت حضور پیام‌رسان', model: 'MessengerPresence', field: 'userId', cleanup: [{ action: 'delete', when: 'always' }], note: 'همیشه پاک می‌شود.' },
  { key: 'MessengerMessageHide.userId', moduleCode: 'messenger', label: 'پیام‌های پنهان‌شده‌ی شخصی', model: 'MessengerMessageHide', field: 'userId', cleanup: [{ action: 'delete', when: 'delete-mode' }], note: 'فقط در حذف کامل پاک می‌شود.' },
  { key: 'Employee.userId', moduleCode: 'hr', label: 'پیوند پرونده‌ی پرسنلی به حساب ورود', model: 'Employee', field: 'userId', cleanup: [{ action: 'nullify', when: 'always' }], note: 'پرونده‌ی پرسنلی حفظ می‌شود؛ فقط پیوند حساب ورود جدا می‌شود.' },
  { key: 'ResellerProfile.userId', moduleCode: 'referral-marketing', label: 'حساب ورود نماینده', model: 'ResellerProfile', field: 'userId', cleanup: [{ action: 'nullify', when: 'delete-mode' }], note: 'فقط در حذف کامل جدا می‌شود؛ پروفایل نماینده و تسویه‌ها حفظ می‌شود.' },
];

// ── B) سابقه‌ی نویسندگی (هرگز بازنویسی نمی‌شود) ──────────────────────────────

export const HISTORICAL: HistoricalGroups = {
  tasks: ['Task.createdByUserId', 'Task.approvedByUserId', 'TaskComment.authorUserId', 'TaskResult.authorUserId', 'TaskResult.reviewedByUserId', 'TaskExtensionRequest.requestedByUserId', 'TaskExtensionRequest.decidedByUserId'],
  'daily-checklist': ['DailyChecklistItem.createdByUserId'],
  sales: ['SalesInvoice.createdByUserId', 'SalesInvoice.signedByUserId', 'InvoiceFollowUp.followedUpByUserId', 'SalesQuotation.createdByUserId', 'SalesReturn.createdByUserId', 'RecurringInvoiceTemplate.createdByUserId'],
  purchasing: ['PurchaseOrder.createdByUserId', 'PurchaseOrder.approvedByUserId', 'PurchaseReturn.createdByUserId'],
  accounting: ['JournalEntry.createdByUserId', 'BankStatementLine.createdByUserId', 'Budget.createdByUserId', 'FixedAsset.createdByUserId', 'PartyTransaction.createdByUserId'],
  checks: ['Check.createdByUserId'],
  warehouse: ['StockMovement.createdByUserId', 'StockMovement.voidedByUserId', 'StockImportBatch.createdByUserId', 'StockImportBatch.voidedByUserId'],
  attachments: ['Attachment.createdByUserId', 'AttachmentConversion.convertedByUserId'],
  hr: ['LeaveRequest.reviewedByUserId', 'PersonnelReward.createdByUserId', 'PersonnelPenalty.createdByUserId'],
  production: ['BillOfMaterial.createdByUserId', 'ProductionOrder.createdByUserId', 'ProductionOrder.rawMaterialApprovedByUserId'],
  'quality-control': ['QualitySample.sampledByUserId', 'QualitySampleResult.testedByUserId'],
  'ration-lab': ['RationSample.collectedByUserId'],
  automation: ['AutomationRule.createdByUserId'],
  booking: ['Appointment.createdByUserId', 'StaffTimeBlock.createdByUserId'],
  contracts: ['Contract.createdByUserId', 'ContractAmendment.createdByUserId', 'ContractTemplate.createdByUserId'],
  projects: ['Project.createdByUserId', 'ProjectStage.requestedByUserId', 'ProjectStage.approvedByUserId', 'ProjectNote.authorUserId'],
  correspondence: [
    'CorrLetter.createdByUserId', 'CorrLetter.registeredByUserId', 'CorrLetter.signedByUserId', 'CorrLetter.voidedByUserId', 'CorrDelivery.createdByUserId',
    'CorrParaph.authorUserId', 'CorrReferral.fromUserId', 'CorrRevision.actorUserId', 'CorrLetterReview.reviewerUserId',
  ],
  dispatch: [
    'Shipment.createdByUserId', 'ShipmentDocument.createdByUserId', 'DispatchReceipt.paperByUserId', 'DispatchInvoiceAdjustment.proposedByUserId', 'DispatchInvoiceAdjustment.decidedByUserId',
    'ShipmentLoading.arrivedByUserId', 'ShipmentLoading.cleanlinessByUserId', 'ShipmentLoading.finalCheckByUserId', 'ShipmentLoading.grossByUserId', 'ShipmentLoading.loaderUserId',
    'ShipmentLoading.readyGrantedByUserId', 'ShipmentLoading.tareByUserId', 'ShipmentLoading.weightConfirmedByUserId',
  ],
  mentoring: ['MentoringEngagement.createdByUserId', 'MentoringSession.createdByUserId'],
  marketing: ['MarketingCampaign.createdByUserId'],
  events: ['Event.createdByUserId', 'EventTicket.checkedInByUserId'],
  forms: ['Form.createdByUserId'],
  warranty: ['WarrantyCode.createdByUserId'],
  'qr-code': ['QrCode.createdByUserId'],
  recruitment: ['JobPosting.createdByUserId', 'JobOffer.signedByUserId'],
  certificates: ['Certificate.issuedByUserId'],
  reports: ['Report.createdByUserId', 'ReportReferral.fromUserId'],
  approvals: ['ApprovalRequest.requestedByUserId', 'ApprovalRequest.decidedByUserId'],
  'confidential-archive': ['ConfidentialDocument.createdByUserId', 'ConfidentialDocument.updatedByUserId', 'ConfidentialArchiveAccess.grantedByUserId'],
  dashboard: ['DashboardLayout.updatedByUserId'],
  proposals: ['Proposal.createdByUserId', 'ProposalTemplate.createdByUserId'],
  tax: ['TaxInvoice.requestedByUserId', 'TaxInvoice.approvedByUserId', 'TaxInvoice.createdByUserId', 'TaxProductCode.createdByUserId', 'TaxSettings.updatedByUserId'],
};

/**
 * جدول‌های لاگ/رویداد/مدرک/پیام که ذاتاً append-only‌اند و باید دست‌نخورده بمانند (حتی در حذف کامل کاربر،
 * به‌جای حذف ردیف کاربر، او ناشناس‌سازی می‌شود). دلیل هر مورد برای بازبینی آینده نوشته شده.
 */
export const ACKNOWLEDGED_HISTORICAL: Record<string, string> = {
  'CorrEvent.actorUserId': 'خط‌زمان نامه — تغییرناپذیر',
  'CorrParticipant.userId': 'مشارکت‌کنندگان نامه (مبنای دید و سابقه) — برای حفظ سابقه و کنترل دسترسی دست‌نخورده می‌ماند',
  'ActivityLog.userId': 'لاگ فعالیت — تغییرناپذیر',
  'TaskEvent.actorUserId': 'تاریخچه‌ی رویداد وظیفه',
  'ShipmentEvent.actorUserId': 'تاریخچه‌ی رویداد محموله',
  'ProposalEvent.userId': 'تاریخچه‌ی رویداد پیشنهاد',
  'SignatureEvidence.signerUserId': 'مدرک امضا — ارزش حقوقی؛ هرگز بازنویسی نمی‌شود',
  'TaxSubmissionLog.userId': 'لاگ ارسال مالیاتی',
  'DocumentRevision.userId': 'تاریخچه‌ی نسخه‌های سند',
  'ProjectSmsLog.userId': 'لاگ پیامک پروژه',
  'CallLog.userId': 'سابقه‌ی تماس تلفنی',
  'CrmActivity.userId': 'سابقه‌ی فعالیت‌های CRM (چه کسی تماس گرفت/جلسه گذاشت)',
  'AiActionRequest.decidedByUserId': 'سابقه‌ی تصمیم روی پیشنهاد دستیار هوشمند',
  'FormSubmission.viewedByUserId': 'سابقه‌ی مشاهده‌ی پاسخ فرم',
  'DailyChecklistDayClose.userId': 'سابقه‌ی بستن روز چک‌لیست',
  'MessengerMessage.senderId': 'پیام‌های گذشته‌ی پیام‌رسان',
  'MessengerMessage.forwardedFromUserId': 'اسنپ‌شات فوروارد',
  'MessengerMessage.mentionIds': 'منشن‌های پیام‌های گذشته',
  'MessengerReaction.userId': 'واکنش‌های گذشته',
  'MessengerPin.pinnedById': 'سنجاق‌های گذشته',
  'MessengerMedia.uploaderId': 'رسانه‌ی ارسال‌شده',
  'MessengerConversation.createdById': 'سازنده‌ی گفتگو',
  'UserOffboardingRun.fromUserId': 'گزارش خروج کاربر (خودِ سابقه)',
  'UserOffboardingRun.toUserId': 'گزارش خروج کاربر (خودِ سابقه)',
  'UserOffboardingRun.performedByUserId': 'گزارش خروج کاربر (خودِ سابقه)',
};

// ── ابزارها ──────────────────────────────────────────────────────────────────

export const HISTORICAL_KEYS: string[] = Object.values(HISTORICAL).flat();

/** همه‌ی کلیدهای ثبت‌شده (برای شمارش ارجاع‌های باقی‌مانده پیش از حذف کامل). */
export function allRegisteredKeys(): string[] {
  return [...TRANSFERABLE.map((e) => e.key), ...PERSONAL.map((e) => e.key), ...HISTORICAL_KEYS, ...Object.keys(ACKNOWLEDGED_HISTORICAL)];
}

export function splitKey(key: string): { model: string; field: string } {
  const i = key.indexOf('.');
  return { model: key.slice(0, i), field: key.slice(i + 1) };
}

/** Prisma delegate name for a model. */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** نام فارسی ماژول‌ها برای UI/گزارش. */
export const MODULE_LABELS: Record<string, string> = {
  tasks: 'وظایف',
  'daily-checklist': 'چک‌لیست روزانه',
  crm: 'مدیریت ارتباط با مشتری',
  projects: 'پروژه‌ها',
  contracts: 'قراردادها',
  proposals: 'پیشنهادها',
  booking: 'نوبت‌دهی',
  mentoring: 'منتورینگ و مشاوره',
  production: 'تولید',
  recruitment: 'استخدام',
  reports: 'گزارش‌ها',
  approvals: 'کارتابل تأیید',
  dispatch: 'حمل‌ونقل و ارسال',
  correspondence: 'مکاتبات سازمانی',
  hr: 'منابع انسانی',
  messenger: 'پیام‌رسان',
  voip: 'تلفن',
  dashboard: 'داشبورد',
  'confidential-archive': 'بایگانی محرمانه',
  'referral-marketing': 'بازاریابی معرفی',
  users: 'حساب کاربری',
};

/** صفحه‌ی اصلی هر ماژول (برای لینک اعلان به مقصد). */
export const MODULE_LINKS: Record<string, string> = {
  tasks: '/tasks',
  crm: '/crm',
  projects: '/projects',
  contracts: '/contracts',
  proposals: '/proposals',
  booking: '/booking',
  mentoring: '/mentoring',
  production: '/production',
  recruitment: '/recruitment',
  reports: '/reports',
  approvals: '/approvals',
  dispatch: '/dispatch',
  correspondence: '/correspondence',
};

/**
 * ماژول‌هایی که ماتریس دسترسی نقش دارند (کپی PERMISSION_GATED_MODULE_CODES در web-panel/src/lib/api.ts؛
 * تست ownership-registry.spec.ts هم‌خوانی را اجبار می‌کند). ماژولِ خارج از این فهرست محدودیت دسترسی ماتریسی ندارد.
 */
export const MATRIX_GATED_MODULE_CODES = [
  'crm', 'sales', 'accounting', 'warehouse', 'purchasing', 'hr', 'recruitment', 'tasks', 'daily-checklist', 'projects', 'contracts', 'booking',
  'production', 'quality-control', 'ration-lab', 'mentoring', 'events', 'forms', 'fleet', 'warranty', 'after-sales-service', 'online-store',
  'marketing', 'referral-marketing', 'qr-code', 'automation', 'reports', 'logs', 'dispatch', 'correspondence', 'proposals', 'tax', 'certificates', 'book-store',
];
