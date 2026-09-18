import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const TIERS = ['A_PLUS', 'A', 'B'] as const;

export class CreateResellerDto {
  @IsString()
  @MinLength(2)
  name!: string;

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
}
