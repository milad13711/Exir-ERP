import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

const MODULE_CODE = 'certificates';
const TEMPLATE_KEY = 'template';

export type CertificateFieldKey =
  | 'recipientName'
  | 'title'
  | 'body'
  | 'items'
  | 'nationalId'
  | 'companyName'
  | 'code'
  | 'issueDate'
  | 'qr'
  | 'stamp'
  | 'signature';

export type FieldPosition = {
  xPct: number;
  yPct: number;
  fontSizePx?: number;
  align?: 'left' | 'center' | 'right';
  widthPct?: number;
  lineHeightPx?: number;
  /** false = روی گواهی چاپ نمی‌شود. برای فیلدهای قدیمی undefined یعنی نمایش. */
  visible?: boolean;
};

export type ItemsColumns = 2 | 3;

export type CertificateTemplateSettings = {
  backgroundImage: string | null;
  stampImage?: string | null;
  signatureImage?: string | null;
  fieldsFa: Record<CertificateFieldKey, FieldPosition>;
  fieldsEn: Record<CertificateFieldKey, FieldPosition>;
  itemsColumns: ItemsColumns;
  bodyTextFa: string;
  bodyTextEn: string;
  issuerCompanyNameFa: string;
  issuerCompanyNameEn: string;
};

export const DEFAULT_BODY_TEXT_FA =
  'بدینوسیله گواهی می‌شود که {recipientName} به شماره ملی {nationalId} دوره «{title}» را از تاریخ {startDate} تا {endDate} به مدت {durationHours} ساعت در {companyName} با موفقیت به پایان رسانده است.';
export const DEFAULT_BODY_TEXT_EN =
  'This is to certify that {recipientName}, National ID {nationalId}, has successfully completed the course "{title}" from {startDate} to {endDate}, totaling {durationHours} hours, at {companyName}.';

/** موقعیت پیش‌فرض هر فیلد — وقتی تننت هنوز قالب سفارشی تنظیم نکرده، از همین چیدمان استفاده می‌شود (روی طرح ثابت طلایی قدیمی). */
const DEFAULT_FIELDS_FA: Record<CertificateFieldKey, FieldPosition> = {
  recipientName: { xPct: 50, yPct: 30, fontSizePx: 34, align: 'center' },
  title: { xPct: 50, yPct: 40, fontSizePx: 22, align: 'center' },
  body: { xPct: 50, yPct: 53, fontSizePx: 16, align: 'center', widthPct: 70, lineHeightPx: 28 },
  items: { xPct: 50, yPct: 71, fontSizePx: 14, align: 'center', widthPct: 70, lineHeightPx: 22 },
  nationalId: { xPct: 50, yPct: 35, fontSizePx: 13, align: 'center', visible: false },
  companyName: { xPct: 50, yPct: 12, fontSizePx: 16, align: 'center', visible: false },
  code: { xPct: 18, yPct: 92, fontSizePx: 11, align: 'center' },
  issueDate: { xPct: 50, yPct: 92, fontSizePx: 12.5, align: 'center' },
  qr: { xPct: 18, yPct: 84, fontSizePx: 0, align: 'center', widthPct: 8 },
  stamp: { xPct: 82, yPct: 80, fontSizePx: 0, align: 'center', widthPct: 12 },
  signature: { xPct: 82, yPct: 90, fontSizePx: 0, align: 'center', widthPct: 14 },
};

const DEFAULT_FIELDS_EN: Record<CertificateFieldKey, FieldPosition> = DEFAULT_FIELDS_FA;

const FIELD_KEYS = Object.keys(DEFAULT_FIELDS_FA) as CertificateFieldKey[];

/** ادغام JSON ذخیره‌شده روی پیش‌فرض‌ها به‌صورت کلید‌به‌کلید و فیلد‌به‌فیلد. */
function mergeFields(
  defaults: Record<CertificateFieldKey, FieldPosition>,
  stored: Partial<Record<CertificateFieldKey, Partial<FieldPosition>>> | undefined,
): Record<CertificateFieldKey, FieldPosition> {
  const out = {} as Record<CertificateFieldKey, FieldPosition>;
  for (const key of FIELD_KEYS) out[key] = { ...defaults[key], ...(stored?.[key] ?? {}) };
  return out;
}

