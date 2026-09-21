import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateResellerApplicationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsIn(['ERP', 'REAL_ESTATE', 'SMS_GATEWAY', 'OTHER'])
  productCode?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
