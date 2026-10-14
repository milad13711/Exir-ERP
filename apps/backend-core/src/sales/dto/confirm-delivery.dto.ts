import { IsDataURI, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';

const METHODS = ['CODE', 'SIGNATURE'] as const;

export class ConfirmDeliveryDto {
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @IsDataURI()
  signatureDataUrl?: string;

  @IsString()
  @MinLength(1)
  confirmerName!: string;

  /** شواهد حقوقی امضا از مرورگر؛ اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
