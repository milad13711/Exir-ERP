import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDashboardReminderDto {
  /** "YYYY-MM-DD" (میلادی) — روز یادآوری به وقت تهران. */
  @IsISO8601()
  date!: string;

  /** "HH:mm" به وقت تهران؛ اگر allDay باشد نادیده گرفته می‌شود (ساعت ۰۸:۰۰). */
  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}$/, { message: 'ساعت باید به شکل HH:mm باشد' })
  time?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** IN_APP | PUSH | SMS | EMAIL */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['IN_APP', 'PUSH', 'SMS', 'EMAIL'], { each: true })
  channels?: string[];

  /** دقیقه‌های پیش‌هشدار؛ ۰ = در لحظه‌ی موعد. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  leadMinutes?: number[];

  @IsOptional()
  @IsIn(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'])
  repeatRule?: string;
}

export class UpdateDashboardReminderDto {
  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @Matches(/^\d{1,2}:\d{2}$/)
  time?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['IN_APP', 'PUSH', 'SMS', 'EMAIL'], { each: true })
  channels?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  leadMinutes?: number[];

  @IsOptional()
  @IsIn(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'])
  repeatRule?: string;
}

export class SnoozeDashboardReminderDto {
  /** دقیقه‌ی تعویق (پیش‌فرض ۱۰). */
  @IsOptional()
  @IsInt()
  minutes?: number;
}
