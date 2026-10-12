import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

export class UpdateCompanyStampDto {
  @IsOptional()
  @ValidateIf((o) => o.signatureImage !== null)
  @IsString()
  @IsUploadDataUri('smallImage')
  signatureImage?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.stampImage !== null)
  @IsString()
  @IsUploadDataUri('smallImage')
  stampImage?: string | null;
}
