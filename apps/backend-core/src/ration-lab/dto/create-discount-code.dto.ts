import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateDiscountCodeDto {
  @IsString()
  code!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  percentOff!: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}
