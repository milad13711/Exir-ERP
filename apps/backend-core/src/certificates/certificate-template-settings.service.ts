import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

const MODULE_CODE = 'certificates';
const TEMPLATE_KEY = 'template';

export type CertificateFieldKey =
  | 'recipientName'
  | 'title'
  | 'items'
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
};

export type CertificateTemplateSettings = {
  backgroundImage: string | null;
  stampImage?: string | null;
  signatureImage?: string | null;
  fieldsFa: Record<CertificateFieldKey, FieldPosition>;
  fieldsEn: Record<CertificateFieldKey, FieldPosition>;
};

/** موقعیت پیش‌فرض هر فیلد — وقتی تننت هنوز قالب سفارشی تنظیم نکرده، از همین چیدمان استفاده می‌شود (روی طرح ثابت طلایی قدیمی). */
const DEFAULT_FIELDS_FA: Record<CertificateFieldKey, FieldPosition> = {
  recipientName: { xPct: 50, yPct: 40, fontSizePx: 34, align: 'center' },
  title: { xPct: 50, yPct: 55, fontSizePx: 22, align: 'center' },
  items: { xPct: 50, yPct: 66, fontSizePx: 14, align: 'center', widthPct: 70, lineHeightPx: 20 },
  code: { xPct: 18, yPct: 92, fontSizePx: 11, align: 'center' },
  issueDate: { xPct: 50, yPct: 92, fontSizePx: 12.5, align: 'center' },
  qr: { xPct: 18, yPct: 84, fontSizePx: 0, align: 'center', widthPct: 8 },
  stamp: { xPct: 82, yPct: 80, fontSizePx: 0, align: 'center', widthPct: 12 },
  signature: { xPct: 82, yPct: 90, fontSizePx: 0, align: 'center', widthPct: 14 },
};

const DEFAULT_FIELDS_EN: Record<CertificateFieldKey, FieldPosition> = DEFAULT_FIELDS_FA;

export function defaultTemplateSettings(): CertificateTemplateSettings {
  return {
    backgroundImage: null,
    stampImage: null,
    signatureImage: null,
    fieldsFa: { ...DEFAULT_FIELDS_FA },
    fieldsEn: { ...DEFAULT_FIELDS_EN },
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
      fieldsFa: { ...defaults.fieldsFa, ...(stored.fieldsFa ?? {}) },
      fieldsEn: { ...defaults.fieldsEn, ...(stored.fieldsEn ?? {}) },
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
      fieldsFa: dto.fieldsFa ? { ...current.fieldsFa, ...dto.fieldsFa } : current.fieldsFa,
      fieldsEn: dto.fieldsEn ? { ...current.fieldsEn, ...dto.fieldsEn } : current.fieldsEn,
    };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: TEMPLATE_KEY } },
      create: { moduleCode: MODULE_CODE, key: TEMPLATE_KEY, value: next },
      update: { value: next },
    });
    return next;
  }
}
