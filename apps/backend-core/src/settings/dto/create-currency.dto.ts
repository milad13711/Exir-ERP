import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCurrencyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsNumber()
  @IsPositive()
  rate!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
