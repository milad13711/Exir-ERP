import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RunAccountingBackfillDto {
  /** تأیید صریح کاربر پس از دیدن پیش‌نمایش. */
  @IsBoolean()
  confirm!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsIn(['INVOICES', 'PAYMENTS', 'RETURNS', 'DONE'])
  stage?: 'INVOICES' | 'PAYMENTS' | 'RETURNS' | 'DONE';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  runId?: string;

  /** ORIGINAL: تاریخ اصلی (ردیف در دوره‌ی بسته رد می‌شود)؛ TODAY_IF_LOCKED: در دوره‌ی بسته با تاریخ امروز. */
  @IsOptional()
  @IsIn(['ORIGINAL', 'TODAY_IF_LOCKED'])
  dateMode?: 'ORIGINAL' | 'TODAY_IF_LOCKED';
}
