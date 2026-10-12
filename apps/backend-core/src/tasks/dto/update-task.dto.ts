import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { TASK_PRIORITIES, TASK_RECURRENCES } from './create-task.dto.js';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  /** سازگاری قدیمی: معادل ارجاع مجدد به یک نفر. */
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsISO8601()
  sendAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60 * 24 * 90, { each: true })
  reminderOffsetsMin?: number[];

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
  recurrenceEndAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
