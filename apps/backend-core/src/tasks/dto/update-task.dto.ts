import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;

  @IsOptional()
  @IsIn(['NORMAL', 'MEDIUM', 'URGENT'])
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}
