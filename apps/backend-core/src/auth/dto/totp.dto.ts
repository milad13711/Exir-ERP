import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyTotpLoginDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  totpToken!: string;

  /** کد ۶ رقمی برنامه‌ی احراز هویت یا کد بازیابی xxxxx-xxxxx */
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}

export class TotpCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}
