import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsString, IsUUID, Min, MinLength, ValidateNested } from 'class-validator';

class BudgetLineDto {
  @IsUUID()
  accountId!: string;

  @IsInt()
  @Min(0)
  amount!: number;
}

export class CreateBudgetDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
}
