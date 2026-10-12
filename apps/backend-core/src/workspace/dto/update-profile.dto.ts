import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((o) => o.email !== null)
  @IsString()
  email?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.avatarUrl !== null)
  @IsString()
  @IsUploadDataUri('smallImage')
  avatarUrl?: string | null;
}
