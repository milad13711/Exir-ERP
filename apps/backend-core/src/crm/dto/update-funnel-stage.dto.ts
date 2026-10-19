import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// فقط مراحل پیش از تبدیل به مشتری (به‌علاوه‌ی رد صلاحیت) با دست قابل جابه‌جایی‌اند —
// بقیه‌ی قیف (CUSTOMER به بعد) با رویدادهای واقعی (خرید، برد فرصت، تبدیل، ریسک ریزش) پیش می‌رود.
export class UpdateFunnelStageDto {
  @IsIn(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'])
  stage!: 'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';

  /** دلیل رد صلاحیت — برای DISQUALIFIED الزامی است. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
