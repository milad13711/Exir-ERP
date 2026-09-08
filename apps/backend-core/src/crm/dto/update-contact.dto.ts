import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateContactDto {
  @IsOptional()
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  type?: 'INDIVIDUAL' | 'COMPANY';

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
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  nationalId?: string;

  @IsOptional()
  @IsString()
  economicCode?: string;

  @IsOptional()
  @IsString()
  legalId?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  acquisitionCost?: number;

  @IsOptional()
  @IsString()
  referredById?: string;
}
