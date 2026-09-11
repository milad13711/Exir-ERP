import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class ActivateWarrantyDto {
  @IsString()
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(10)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;

  @IsOptional()
  @IsString()
  productPhoto?: string;
}
