import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsInt, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

class StatementLineDto {
  @IsISO8601()
  date!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsInt()
  amount!: number; // مثبت = واریز، منفی = برداشت

  @IsOptional()
  @IsString()
  reference?: string;
}

export class CreateStatementLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[];
}
