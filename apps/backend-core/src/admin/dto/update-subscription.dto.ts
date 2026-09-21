import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/** تنظیم دستی اشتراک توسط ادمین: تاریخ پایان (روز باقی‌مانده)، وضعیت، مادام‌العمر، پلن. */
export class UpdateSubscriptionDto {
  @IsOptional()
  @IsISO8601()
  currentPeriodEnd?: string;

  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'])
  status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

  @IsOptional()
  @IsBoolean()
  lifetime?: boolean;

  @IsOptional()
  @IsString()
  planCode?: string;
}
