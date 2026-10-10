import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** رشته‌ی خالی = برداشتن مسئول مرحله. */
  @IsOptional()
  @IsString()
  responsibleUserId?: string;

  /** «نیاز به تأیید مدیر» — خاموش‌کردن وقتی درخواست تأیید در انتظار است رد می‌شود. */
  @IsOptional()
  @IsBoolean()
  requiresManagerApproval?: boolean;

  /** رشته‌ی خالی = پاک‌کردن توضیح. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  descriptionVisibleToCustomer?: boolean;
}
