import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCurrencyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  symbol?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  rate?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
