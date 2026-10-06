import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(5)
  durationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresDeposit?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsBoolean()
  requiresCoordination?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresFullPayment?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsIn(['OFFICE', 'CUSTOMER_SITE', 'ONLINE'])
  locationMode?: 'OFFICE' | 'CUSTOMER_SITE' | 'ONLINE';

  @IsOptional()
  @IsBoolean()
  linkToMentoring?: boolean;
}
