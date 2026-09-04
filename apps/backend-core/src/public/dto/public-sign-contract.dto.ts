import { IsOptional, IsString, MinLength } from 'class-validator';

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
}
