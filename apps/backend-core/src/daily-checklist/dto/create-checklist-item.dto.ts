import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateChecklistItemDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsISO8601()
  date!: string;

  /** خالی یعنی برای خودم؛ مدیر می‌تواند برای زیردستش هم آیتم بسازد. */
  @IsOptional()
  @IsString()
  forUserId?: string;
}
