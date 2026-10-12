import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

export class TaskFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsUploadDataUri('file', { allowHttp: true })
  fileUrl!: string;
}

export const TASK_PRIORITIES = ['NORMAL', 'MEDIUM', 'URGENT'] as const;
export const TASK_RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;

/** فرم اصلی کوتاه: عنوان، ارجاع‌گیرندگان، اولویت، موعد، توضیحات. بقیه‌ی فیلدها در «جزئیات بیشتر» اختیاری‌اند. */
export class CreateTaskDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  /** آیتم‌های چک‌لیستی اولیه‌ی وظیفه (هرکدام یک مرحله‌ی تیک‌خور). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  checklist?: string[];

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  /** چند ارجاع‌گیرنده؛ اگر خالی باشد وظیفه برای خودِ سازنده ثبت می‌شود. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  assigneeIds?: string[];

  /** سازگاری با مصرف‌کننده‌های قدیمی (تک‌ارجاع). */
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  // ── جزئیات بیشتر ──
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  /** ارسال زمان‌بندی‌شده: تا این زمان وظیفه برای ارجاع‌گیرنده نامرئی است و اعلانی نمی‌رود. */
  @IsOptional()
  @IsISO8601()
  sendAt?: string;

  /** یادآوری چند دقیقه پیش از موعد (مثلاً [60, 1440]). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60 * 24 * 90, { each: true })
  reminderOffsetsMin?: number[];

  /** Together with relatedEntityId, links this task to e.g. a CRM deal or sales invoice — same entityType/entityId convention as Attachment. */
  @IsOptional()
  @IsString()
  relatedModule?: string;

  @IsOptional()
  @IsString()
  relatedEntityId?: string;

  @IsOptional()
  @IsIn(TASK_RECURRENCES)
  recurrence?: (typeof TASK_RECURRENCES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  recurrenceInterval?: number;

  @IsOptional()
  @IsISO8601()
  recurrenceEndAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  attachments?: TaskFileDto[];
}
