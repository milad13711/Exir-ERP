import { IsIn } from 'class-validator';

// فقط سه مرحله‌ی پیش از خرید با دست قابل جابه‌جایی‌اند — بقیه‌ی قیف
// (CUSTOMER به بعد) صرفاً با رویدادهای واقعی (خرید، ریسک ریزش) پیش می‌رود.
export class UpdateFunnelStageDto {
  @IsIn(['NEW_LEAD', 'CONTACTED', 'QUALIFIED'])
  stage!: 'NEW_LEAD' | 'CONTACTED' | 'QUALIFIED';
}
