import { IsString, MinLength } from 'class-validator';

/** امضای داخلی — طرف «شرکت» توسط کاربر لاگین‌شده، بدون نیاز به OTP. */
export class SignContractDto {
  @IsString()
  @MinLength(4)
  signatureDataUrl!: string;

  @IsString()
  @MinLength(2)
  signerName!: string;
}
