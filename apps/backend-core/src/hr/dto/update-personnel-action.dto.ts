import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdatePersonnelActionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsISO8601()
  date?: string;
}