function normalizeColumns(value: unknown): ItemsColumns {
  return value === 3 || value === '3' ? 3 : 2;
}

export function defaultTemplateSettings(): CertificateTemplateSettings {
  return {
    backgroundImage: null,
    stampImage: null,
    signatureImage: null,
    fieldsFa: mergeFields(DEFAULT_FIELDS_FA, undefined),
    fieldsEn: mergeFields(DEFAULT_FIELDS_EN, undefined),
    itemsColumns: 2,
    bodyTextFa: DEFAULT_BODY_TEXT_FA,
    bodyTextEn: DEFAULT_BODY_TEXT_EN,
    issuerCompanyNameFa: '',
    issuerCompanyNameEn: '',
  };
}

@Injectable()
export class CertificateTemplateSettingsService {
  async get(ctx: TenantRequestContext): Promise<CertificateTemplateSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: TEMPLATE_KEY } },
    });
    if (!row) return defaultTemplateSettings();
    const stored = row.value as Partial<CertificateTemplateSettings>;
    const defaults = defaultTemplateSettings();
    return {
      backgroundImage: stored.backgroundImage ?? null,
      stampImage: stored.stampImage ?? null,
      signatureImage: stored.signatureImage ?? null,
      fieldsFa: mergeFields(defaults.fieldsFa, stored.fieldsFa),
      fieldsEn: mergeFields(defaults.fieldsEn, stored.fieldsEn),
      itemsColumns: normalizeColumns(stored.itemsColumns),
      bodyTextFa: stored.bodyTextFa?.trim() ? stored.bodyTextFa : defaults.bodyTextFa,
      bodyTextEn: stored.bodyTextEn?.trim() ? stored.bodyTextEn : defaults.bodyTextEn,
      issuerCompanyNameFa: stored.issuerCompanyNameFa ?? '',
      issuerCompanyNameEn: stored.issuerCompanyNameEn ?? '',
    };
  }

  /** فقط مالک/مدیر می‌توانند قالب گواهی را تغییر دهند — همان قاعده‌ی این پروژه برای تنظیمات سطح تننت. */
  async update(ctx: TenantRequestContext, dto: Partial<CertificateTemplateSettings>): Promise<CertificateTemplateSettings> {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر محیط کاری می‌تواند قالب گواهی را تغییر دهد');
    }
    const current = await this.get(ctx);
    const next: CertificateTemplateSettings = {
      backgroundImage: dto.backgroundImage !== undefined ? dto.backgroundImage : current.backgroundImage,
      stampImage: dto.stampImage !== undefined ? dto.stampImage : current.stampImage,
      signatureImage: dto.signatureImage !== undefined ? dto.signatureImage : current.signatureImage,
      fieldsFa: dto.fieldsFa ? mergeFields(current.fieldsFa, dto.fieldsFa) : current.fieldsFa,
      fieldsEn: dto.fieldsEn ? mergeFields(current.fieldsEn, dto.fieldsEn) : current.fieldsEn,
      itemsColumns: dto.itemsColumns !== undefined ? normalizeColumns(dto.itemsColumns) : current.itemsColumns,
      bodyTextFa: typeof dto.bodyTextFa === 'string' ? (dto.bodyTextFa.trim() ? dto.bodyTextFa : DEFAULT_BODY_TEXT_FA) : current.bodyTextFa,
      bodyTextEn: typeof dto.bodyTextEn === 'string' ? (dto.bodyTextEn.trim() ? dto.bodyTextEn : DEFAULT_BODY_TEXT_EN) : current.bodyTextEn,
      issuerCompanyNameFa: typeof dto.issuerCompanyNameFa === 'string' ? dto.issuerCompanyNameFa.trim() : current.issuerCompanyNameFa,
      issuerCompanyNameEn: typeof dto.issuerCompanyNameEn === 'string' ? dto.issuerCompanyNameEn.trim() : current.issuerCompanyNameEn,
    };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: TEMPLATE_KEY } },
      create: { moduleCode: MODULE_CODE, key: TEMPLATE_KEY, value: next },
      update: { value: next },
    });
    return next;
  }
}
