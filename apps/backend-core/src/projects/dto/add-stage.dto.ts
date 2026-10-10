import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  responsibleUserId?: string;

  /** نیاز به تأیید مدیر برای شروع این مرحله؛ پیش‌فرض true (رفتار قبلی) */
  @IsOptional()
  @IsBoolean()
  requiresManagerApproval?: boolean;
}
