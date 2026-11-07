import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateDiscountCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percentOff?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}
