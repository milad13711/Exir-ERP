import { IsDataURI, IsString, MinLength, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';

export class SignInvoiceDto {
  @IsString()
  @MinLength(1)
  @IsDataURI()
  signatureDataUrl!: string;

  /** شواهد حقوقی امضا از مرورگر؛ اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
