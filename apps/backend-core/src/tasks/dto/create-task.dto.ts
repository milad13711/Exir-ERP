import { IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'MEDIUM', 'URGENT'])
  priority?: 'NORMAL' | 'MEDIUM' | 'URGENT';
}
