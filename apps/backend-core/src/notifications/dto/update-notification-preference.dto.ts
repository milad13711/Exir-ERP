import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  /** { [category]: { push?, inApp?, sms? } } — اعتبارسنجی/پاک‌سازی در سرویس (sanitizeCategoryPrefs). */
  @IsOptional()
  @IsObject()
  categoryPrefs?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(HHMM)
  quietStart?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM)
  quietEnd?: string;

  @IsOptional()
  @IsBoolean()
  smsFallbackEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  toastEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reminderEnabled?: boolean;

  /** یادآوری مجدد اعلان مهمِ نخوانده پس از N ساعت (۱ تا ۴۸). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48)
  reminderAfterHours?: number;
}
