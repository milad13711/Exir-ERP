import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTimeBlockDto {
  /** فقط مدیران (مشاهده‌ی همه + ویرایش) می‌توانند برای کارشناس دیگر بسازند؛ خالی = خودم. */
  @IsOptional()
  @IsString()
  userId?: string;

  @Matches(DATE_RE)
  startDate!: string;

  @Matches(DATE_RE)
  endDate!: string;

  /** هر دو null/نبود = تمام روز */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  startMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  endMinute?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

export class UpdateTimeBlockDto {
  @IsOptional()
  @Matches(DATE_RE)
  startDate?: string;

  @IsOptional()
  @Matches(DATE_RE)
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  startMinute?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  endMinute?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

export class UpdateBookingPreferencesDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  blockFromTasks?: boolean;

  @IsOptional()
  @IsBoolean()
  blockFromCalendar?: boolean;

  @IsOptional()
  @IsBoolean()
  blockFromLeave?: boolean;
}
