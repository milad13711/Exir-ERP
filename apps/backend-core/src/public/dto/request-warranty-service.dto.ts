import { IsOptional, IsString, MinLength } from 'class-validator';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

export class RequestWarrantyServiceDto {
  @IsString()
  code!: string;

  @IsString()
  @MinLength(5)
  description!: string;

  @IsOptional()
  @IsString()
  @IsUploadDataUri('image')
  photo?: string;
}
