import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

const FUNNEL_STAGES = [
  'NEW_LEAD',
  'CONTACTED',
  'QUALIFIED',
  'CUSTOMER',
  'REPEAT_CUSTOMER',
  'BRAND_AMBASSADOR',
  'CHURN_RISK',
  'CHURNED',
];

/**
 * معیار انتخاب مخاطبین کمپین — همه‌ی فیلدها اختیاری و AND می‌شوند. هر
 * سناریوی نمونه‌ی درخواست کاربر با ترکیبی از همین فیلدها ساخته می‌شود، مثلاً:
 * «مشتریان هرماهه» → frequentBuyerMaxGapDays: 35
 * «بیش از ۲ ماه خرید نکرده» → minDaysSinceLastPurchase: 60
 * «سرنخ‌های ناآشنا» → funnelStages: ['NEW_LEAD','CONTACTED']
 * «موعد خرید مجدد الان است» → dueForRepurchase: true
 * «قبلاً فلان محصول را خریده» → purchasedProductContains: '...'
 */
export class AudienceFilterDto {
  @IsOptional()
  @IsArray()
  @IsIn(FUNNEL_STAGES, { each: true })
  funnelStages?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minDaysSinceLastPurchase?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysSinceLastPurchase?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  frequentBuyerMaxGapDays?: number;

  @IsOptional()
  @IsBoolean()
  dueForRepurchase?: boolean;

  @IsOptional()
  @IsString()
  purchasedProductContains?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPurchaseCount?: number;

  @IsOptional()
  @IsBoolean()
  isBrandAmbassador?: boolean;

  @IsOptional()
  @IsString()
  source?: string;
}

export class PreviewAudienceDto {
  @ValidateNested()
  @Type(() => AudienceFilterDto)
  filter!: AudienceFilterDto;
}
