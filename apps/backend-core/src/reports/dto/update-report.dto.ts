import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsISO8601()
  executionAt?: string;
}
