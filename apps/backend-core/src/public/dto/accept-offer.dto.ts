import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';
import { Type } from 'class-transformer';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';

export class AcceptOfferDto {
  @IsBoolean()
  accepted!: boolean;

  /** امضای الکترونیک متقاضی (data URL تصویر) — برای پذیرش الزامی است. */
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  signature?: string;

  /** کد ملی متقاضی */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  /** تصویر کارت ملی متقاضی — data URL (base64)، همان الگوی CompanyStampService */
  @IsOptional()
  @IsString()
  @IsUploadDataUri('image')
  idCardImage?: string;

  /** شواهد حقوقی امضا از مرورگر؛ اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
