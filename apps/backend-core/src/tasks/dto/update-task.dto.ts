import { IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;

  @IsOptional()
  @IsIn(['NORMAL', 'MEDIUM', 'URGENT'])
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';
}
