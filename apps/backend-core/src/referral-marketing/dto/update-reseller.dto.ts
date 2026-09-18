import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const TIERS = ['A_PLUS', 'A', 'B'] as const;

export class UpdateResellerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  shabaNumber?: string;

  @IsOptional()
  @IsIn(TIERS)
  tier?: (typeof TIERS)[number];

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  commissionFirstPaymentPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  commissionRenewalPercent?: number;
}
