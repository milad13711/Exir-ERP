import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsISO8601()
  executionAt?: string;
}
