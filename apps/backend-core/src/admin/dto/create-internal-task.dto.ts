import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInternalTaskDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
