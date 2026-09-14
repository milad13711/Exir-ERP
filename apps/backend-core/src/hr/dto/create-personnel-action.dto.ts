import { IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** برای هم پاداش و هم جریمه — شکل ورودی یکسان است، فقط جدول مقصد فرق دارد. */
export class CreatePersonnelActionDto {
  @IsString()
  employeeId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

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
