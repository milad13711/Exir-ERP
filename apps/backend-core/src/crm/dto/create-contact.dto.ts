import { IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsOptional()
  @IsIn(['INDIVIDUAL', 'COMPANY'])
  type?: 'INDIVIDUAL' | 'COMPANY';

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
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  source?: string; // منبع آشنایی: اینستاگرام، معرفی، وب‌سایت، تلفنی، حضوری، سایر

  @IsOptional()
  @IsInt()
  @Min(0)
  acquisitionCost?: number; // هزینه‌ی جذب این سرنخ به تومان

  @IsOptional()
  @IsString()
  referredById?: string; // شناسه‌ی مخاطبی که این سرنخ را معرفی کرده — معرف سفیر برند می‌شود
}
