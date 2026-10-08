import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';

const PRODUCT_CODES = ['ERP', 'REAL_ESTATE', 'SMS_GATEWAY', 'OTHER'] as const;

export class CreateResellerApplicationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  @MinLength(10)
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @IsHttpUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsIn(PRODUCT_CODES)
  productCode?: (typeof PRODUCT_CODES)[number];

  @IsOptional()
  @IsString()
  message?: string;
}
