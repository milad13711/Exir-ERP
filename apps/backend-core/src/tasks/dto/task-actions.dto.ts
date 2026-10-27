import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { TaskFileDto } from './create-task.dto.js';

export class SubmitResultDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files?: TaskFileDto[];
}

export class NoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RequiredNoteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  note!: string;
}

export class ProblemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(3000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files?: TaskFileDto[];
}

export class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class ResolveProblemDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** مدیر می‌تواند همزمان موعد جدید بدهد. */
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class ExtensionRequestDto {
  @IsISO8601()
  proposedDueAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ExtensionDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** هنگام تأیید می‌شود موعدی غیر از پیشنهادی داد. */
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class ReassignDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  assigneeIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class TaskSettingsDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,10}$/, { message: 'پیشوند فقط حروف/ارقام لاتین و حداکثر ۱۰ نویسه' })
  numberPrefix!: string;
}

export class MarkDeliveredDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
