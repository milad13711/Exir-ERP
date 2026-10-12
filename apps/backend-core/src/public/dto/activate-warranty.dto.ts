import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

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
  @IsUploadDataUri('image')
  productPhoto?: string;
}
