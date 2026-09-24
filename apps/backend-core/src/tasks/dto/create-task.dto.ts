import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(2)
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
  @IsIn(['NORMAL', 'MEDIUM', 'URGENT'])
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';

  /** Defaults to the creator when omitted — set to refer the task to someone else. */
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  /** Together with relatedEntityId, links this task to e.g. a CRM deal or sales invoice — same entityType/entityId convention as Attachment. */
  @IsOptional()
  @IsString()
  relatedModule?: string;

  @IsOptional()
  @IsString()
  relatedEntityId?: string;
}
