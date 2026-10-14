import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';


export class PublicSignContractDto {
  @IsString()
  ticket!: string;

  @IsString()
  @MinLength(4)
  signatureDataUrl!: string;

  @IsString()
  @MinLength(2)
  signerName!: string;

  /** وقتی مشخص شود، امضا برای یک الحاقیه‌ی این قرارداد ثبت می‌شود، نه خود قرارداد. */
  @IsOptional()
  @IsString()
  amendmentId?: string;

  /** شواهد حقوقی امضا از مرورگر (IP/زمان سرور را خود سرور ثبت می‌کند). اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
