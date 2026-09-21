import { IsBoolean, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** آدرس اختصاصی همین نوبت (جای‌گزین آدرس خدمت/شرکت) */
  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  cancelReason?: string;

  /** بازگشایی نوبت لغوشده/عدم‌حضور با زمان جدید */
  @IsOptional()
  @IsBoolean()
  reopen?: boolean;
}
