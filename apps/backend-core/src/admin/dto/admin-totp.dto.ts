import { IsString, MaxLength, MinLength } from 'class-validator';

/** کد TOTP ۶ رقمی یا کد بازیابی xxxxx-xxxxx */
export class AdminTotpLoginDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  challengeToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}

export class AdminTotpEnableDto {
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code!: string;
}

export class AdminTotpDisableDto {
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}
