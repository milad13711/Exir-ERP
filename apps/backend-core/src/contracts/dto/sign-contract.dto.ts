import { IsString, MinLength, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';


/** امضای داخلی — طرف «شرکت» توسط کاربر لاگین‌شده، بدون نیاز به OTP. */
export class SignContractDto {
  @IsString()
  @MinLength(4)
  signatureDataUrl!: string;

  @IsString()
  @MinLength(2)
  signerName!: string;

  /** شواهد حقوقی امضا از مرورگر (IP/زمان سرور را خود سرور ثبت می‌کند). اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
